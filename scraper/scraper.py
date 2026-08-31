import argparse
import datetime
import logging
import os
import re
import shutil
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests
from selenium import webdriver
from selenium.common.exceptions import (
    ElementClickInterceptedException,
    TimeoutException,
)
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

import xlrd
try:
    from .excel_parser import FOLDER_NAME_TEMPLATE, safe_decode, export_all_to_sqlite
except ImportError:
    try:
        from scraper.excel_parser import FOLDER_NAME_TEMPLATE, safe_decode, export_all_to_sqlite
    except ImportError:
        from excel_parser import FOLDER_NAME_TEMPLATE, safe_decode, export_all_to_sqlite

xlrd.biffh.unicode = safe_decode
xlrd.book.unicode = safe_decode
xlrd.formatting.unicode = safe_decode



def normalize_month_name(name):
    """Ay adını normalize eder: combining marks, Türkçe karakterler ve büyük/küçük harf farkını kaldırır."""
    name = unicodedata.normalize('NFKD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = name.strip().lower()
    replacements = {
        'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c',
        'i̇': 'i',
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
    name = re.sub(r"\.xlsx?$", "", link_text, flags=re.IGNORECASE).strip()
    parts = re.split(r"[-_]", name)
    if len(parts) >= 3:
        code = parts[0].strip()
        file_year = parts[-1].strip()
        province_name = " ".join(parts[1:-1]).strip()
        province_name = province_name.replace(" ", "_")

        if code == "00" or "merkez" in province_name.lower():
            return None

        return f"{code}_{province_name}_{file_year}.xlsx"
    return None


def download_file(session, link_text, link_href, target_dir, idx, total):
    try:
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
    base_name = os.path.basename(xls_file)

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

        province_folder_name = "_".join(cleaned_name.replace(".xlsx", "").split("_")[:-1])
        province_dir = indir_konumu / province_folder_name
        os.makedirs(province_dir, exist_ok=True)

        xls = pd.ExcelFile(xls_file, engine='xlrd')
        sheet_names = xls.sheet_names

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

        xls.close()

        missing_months = []
        if saved_months < expected_months:
            all_standard_months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
            for m in all_standard_months:
                if m not in saved_month_names:
                    if int(year) == current_year and normalize_month_name(m) not in [normalize_month_name(sh) for sh in sheet_names]:
                        continue
                    missing_months.append(m)

        logger.info("Dönüştürüldü: %s -> %s/ (%d/%d ay)", base_name, province_folder_name, saved_months, expected_months)

        _archive_raw_xls(xls_file, indir_konumu)
        return True, True, saved_months, expected_months, int(year), province_folder_name, missing_months
    except Exception:
        logger.error("Dönüştürme hatası (%s)", base_name, exc_info=True)
        if os.path.exists(xls_file):
            try:
                _archive_raw_xls(xls_file, indir_konumu)
            except Exception:
                logger.debug(".xls dosyası arşivlenemedi: %s", xls_file, exc_info=True)
        expected = 5 if int(year) == current_year else 12
        return False, True, 0, expected, int(year), os.path.basename(xls_file), []


def _archive_raw_xls(xls_file, indir_konumu):
    raw_dir = indir_konumu / "raw_xls"
    os.makedirs(raw_dir, exist_ok=True)
    base_name = os.path.basename(xls_file)
    dest = raw_dir / base_name
    if os.path.exists(dest):
        os.remove(dest)
    shutil.move(str(xls_file), str(dest))


def parse_years_input(input_str, min_year, max_year):
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

    return [y for y in sorted(set(years)) if min_year <= y <= max_year]


def setup_driver():
    options = ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-extensions")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--headless=new")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)

    chrome_bin = os.environ.get("CHROME_BIN", "/usr/bin/chromium")
    chromedriver_path = os.environ.get("CHROMEDRIVER_PATH", "/usr/bin/chromedriver")
    if os.path.exists(chrome_bin):
        options.binary_location = chrome_bin

    logger.info("Tarayıcı başlatılıyor...")
    service = ChromeService(chromedriver_path) if os.path.exists(chromedriver_path) else ChromeService()
    driver = webdriver.Chrome(service=service, options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return driver


def discover_url(driver, current_year):
    for temp_year in [current_year, current_year - 1, current_year - 2]:
        temp_url = f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{temp_year}"
        try:
            driver.get(temp_url)
            time.sleep(2)
            if "404" not in driver.title and len(driver.find_elements(By.XPATH, "//*[contains(text(), 'Genel Bütçe')]")) > 0:
                return temp_url
        except Exception:
            continue
    return f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{current_year}"


def detect_year_bounds(driver, current_year):
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
                continue
        if found_years:
            min_year = min(found_years)
            max_year = max(found_years)
    except Exception:
        logger.warning("Yıl sınırları dinamik okunamadı, varsayılanlar kullanılacak", exc_info=True)
    return min_year, max_year


def prepare_download_dirs(valid_years, excel_ana_dir):
    indir_konumlari = {}
    for y in valid_years:
        if excel_ana_dir.exists():
            for d in os.listdir(excel_ana_dir):
                m = re.search(r"(\d{4})", d)
                if m and int(m.group(1)) == y:
                    p = excel_ana_dir / d
                    try:
                        shutil.rmtree(p)
                    except Exception:
                        pass

        path = excel_ana_dir / FOLDER_NAME_TEMPLATE.format(year=y)
        os.makedirs(path, exist_ok=True)
        indir_konumlari[y] = path
    return indir_konumlari


def _find_and_click_year_header(driver, wait, y):
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
                logger.error("%s için Bütçe Gelir Tabloları bulunamadı, atlanıyor.", y)
                continue

            logger.info("%s yılı Excel dosyaları aranıyor...", y)
            year_links = _collect_excel_links(driver, y)
            all_links_data.extend(year_links)
            logger.info("%s yılı için %d Excel linki toplandı.", y, len(year_links))
    except TimeoutException:
        logger.error("Sayfa yükleme zaman aşımına uğradı!")
    except Exception:
        logger.error("Genel link toplama hatası", exc_info=True)
    return all_links_data


def download_all(all_links_data, indir_konumlari, current_year):
    logger.info("Toplam %d adet Excel linki bulundu. Paralel indirme başlatılıyor...", len(all_links_data))
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
    logger.info("Dosya biçimleri paralel olarak dönüştürülüyor...")
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
    total_provinces_expected = stats["total_provinces_expected"]
    total_provinces_converted = stats["total_provinces_converted"]
    total_months_expected = stats["total_months_expected"]
    total_months_converted = stats["total_months_converted"]
    missing_data_list = stats["missing_data_list"]

    print(f"\n{'='*80}")
    print("🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!")
    print(f"📊 İndirilen ve Dönüştürülen Yıllar: {', '.join(map(str, valid_years))}")
    print(f"📁 Dosyaların Ana Konumu: {excel_ana_dir}")
    print(f"{'-'*80}")
    print("📈 SONUÇ RAPORU:")
    print(f"  - Beklenen / Dönüştürülen İl : {total_provinces_converted} / {total_provinces_expected}")
    print(f"  - Çekilen / Beklenen Ay       : {total_months_converted} / {total_months_expected}")

    if total_months_expected > 0:
        basari_orani = (total_months_converted / total_months_expected) * 100
        print(f"  - Veri Başarı Oranı           : %{basari_orani:.2f}")

    if missing_data_list:
        print(f"{'-'*80}")
        print("⚠️ EKSİK VEYA ÇEKİLEMEYEN AYLIK VERİ DETAYLARI:")
        for y_val, prov_name, months in sorted(missing_data_list, key=lambda x: (x[0], x[1])):
            months_str = ", ".join(months)
            print(f"  - Yıl: {y_val} | İl: {prov_name:<20} | Eksik Aylar: [{months_str}]")

    print(f"{'='*80}")


def main():
    parser = argparse.ArgumentParser(description="HMB vergi gelirleri Excel scraper ve SQLite ETL aracı")
    parser.add_argument(
        "years",
        nargs="?",
        default=None,
        help="Yıl/yıl aralığı (örn: 2024, 2024-2025, hepsi). Ortam değişkeni SCRAPE_YEARS da okunur."
    )
    parser.add_argument(
        "--etl-only",
        action="store_true",
        help="Web kazıma yapmadan sadece mevcut Excel dosyalarını SQLite veritabanına aktarır."
    )
    args = parser.parse_args()

    year_input = args.years or os.environ.get("SCRAPE_YEARS", "").strip() or "hepsi"

    BASE_DIR = Path(__file__).resolve().parent.parent
    veriler_dir = BASE_DIR / "veriler"
    excel_ana_dir = veriler_dir / "Tahsilat Tahakkuk Excel Dosyaları"
    os.makedirs(veriler_dir, exist_ok=True)
    os.makedirs(excel_ana_dir, exist_ok=True)

    if args.etl_only:
        logger.info("ETL modu devrede: Sadece Excel -> SQLite aktarımı yapılıyor...")
        target_years = None
        if year_input != "hepsi":
            min_y, max_y = 2004, datetime.date.today().year
            target_years = parse_years_input(year_input, min_y, max_y)
        export_all_to_sqlite(target_years)
        return

    current_year = datetime.date.today().year

    # 1. Driver başlat
    driver = setup_driver()
    wait = WebDriverWait(driver, 20)

    try:
        target_url = discover_url(driver, current_year)
        min_year, max_year = detect_year_bounds(driver, current_year)
        logger.info("Sitede mevcut yıllar: %d-%d arası", min_year, max_year)

        valid_years = parse_years_input(year_input, min_year, max_year)
        if not valid_years:
            logger.error("Geçerli bir yıl bulunamadı (%s)", year_input)
            return

        logger.info("Seçilen Yıllar: %s", ', '.join(map(str, valid_years)))
        indir_konumlari = prepare_download_dirs(valid_years, excel_ana_dir)

        all_links_data = collect_links(driver, wait, target_url, valid_years)
    finally:
        logger.info("Tarayıcı kapatılıyor...")
        driver.quit()
        logger.info("Tarayıcı kapatıldı.")

    if not all_links_data:
        logger.error("İndirilecek link bulunamadı.")
        return

    downloaded_files = download_all(all_links_data, indir_konumlari, current_year)
    stats = convert_all(downloaded_files, indir_konumlari)
    print_report(valid_years, excel_ana_dir, stats)

    # 2. Otomatik SQLite ETL aktarımı
    logger.info("Excel verileri SQLite veritabanına aktarılıyor...")
    export_all_to_sqlite(valid_years)


if __name__ == "__main__":
    main()

