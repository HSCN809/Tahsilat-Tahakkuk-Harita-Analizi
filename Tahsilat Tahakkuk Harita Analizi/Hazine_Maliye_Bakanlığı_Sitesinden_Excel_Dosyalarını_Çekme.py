import os
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
xlrd.biffh.unicode = lambda b, enc: b.decode(enc, 'replace')
xlrd.book.unicode = lambda b, enc: b.decode(enc, 'replace')
xlrd.formatting.unicode = lambda b, enc: b.decode(enc, 'replace')

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
    Tek bir .xls dosyasını .xlsx formatına dönüştürür ve orijinalini siler.
    """
    base_name = os.path.basename(xls_file)
    try:
        cleaned_name = clean_and_format_filename(base_name, year)
        if cleaned_name:
            xlsx_path = indir_konumu / cleaned_name
            # Yamalanmış xlrd motoru ile dosyayı oku
            df = pd.read_excel(xls_file, engine='xlrd')
            df.to_excel(xlsx_path, index=False)
            print(f"   Dönüştürüldü: {base_name} -> {cleaned_name}")
        
        # Orijinal .xls dosyasını temizle
        os.remove(xls_file)
    except Exception as e:
        print(f"❌ Dönüştürme hatası ({base_name}): {e}")

def parse_years_input(input_str, current_year):
    """
    Yil veya yil araligini cozumler.
    Ornek: 2023 -> [2023]
    Ornek: 2022-2025 -> [2022, 2023, 2024, 2025]
    Ornek: 2020, 2023 -> [2020, 2023]
    """
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
                
    valid_years = [y for y in sorted(list(set(years))) if 2004 <= y <= current_year]
    return valid_years

def main():
    print("🗓️ Hangi yılın/yılların verilerini indirmek istiyorsunuz?")
    current_year = datetime.date.today().year
    print(f"📝 Mevcut yıllar: 2004-{current_year} arası")
    print("💡 Giriş formatları: '2023' veya '2022-2025' veya '2020, 2022, 2024'")
    year_input = input("➡️ Yıl girin: ").strip()

    valid_years = parse_years_input(year_input, current_year)

    if not valid_years:
        print(f"❌ Hata: Geçerli bir yıl veya yıl aralığı girin (2004-{current_year})!")
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
        os.makedirs(path, exist_ok=True)
        indir_konumlari[y] = path

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
    print("\n🤖 Tarayıcı başlatılıyor (Linkler toplanıyor)...")
    driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    wait = WebDriverWait(driver, 20)
    all_links_data = [] # (link_text, href, year)

    try:
        for y in valid_years:
            print(f"\n🌐 {y} yılı verileri için siteye bağlanılıyor...")
            driver.get("https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-2026")
            time.sleep(3)
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
            
            print(f"🔍 {y} yılı ana başlığı aranıyor...")
            year_main_found = False
            
            try:
                # Etiket bağımsız ve alternatif Türkçe karakter varyasyonları ile arama yapılıyor
                year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y} Yılı Genel Bütçe Gelirlerinin İller İtibarıyla Tahakkuk ve Tahsilatı') or contains(text(), '{y} Yılı Genel Bütçe Gelirlerinin İller İtibariyle Tahakkuk ve Tahsilatı')]")
                if not year_main_elements:
                    year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y} Yılı Genel Bütçe')]")
                if not year_main_elements:
                    year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y} Yılı')]")
                if not year_main_elements:
                    year_main_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{y}')]")
                    
                for element in year_main_elements:
                    if element.is_displayed():
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
                    # Hangi yıla ait olduğunu klasör isminden çıkar
                    parent_name = file_path.parent.name
                    year_match = re.search(r"\d{4}", parent_name)
                    file_year = year_match.group(0) if year_match else str(current_year)
                    downloaded_files.append((file_path, file_year))
                    
        download_duration = time.time() - start_time
        print(f"⏱️ Tüm indirmeler {download_duration:.2f} saniyede tamamlandı.")
        
        # Dönüştürme Aşaması (Paralel)
        print("\n🔄 Dosya biçimleri paralel olarak dönüştürülüyor (Excel conversion)...")
        conversion_start = time.time()
        
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [
                executor.submit(convert_file, filepath, file_year, indir_konumlari[int(file_year)])
                for filepath, file_year in downloaded_files
            ]
            for future in as_completed(futures):
                pass
                
        conversion_duration = time.time() - conversion_start
        print(f"⏱️ Dönüştürme {conversion_duration:.2f} saniyede tamamlandı.")
        
        # Sonuç özeti
        print(f"\n{'='*60}")
        print("🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!")
        print(f"📊 İndirilen ve Dönüştürülen Yıllar: {', '.join(map(str, valid_years))}")
        print(f"📁 Dosyaların Ana Konumu: {excel_ana_dir}")
        print(f"{'='*60}")
    else:
        print(f"❌ İndirilecek link bulunamadı.")

if __name__ == "__main__":
    main()
