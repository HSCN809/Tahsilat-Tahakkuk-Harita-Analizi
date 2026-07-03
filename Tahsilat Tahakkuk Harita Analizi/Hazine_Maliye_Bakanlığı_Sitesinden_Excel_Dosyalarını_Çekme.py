import os
import unicodedata
import time
import requests
import datetime
import re
import glob
import pandas as pd
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

# xlrd kütüphanesini Türkçe ve bozuk karakter hatalarını yok sayması için yamala (monkey patch)
import xlrd

def safe_decode(b, enc):
    try:
        return b.decode(enc, 'replace')
    except Exception:
        try:
            return b.decode('utf-8', 'replace')
        except Exception:
            return b.decode('latin1', 'replace')

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
    WAF/Cloudflare engellerini asmak icin tarayici basliklari (Headers) kullanir.
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
            
        print(f"   İndirildi ({idx}/{total}): {link_text}")
        return True, file_path
    except Exception as e:
        print(f"❌ İndirme Hatası ({link_text}): {e}")
        return False, None

def convert_file(xls_file, year, indir_konumu):
    """
    Tek bir .xls dosyasını il alt klasörüne aylık .xlsx dosyaları olarak dönüştürür.
    Ayrıca yıl klasörüne en güncel ayın (Aralık) tek dosyasını da kaydeder (geriye uyumluluk).
    
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
            os.remove(xls_file)
            return True, False, 0, 0
            
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
        for sheet in sheet_names:
            normalized = normalize_month_name(sheet)
            display_name = MONTH_DISPLAY_NAMES.get(normalized)
            
            if display_name:
                df = pd.read_excel(xls, sheet_name=sheet)
                month_xlsx_path = province_dir / f"{display_name}.xlsx"
                df.to_excel(month_xlsx_path, index=False)
                saved_months += 1
        
        # Geriye uyumluluk: en güncel ayı (Aralık) yıl klasörüne de kaydet
        best_sheet = get_best_sheet_name(sheet_names)
        df_best = pd.read_excel(xls, sheet_name=best_sheet)
        best_xlsx_path = indir_konumu / cleaned_name
        df_best.to_excel(best_xlsx_path, index=False)
        
        # ExcelFile handle'ını kapat (Windows dosya kilidi)
        xls.close()
        
        print(f"   Donusturuldu: {base_name} -> {province_folder_name}/ ({saved_months}/{expected_months} ay) + {cleaned_name}")
        
        # Orijinal .xls dosyasını temizle
        os.remove(xls_file)
        return True, True, saved_months, expected_months
    except Exception as e:
        print(f"[HATA] Donusturme hatasi ({base_name}): {e}")
        if os.path.exists(xls_file):
            try:
                os.remove(xls_file)
            except:
                pass
        expected = 5 if int(year) == current_year else 12
        return False, True, 0, expected

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

def main():
    # Chrome seçeneklerini yapılandır
    options = ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-extensions")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--headless=new")  # Arka planda calis
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)

    # WebDriver'ı başlat
    print("🤖 Tarayıcı başlatılıyor (Mevcut site yapısı analiz ediliyor)...")
    driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    wait = WebDriverWait(driver, 20)
    current_year = datetime.date.today().year

    # Doğru URL'yi dinamik olarak tespit et (Örn: 2004-2026 veya 2004-2028 vb.)
    target_url = None
    for temp_year in [current_year, current_year - 1, current_year - 2]:
        temp_url = f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{temp_year}"
        try:
            driver.get(temp_url)
            time.sleep(2)
            if "404" not in driver.title and len(driver.find_elements(By.XPATH, "//*[contains(text(), 'Genel Bütçe')]")) > 0:
                target_url = temp_url
                break
        except Exception:
            continue
            
    if not target_url:
        target_url = f"https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-{current_year}"

    # Sitedeki mevcut en küçük ve en büyük yılları dinamik topla
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
            except:
                pass
        if found_years:
            min_year = min(found_years)
            max_year = max(found_years)
    except Exception as e:
        print(f"⚠️ Yıl sınırları dinamik okunamadı, varsayılan değerler kullanılacak: {e}")

    # Kullanıcıdan dinamik yıllara göre veri al
    print("\n🗓️ Hangi yılın/yılların verilerini indirmek istiyorsunuz?")
    print(f"📝 Sitede mevcut yıllar: {min_year}-{max_year} arası")
    print("💡 Giriş formatları: '2023' veya '2022-2025' veya 'hepsi'")
    year_input = input("➡️ Yıl girin: ").strip()

    valid_years = parse_years_input(year_input, min_year, max_year)

    if not valid_years:
        print(f"❌ Hata: Geçerli bir yıl veya yıl aralığı girin ({min_year}-{max_year})!")
        driver.quit()
        return

    print(f"✅ Seçilen Yıllar: {', '.join(map(str, valid_years))}")

    # Proje yollarını dinamik belirle
    BASE_DIR = Path(__file__).resolve().parent.parent
    veriler_dir = BASE_DIR / "veriler"
    excel_ana_dir = veriler_dir / "Tahsilat Tahakkuk Excel Dosyaları"
    
    os.makedirs(veriler_dir, exist_ok=True)
    os.makedirs(excel_ana_dir, exist_ok=True)

    # Her yil icin indirme klasorlerini hazirla
    indir_konumlari = {}
    for y in valid_years:
        path = excel_ana_dir / f"İllere Göre Tahsilat Tahakkuk {y}"
        
        # Eğer klasör zaten varsa, içindeki tüm eski .xlsx ve .xls dosyalarını silerek temiz kurulum yap
        if path.exists():
            for old_file in path.glob("*"):
                if old_file.suffix in ('.xlsx', '.xls'):
                    try:
                        os.remove(old_file)
                    except:
                        pass
                        
        os.makedirs(path, exist_ok=True)
        indir_konumlari[y] = path

    all_links_data = [] # (link_text, href, year)

    try:
        for y in valid_years:
            print(f"\n🌐 {y} yılı verileri için siteye bağlanılıyor...")
            driver.get(target_url)
            time.sleep(3)
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
            
            print(f"🔍 {y} yılı ana başlığı aranıyor...")
            year_main_found = False
            
            try:
                # Sınıf adı 'submenu-control-init' olan ve yılı içeren elementleri bul
                year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(@class, 'submenu-control-init')][contains(text(), '{y}')]")
                visible_elements = [el for el in year_main_elements if el.is_displayed()]
                
                if not visible_elements:
                    # Çift boşluk veya farklı metin yapısı için yedek arama
                    alt_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y} Yılı') or contains(text(), '{y}  Yılı') or contains(text(), '{y}')]")
                    visible_elements = [el for el in alt_elements if el.is_displayed()]
                    
                for element in visible_elements:
                    print(f"🟢 {y} ana başlığı bulundu")
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                    time.sleep(1)
                    
                    try:
                        element.click()
                    except ElementClickInterceptedException:
                        driver.execute_script("arguments[0].click();", element)
                    
                    year_main_found = True
                    time.sleep(2)
                    break
            except Exception as e:
                print(f"Ana başlık arama hatası ({y}): {e}")
            
            if not year_main_found:
                print(f"❌ {y} yılı ana başlığı bulunamadı. Sayfada '{y}' içeren elementler listeleniyor:")
                try:
                    debug_els = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y}')]")
                    for idx, d_el in enumerate(debug_els[:5], 1):
                        try:
                            print(f"   [Debug {idx}] Tag: <{d_el.tag_name}> Class: '{d_el.get_attribute('class')}' Text: '{d_el.text.strip()[:60]}'")
                        except:
                            pass
                except Exception as de:
                    print(f"   Hata detayları alınamadı: {de}")
                print(f"❌ {y} yılı atlanıyor.")
                continue
            
            print(f"🔍 {y} - Bütçe Gelir Tabloları alt başlığı aranıyor...")
            budget_tables_found = False
            
            try:
                budget_elements = driver.find_elements(By.XPATH, "//a[contains(text(), 'Bütçe Gelir Tabloları')]")
                for element in budget_elements:
                    if element.is_displayed():
                        print(f"🟢 Bütçe Gelir Tabloları alt başlığı bulundu")
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                        time.sleep(1)
                        
                        try:
                            element.click()
                        except ElementClickInterceptedException:
                            driver.execute_script("arguments[0].click();", element)
                        
                        budget_tables_found = True
                        time.sleep(2)
                        break
            except Exception as e:
                print(f"Alt başlık arama hatası ({y}): {e}")
            
            if not budget_tables_found:
                print(f"❌ {y} için Bütçe Gelir Tabloları bulunamadı, bu yıl atlanıyor.")
                continue
            
            print(f"🔍 {y} yılı Excel dosyaları aranıyor...")
            excel_links = []
            
            # Excel linklerini topla
            xlsx_links = driver.find_elements(By.XPATH, "//a[contains(@href, '.xlsx') or contains(@href, '.xls')]")
            excel_links.extend(xlsx_links)
            
            excel_text_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Excel') or contains(text(), 'excel')]")
            excel_links.extend(excel_text_links)
            
            il_excel_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Adana') or contains(text(), 'Ankara') or contains(text(), 'İstanbul') or contains(text(), 'Merkezi') or contains(text(), 'İl ')]")
            for link in il_excel_links:
                href = link.get_attribute('href')
                if href and ('.xlsx' in href or '.xls' in href):
                    excel_links.append(link)
            
            # Tekilleştir ve listeye ekle
            seen_hrefs = set()
            year_links_count = 0
            for link in excel_links:
                href = link.get_attribute('href')
                if href and href not in seen_hrefs and link.is_displayed():
                    seen_hrefs.add(href)
                    link_text = link.text.strip() if link.text else f"Excel_{y}_{year_links_count+1}"
                    all_links_data.append((link_text, href, y))
                    year_links_count += 1
            print(f"📊 {y} yılı için {year_links_count} Excel linki toplandı.")
            
    except TimeoutException:
        print("❌ Hata: Sayfa yükleme zaman aşımına uğradı!")
    except Exception as e:
        print(f"❌ Genel Hata: {e}")
    finally:
        print("\n🏁 Tarayıcı kapatılıyor...")
        driver.quit()
        print("✅ Tarayıcı kapatıldı.")

    # İndirme aşaması (Paralel)
    if all_links_data:
        print(f"\n🚀 Toplam {len(all_links_data)} adet Excel linki bulundu.")
        print("📥 Paralel indirme başlatılıyor (max_workers=10)...")
        
        downloaded_files = [] # (file_path, year)
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
                    
        download_duration = time.time() - start_time
        print(f"⏱️ Tüm indirmeler {download_duration:.2f} saniyede tamamlandı.")
        
        # Dönüştürme Aşaması (Paralel)
        print("\n🔄 Dosya biçimleri paralel olarak dönüştürülüyor (Excel conversion)...")
        conversion_start = time.time()
        
        total_provinces_expected = 0
        total_provinces_converted = 0
        total_months_expected = 0
        total_months_converted = 0
        
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [
                executor.submit(convert_file, filepath, file_year, indir_konumlari[int(file_year)])
                for filepath, file_year in downloaded_files
            ]
            for future in as_completed(futures):
                res = future.result()
                if res:
                    success, is_province, saved, expected = res
                    if is_province:
                        total_provinces_expected += 1
                        total_months_expected += expected
                        if success:
                            total_provinces_converted += 1
                            total_months_converted += saved
                
        conversion_duration = time.time() - conversion_start
        print(f"⏱️ Dönüştürme {conversion_duration:.2f} saniyede tamamlandı.")
        
        # Sonuç özeti
        print(f"\n{'='*60}")
        print("🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!")
        print(f"📊 İndirilen ve Dönüştürülen Yıllar: {', '.join(map(str, valid_years))}")
        print(f"📁 Dosyaların Ana Konumu: {excel_ana_dir}")
        print(f"{'-'*60}")
        print(f"📈 SONUÇ RAPORU:")
        print(f"  - Beklenen İl Sayısı        : {total_provinces_expected}")
        print(f"  - Dönüştürülen İl Sayısı    : {total_provinces_converted}")
        print(f"  - Beklenen Toplam Ay Sayısı : {total_months_expected}")
        print(f"  - Çekilen Toplam Ay Sayısı  : {total_months_converted}")
        
        if total_months_expected > 0:
            basari_orani = (total_months_converted / total_months_expected) * 100
            print(f"  - Veri Başarı Oranı         : %{basari_orani:.2f}")
        print(f"{'='*60}")
        print(f"{'='*60}")
    else:
        print(f"❌ İndirilecek link bulunamadı.")

if __name__ == "__main__":
    main()
