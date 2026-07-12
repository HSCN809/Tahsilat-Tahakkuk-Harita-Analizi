import os
import argparse
import unicodedata
import time
import logging
import requests
import datetime
import re
import glob
import pandas as pd
import shutil
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException
from webdriver_manager.chrome import ChromeDriverManager
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# İnteraktif çalıştırma için logging yapılandırması
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# safe_decode artık merkezi kütüphanede — monkey-patch için oradan import et
from Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi import safe_decode, FOLDER_NAME_TEMPLATE

import xlrd
xlrd.biffh.unicode = safe_decode
xlrd.book.unicode = safe_decode
xlrd.formatting.unicode = safe_decode


def normalize_month_name(name):
    """Ay adını normalize eder: combining marks, Türkçe karakterler ve büyük/küçük harf farkını kaldırır."""
    # Unicode NFKD ile decompose et ve combining mark'ları sil
    name = unicodedata.normalize('NFKD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = name.strip().lower()
    replacements = {
        'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c',
        'i̇': 'i',  # İ decomposed
        '00 merkez': 'mayis',
        'eyul': 'eylul',
        'nisin': 'nisan',
        'ankara': 'aralik',
        'eylul)': 'eylul'
    }
    for k, v in replacements.items():
        name = name.replace(k, v)
    return name


def get_best_sheet_name(sheet_names):
    month_priority = ["aralik", "kasim", "ekim", "eylul", "agustos", "temmuz", "haziran", "mayis", "nisan", "mart", "subat", "ocak"]
    normalized_sheets = {normalize_month_name(sh): sh for sh in sheet_names}
    for month in month_priority:
        if month in normalized_sheets:
            return normalized_sheets[month]
    return sheet_names[0]


def clean_and_format_filename(link_text, year):
    """
    Indirilen dosya adini standardize eder.
    Ornek: 01-Adana-2022.xls -> 01_Adana_2022.xlsx
    """
    name = re.sub(r"\.xlsx?$", "", link_text, flags=re.IGNORECASE).strip()
    parts = re.split(r"[-_]", name)
    if len(parts) >= 3:
        code = parts[0].strip()
        file_year = parts[-1].strip()
        province_name = " ".join(parts[1:-1]).strip()
        province_name = province_name.replace(" ", "_")

        # Merkez veya gecersiz kodlari ele
        if code == "00" or "merkez" in province_name.lower():
            return None

        return f"{code}_{province_name}_{file_year}.xlsx"
    return None


def download_file(session, link_text, link_href, target_dir, idx, total):
    """
    Tek bir Excel dosyasini requests.Session kullanarak indirir.
    WAF/Cloudflare engellerini asmak icin tarayıcı basliklari (Headers) kullanir.
    """
    try:
        # Guvenli dosya adi olustur
        safe_filename = "".join(c for c in link_text if c.isalnum() or c in (' ', '-', '_')).rstrip()
        if not safe_filename.endswith(('.xlsx', '.xls')):
            safe_filename += '.xls'

        file_path = target_dir / safe_filename

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://muhasebat.hmb.gov.tr/',
            'Connection': 'keep-alive'
        }

        response = session.get(link_href, headers=headers, timeout=20)
        response.raise_for_status()

        with open(file_path, 'wb') as file:
            file.write(response.content)

        logger.info("İndirildi (%d/%d): %s", idx, total, link_text)
        return True, file_path
    except Exception:
        logger.error("İndirme hatası (%s)", link_text, exc_info=True)
        return False, None


def convert_file(xls_file, year, indir_konumu):
    """
    Tek bir .xls dosyasını il alt klasörüne aylık .xlsx dosyaları olarak dönüştürür.
    Orijinal .xls dosyası yıl klasörü altındaki raw_xls/ klasöründe saklanır (silinmez).

    Dönüş Değeri:
      (başarılı_mı, il_mi, kaydedilen_ay_sayısı, beklenen_ay_sayısı)
    """
    base_name = os.path.basename(xls_file)

    # Standart ay isimleri (xlrd bozuk karakterlerle döndürebilir, normalize ederek eşleştireceğiz)
    MONTH_DISPLAY_NAMES = {
        "ocak": "Ocak", "subat": "Şubat", "mart": "Mart",
        "nisan": "Nisan", "mayis": "Mayıs", "haziran": "Haziran",
        "temmuz": "Temmuz", "agustos": "Ağustos", "eylul": "Eylül",
        "ekim": "Ekim", "kasim": "Kasım", "aralik": "Aralık"
    }

    current_year = datetime.date.today().year

    try:
        cleaned_name = clean_and_format_filename(base_name, year)
        if not cleaned_name:
            _archive_raw_xls(xls_file, indir_konumu)
            return True, False, 0, 0, int(year), "", []

        # İl klasör adını dosya adından çıkar (01_Adana_2024.xlsx -> 01_Adana)
        province_folder_name = "_".join(cleaned_name.replace(".xlsx", "").split("_")[:-1])
        province_dir = indir_konumu / province_folder_name
        os.makedirs(province_dir, exist_ok=True)

        # Excel dosyasını aç ve tüm sayfaları oku
        xls = pd.ExcelFile(xls_file, engine='xlrd')
        sheet_names = xls.sheet_names

        # Beklenen ay sayısı tespiti:
        # Cari yıl ise HMB'deki dosyanın sahip olduğu geçerli sayfa sayısı kadardır.
        # Geçmiş yıl ise 12 aydır.
        valid_sheets_count = sum(1 for sh in sheet_names if normalize_month_name(sh) in MONTH_DISPLAY_NAMES)
        expected_months = valid_sheets_count if int(year) == current_year else 12

        saved_months = 0
        saved_month_names = []
        for sheet in sheet_names:
            normalized = normalize_month_name(sheet)
            display_name = MONTH_DISPLAY_NAMES.get(normalized)

            if display_name:
                df = pd.read_excel(xls, sheet_name=sheet)
                month_xlsx_path = province_dir / f"{display_name}.xlsx"
                df.to_excel(month_xlsx_path, index=False)
                saved_months += 1
                saved_month_names.append(display_name)

        # ExcelFile handle'ını kapat (Windows dosya kilidi)
        xls.close()

        # Hangi ayların eksik olduğunu tespit et
        missing_months = []
        if saved_months < expected_months:
            all_standard_months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
            for m in all_standard_months:
                if m not in saved_month_names:
                    # Cari yıl ise sadece şimdiye kadar olan geçerli ayları kontrol et
                    if int(year) == current_year and normalize_month_name(m) not in [normalize_month_name(sh) for sh in sheet_names]:
                        continue
                    missing_months.append(m)

        logger.info("Dönüştürüldü: %s -> %s/ (%d/%d ay)", base_name, province_folder_name, saved_months, expected_months)

        # Orijinal .xls dosyasını yıl klasörü altındaki raw_xls/ klasörüne taşı
        _archive_raw_xls(xls_file, indir_konumu)
        return True, True, saved_months, expected_months, int(year), province_folder_name, missing_months
    except Exception:
        logger.error("Dönüştürme hatası (%s)", base_name, exc_info=True)
        # Hata durumunda da orijinal .xls'i raw_xls/ altında sakla (kayıp olmasın)
        if os.path.exists(xls_file):
            try:
                _archive_raw_xls(xls_file, indir_konumu)
            except Exception:
                logger.debug(".xls dosyası arşivlenemedi: %s", xls_file, exc_info=True)
        expected = 5 if int(year) == current_year else 12
        return False, True, 0, expected, int(year), os.path.basename(xls_file), []


def _archive_raw_xls(xls_file, indir_konumu):
    """Orijinal .xls dosyasını yıl klasörü altındaki raw_xls/ alt klasörüne taşır."""
    raw_dir = indir_konumu / "raw_xls"
    os.makedirs(raw_dir, exist_ok=True)
    base_name = os.path.basename(xls_file)
    dest = raw_dir / base_name
    # Aynı isimde dosya varsa üzerine yaz (shutil.move mevcut dosyayı hedefler)
    if os.path.exists(dest):
        os.remove(dest)
    shutil.move(str(xls_file), str(dest))


def parse_years_input(input_str, min_year, max_year):
    """
    Yil veya yil araligini cozumler.
    Ornek: hepsi / tümü / all -> tüm yıllar (min_year-max_year)
    """
    input_str_clean = input_str.strip().lower()
    if input_str_clean in ("hepsi", "tümü", "tüm", "all", "tüm yıllar"):
        return list(range(min_year, max_year + 1))

    years = []
    input_str = input_str.replace(" ", "")

    if "," in input_str:
        parts = input_str.split(",")
    else:
        parts = [input_str]

    for part in parts:
        if "-" in part:
            subparts = part.split("-")
            if len(subparts) == 2:
                try:
                    start = int(subparts[0])
                    end = int(subparts[1])
                    if start <= end:
                        years.extend(list(range(start, end + 1)))
                except ValueError:
                    pass
        else:
            try:
                years.append(int(part))
            except ValueError:
                pass

    valid_years = [y for y in sorted(list(set(years))) if min_year <= y <= max_year]
    return valid_years


def setup_driver():
    """Chrome WebDriver'ı başlatır ve yapılandırır."""
    options = ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-extensions")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--headless=new")  # Arka planda calis
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)

    # Sistemde kurulu Chromium ve ChromeDriver'i kullan (Docker imajinda var)
    chrome_bin = os.environ.get("CHROME_BIN", "/usr/bin/chromium")
    chromedriver_path = os.environ.get("CHROMEDRIVER_PATH", "/usr/bin/chromedriver")
    options.binary_location = chrome_bin

    logger.info("Tarayıcı başlatılıyor (Mevcut site yapısı analiz ediliyor)...")
    driver = webdriver.Chrome(service=ChromeService(chromedriver_path), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return driver


def discover_url(driver, current_year):
    """Doğru URL'yi dinamik olarak tespit eder (Örn: 2004-2026 veya 2004-2028 vb.)."""
    for temp_year in [current_year, current_year - 1, current_year - 2]:
        temp_url = f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{temp_year}"
        try:
            driver.get(temp_url)
            time.sleep(2)
            if "404" not in driver.title and len(driver.find_elements(By.XPATH, "//*[contains(text(), 'Genel Bütçe')]")) > 0:
                return temp_url
        except Exception:
            continue
    # Fallback
    return f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{current_year}"


def detect_year_bounds(driver, current_year):
    """Sitedeki mevcut en küçük ve en büyük yılları dinamik toplar."""
    min_year = 2004
    max_year = current_year
    try:
        all_elements = driver.find_elements(By.XPATH, "//*[contains(text(), 'Yılı')]")
        found_years = []
        for el in all_elements:
            try:
                match = re.search(r"(\d{4})\s*Yılı", el.text)
                if match:
                    found_years.append(int(match.group(1)))
            except Exception:
                logger.debug("Yıl elementi okunamadı, atlandı", exc_info=True)
        if found_years:
            min_year = min(found_years)
            max_year = max(found_years)
    except Exception:
        logger.warning("Yıl sınırları dinamik okunamadı, varsayılan değerler kullanılacak", exc_info=True)
    return min_year, max_year


def prepare_download_dirs(valid_years, excel_ana_dir):
    """Her yıl için indirme klasörlerini hazırlar (varsa temizler)."""
    indir_konumlari = {}
    for y in valid_years:
        path = excel_ana_dir / FOLDER_NAME_TEMPLATE.format(year=y)

        if path.exists():
            try:
                shutil.rmtree(path)
            except Exception:
                logger.warning("Klasör temizlenirken hata oluştu (%s)", y, exc_info=True)

        os.makedirs(path, exist_ok=True)
        indir_konumlari[y] = path
    return indir_konumlari


def _find_and_click_year_header(driver, wait, y):
    """Yıl ana başlığını bulup tıklar. Başarı durumunu döner."""
    logger.info("%s yılı ana başlığı aranıyor...", y)

    try:
        year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(@class, 'submenu-control-init')][contains(text(), '{y}')]")
        visible_elements = [el for el in year_main_elements if el.is_displayed()]

        if not visible_elements:
            alt_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y} Yılı') or contains(text(), '{y}  Yılı') or contains(text(), '{y}')]")
            visible_elements = [el for el in alt_elements if el.is_displayed()]

        for element in visible_elements:
            logger.info("%s ana başlığı bulundu", y)
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
            time.sleep(1)

            try:
                element.click()
            except ElementClickInterceptedException:
                driver.execute_script("arguments[0].click();", element)

            time.sleep(2)
            return True
    except Exception:
        logger.error("Ana başlık arama hatası (%s)", y, exc_info=True)

    return False


def _find_and_click_budget_tables(driver):
    """Bütçe Gelir Tabloları alt başlığını bulup tıklar. Başarı durumunu döner."""
    try:
        budget_elements = driver.find_elements(By.XPATH, "//a[contains(text(), 'Bütçe Gelir Tabloları')]")
        for element in budget_elements:
            if element.is_displayed():
                logger.info("Bütçe Gelir Tabloları alt başlığı bulundu")
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                time.sleep(1)

                try:
                    element.click()
                except ElementClickInterceptedException:
                    driver.execute_script("arguments[0].click();", element)

                time.sleep(2)
                return True
    except Exception:
        logger.error("Alt başlık arama hatası", exc_info=True)

    return False


def _collect_excel_links(driver, y):
    """Sayfadaki Excel linklerini toplayıp (link_text, href, year) tuple listesi döner."""
    excel_links = []

    xlsx_links = driver.find_elements(By.XPATH, "//a[contains(@href, '.xlsx') or contains(@href, '.xls')]")
    excel_links.extend(xlsx_links)

    excel_text_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Excel') or contains(text(), 'excel')]")
    excel_links.extend(excel_text_links)

    il_excel_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Adana') or contains(text(), 'Ankara') or contains(text(), 'İstanbul') or contains(text(), 'Merkezi') or contains(text(), 'İl ')]")
    for link in il_excel_links:
        href = link.get_attribute('href')
        if href and ('.xlsx' in href or '.xls' in href):
            excel_links.append(link)

    # Tekilleştir
    seen_hrefs = set()
    year_links = []
    for link in excel_links:
        href = link.get_attribute('href')
        if href and href not in seen_hrefs and link.is_displayed():
            seen_hrefs.add(href)
            link_text = link.text.strip() if link.text else f"Excel_{y}_{len(year_links)+1}"
            year_links.append((link_text, href, y))
    return year_links


def collect_links(driver, wait, target_url, valid_years):
    """Tüm yıllar için Excel linklerini toplar."""
    all_links_data = []

    try:
        for y in valid_years:
            logger.info("%s yılı verileri için siteye bağlanılıyor...", y)
            driver.get(target_url)
            time.sleep(3)
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))

            if not _find_and_click_year_header(driver, wait, y):
                logger.error("%s yılı ana başlığı bulunamadı, atlanıyor.", y)
                continue

            if not _find_and_click_budget_tables(driver):
                logger.error("%s için Bütçe Gelir Tabloları bulunamadı, bu yıl atlanıyor.", y)
                continue

            logger.info("%s yılı Excel dosyaları aranıyor...", y)
            year_links = _collect_excel_links(driver, y)
            all_links_data.extend(year_links)
            logger.info("%s yılı için %d Excel linki toplandı.", y, len(year_links))

    except TimeoutException:
        logger.error("Sayfa yükleme zaman aşımına uğradı!")
    except Exception:
        logger.error("Genel hata", exc_info=True)

    return all_links_data


def download_all(all_links_data, indir_konumlari, current_year):
    """Paralel olarak tüm Excel dosyalarını indirir."""
    logger.info("Toplam %d adet Excel linki bulundu.", len(all_links_data))
    logger.info("Paralel indirme başlatılıyor (max_workers=10)...")

    downloaded_files = []
    session = requests.Session()
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(download_file, session, text, href, indir_konumlari[y], idx, len(all_links_data))
            for idx, (text, href, y) in enumerate(all_links_data, 1)
        ]

        for future in as_completed(futures):
            success, file_path = future.result()
            if success and file_path:
                parent_name = file_path.parent.name
                year_match = re.search(r"\d{4}", parent_name)
                file_year = year_match.group(0) if year_match else str(current_year)
                downloaded_files.append((file_path, file_year))

    duration = time.time() - start_time
    logger.info("Tüm indirmeler %.2f saniyede tamamlandı.", duration)
    return downloaded_files


def convert_all(downloaded_files, indir_konumlari):
    """Paralel olarak tüm .xls dosyalarını .xlsx'e dönüştürür ve istatistik döner."""
    logger.info("Dosya biçimleri paralel olarak dönüştürülüyor (Excel conversion)...")
    start_time = time.time()

    total_provinces_expected = 0
    total_provinces_converted = 0
    total_months_expected = 0
    total_months_converted = 0
    year_stats = {}
    missing_data_list = []

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(convert_file, filepath, file_year, indir_konumlari[int(file_year)])
            for filepath, file_year in downloaded_files
        ]
        for future in as_completed(futures):
            res = future.result()
            if res:
                success, is_province, saved, expected, y_val, prov_name, missing_months = res
                if is_province:
                    total_provinces_expected += 1
                    total_months_expected += expected
                    if success:
                        total_provinces_converted += 1
                        total_months_converted += saved
                        if missing_months:
                            missing_data_list.append((y_val, prov_name, missing_months))
                    else:
                        missing_data_list.append((y_val, prov_name, ["Tüm Aylar"]))

                    if y_val not in year_stats:
                        year_stats[y_val] = {"provinces": 0, "expected_months_per_province": expected}
                    year_stats[y_val]["provinces"] += 1

    duration = time.time() - start_time
    logger.info("Dönüştürme %.2f saniyede tamamlandı.", duration)

    return {
        "total_provinces_expected": total_provinces_expected,
        "total_provinces_converted": total_provinces_converted,
        "total_months_expected": total_months_expected,
        "total_months_converted": total_months_converted,
        "year_stats": year_stats,
        "missing_data_list": missing_data_list,
    }


def print_report(valid_years, excel_ana_dir, stats):
    """Sonuç özetini ekrana yazdırır."""
    total_provinces_expected = stats["total_provinces_expected"]
    total_provinces_converted = stats["total_provinces_converted"]
    total_months_expected = stats["total_months_expected"]
    total_months_converted = stats["total_months_converted"]
    year_stats = stats["year_stats"]
    missing_data_list = stats["missing_data_list"]

    # Dinamik formül oluşturma
    formula_groups = {}
    for y_val, st in sorted(year_stats.items()):
        key = (st["provinces"], st["expected_months_per_province"])
        if key not in formula_groups:
            formula_groups[key] = []
        formula_groups[key].append(y_val)

    prov_parts = []
    month_parts = []
    for (p_count, m_count), years in sorted(formula_groups.items(), key=lambda x: x[0][1], reverse=True):
        y_len = len(years)
        prov_parts.append(f"({y_len} yıl * {p_count} il)")
        month_parts.append(f"({y_len} yıl * {p_count} il * {m_count} ay)")

    province_formula = " + ".join(prov_parts)
    month_formula = " + ".join(month_parts)

    print(f"\n{'='*80}")
    print("🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!")
    print(f"📊 İndirilen ve Dönüştürülen Yıllar: {', '.join(map(str, valid_years))}")
    print(f"📁 Dosyaların Ana Konumu: {excel_ana_dir}")
    print(f"{'-'*80}")
    print(f"📈 SONUÇ RAPORU:")
    print(f"  - Beklenen İl Sayısı        : {total_provinces_expected}  <- Hesaplama: {province_formula}")
    print(f"  - Dönüştürülen İl Sayısı    : {total_provinces_converted}")
    print(f"  - Beklenen Toplam Ay Sayısı : {total_months_expected}  <- Hesaplama: {month_formula}")
    print(f"  - Çekilen Toplam Ay Sayısı  : {total_months_converted}")

    if total_months_expected > 0:
        basari_orani = (total_months_converted / total_months_expected) * 100
        print(f"  - Veri Başarı Oranı         : %{basari_orani:.2f}")

    if missing_data_list:
        print(f"{'-'*80}")
        print("⚠️ EKSİK VEYA ÇEKİLEMEYEN AYLIK VERİ DETAYLARI:")
        for y_val, prov_name, months in sorted(missing_data_list, key=lambda x: (x[0], x[1])):
            months_str = ", ".join(months)
            print(f"  - Yıl: {y_val} | İl: {prov_name:<20} | Eksik Aylar: [{months_str}]")

    print(f"{'='*80}")
    print(f"{'='*60}")


def main():
    """Ana orchestration fonksiyonu — argparse ile yıl input alır, adımları sırayla çağırır."""
    parser = argparse.ArgumentParser(description="HMB vergi gelirleri Excel scraper")
    parser.add_argument(
        "years",
        nargs="?",
        default=None,
        help="Yıl/yıl aralığı (örn: 2024, 2024-2025, 2024-2025,2023, hepsi). Belirtilmezse interaktif sorulur."
    )
    args = parser.parse_args()

    current_year = datetime.date.today().year

    # --- 1. Driver başlat ---
    driver = setup_driver()
    wait = WebDriverWait(driver, 20)

    try:
        # --- 2. URL tespiti ---
        target_url = discover_url(driver, current_year)

        # --- 3. Yıl sınırları tespiti ---
        min_year, max_year = detect_year_bounds(driver, current_year)
        logger.info("Sitede mevcut yıllar: %d-%d arası", min_year, max_year)

        # --- 4. Yıl input al (argparse veya interaktif) ---
        if args.years:
            year_input = args.years.strip()
            logger.info("Argüman olarak alınan yıl: %s", year_input)
        else:
            logger.info("Giriş formatları: '2023' veya '2022-2025' veya 'hepsi'")
            year_input = input("Yıl girin: ").strip()

        valid_years = parse_years_input(year_input, min_year, max_year)

        if not valid_years:
            logger.error("Geçerli bir yıl veya yıl aralığı girin (%d-%d)!", min_year, max_year)
            return

        logger.info("Seçilen Yıllar: %s", ', '.join(map(str, valid_years)))

        # --- 5. Klasör hazırlığı ---
        BASE_DIR = Path(__file__).resolve().parent.parent
        veriler_dir = BASE_DIR / "veriler"
        excel_ana_dir = veriler_dir / "Tahsilat Tahakkuk Excel Dosyaları"
        os.makedirs(veriler_dir, exist_ok=True)
        os.makedirs(excel_ana_dir, exist_ok=True)
        indir_konumlari = prepare_download_dirs(valid_years, excel_ana_dir)

        # --- 6. Link toplama ---
        all_links_data = collect_links(driver, wait, target_url, valid_years)

    finally:
        logger.info("Tarayıcı kapatılıyor...")
        driver.quit()
        logger.info("Tarayıcı kapatıldı.")

    # --- 7. İndirme ---
    if not all_links_data:
        logger.error("İndirilecek link bulunamadı.")
        return

    downloaded_files = download_all(all_links_data, indir_konumlari, current_year)

    # --- 8. Dönüştürme ---
    stats = convert_all(downloaded_files, indir_konumlari)

    # --- 9. Rapor ---
    print_report(valid_years, excel_ana_dir, stats)


if __name__ == "__main__":
    main()
