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
    Ornek: 03-Afyon Karahisar-2022.xls -> 03_Afyon_Karahisar_2022.xlsx
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
    WAF/Cloudflare ve rate-limit engellerini asmak icin tarayici basliklari (Headers) kullanir.
    """
    try:
        # Guvenli dosya adi olustur
        safe_filename = "".join(c for c in link_text if c.isalnum() or c in (' ', '-', '_')).rstrip()
        if not safe_filename.endswith(('.xlsx', '.xls')):
            safe_filename += '.xls'
        
        file_path = target_dir / safe_filename
        
        # Tarayıcı taklidi yapan basliklar
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://muhasebat.hmb.gov.tr/',
            'Connection': 'keep-alive'
        }
        
        # Dosyayı indir
        response = session.get(link_href, headers=headers, timeout=20)
        response.raise_for_status()
        
        with open(file_path, 'wb') as file:
            file.write(response.content)
            
        print(f"✅ İndirildi ({idx}/{total}): {link_text}")
        return True, file_path
    except Exception as e:
        print(f"❌ İndirme Hatası ({link_text}): {e}")
        return False, None

def main():
    print("🗓️ Hangi yılın verilerini indirmek istiyorsunuz?")
    current_year = datetime.date.today().year
    print(f"📝 Mevcut yıllar: 2004-{current_year} arası")
    year = input("➡️ Yıl girin (örn: 2023): ").strip()

    try:
        year_int = int(year)
        if year_int < 2004 or year_int > current_year:
            raise ValueError("Yıl aralık dışında.")
    except ValueError:
        print(f"❌ Hata: Geçerli bir yıl girin (2004-{current_year})!")
        return

    print(f"✅ {year} yılı seçildi")

    # Proje yolunu dinamik belirle
    BASE_DIR = Path(__file__).resolve().parent.parent
    veriler_dir = BASE_DIR / "veriler"
    
    if not veriler_dir.exists():
        os.makedirs(veriler_dir, exist_ok=True)
        
    excel_ana_dir = veriler_dir / "Tahsilat Tahakkuk Excel Dosyaları"
    os.makedirs(excel_ana_dir, exist_ok=True)
    
    indir_konumu = excel_ana_dir / f"İllere Göre Tahsilat Tahakkuk {year}"
    os.makedirs(indir_konumu, exist_ok=True)

    print(f"📁 İndirme konumu: {indir_konumu}")

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

    # WebDriver'ı dinamik olarak başlat
    print("🤖 Tarayıcı başlatılıyor (Linkler toplanıyor)...")
    driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    wait = WebDriverWait(driver, 20)
    links_data = []

    try:
        print("🌐 Siteye bağlanılıyor...")
        driver.get("https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-2026")
        time.sleep(3)
        
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        print("✅ Sayfa yüklendi")
        
        print(f"\n{'='*50}")
        print(f"📅 {year} YILI LİNKLERİ TOPLANIYOR")
        print(f"{'='*50}")
        
        print(f"🔍 {year} yılı ana başlığı aranıyor...")
        year_main_found = False
        
        try:
            year_main_elements = driver.find_elements(By.XPATH, f"//a[contains(text(), '{year} Yılı Genel Bütçe Gelirlerinin İller İtibarıyla Tahakkuk ve Tahsilatı')]")
            for element in year_main_elements:
                if element.is_displayed():
                    print(f"🟢 {year} ana başlığı bulundu")
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
            print(f"Ana başlık arama hatası: {e}")
        
        if not year_main_found:
            raise RuntimeError(f"{year} ana başlığı bulunamadı!")
        
        print(f"✅ {year} ana başlığı açıldı")
        
        print(f"🔍 {year} - Bütçe Gelir Tabloları alt başlığı aranıyor...")
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
            print(f"Alt başlık arama hatası: {e}")
        
        if not budget_tables_found:
            raise RuntimeError(f"{year} için Bütçe Gelir Tabloları bulunamadı!")
        
        print(f"✅ {year} - Bütçe Gelir Tabloları açıldı")
        
        print(f"🔍 Excel dosyaları aranıyor...")
        excel_links = []
        
        # Linkleri bul
        xlsx_links = driver.find_elements(By.XPATH, "//a[contains(@href, '.xlsx') or contains(@href, '.xls')]")
        excel_links.extend(xlsx_links)
        
        excel_text_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Excel') or contains(text(), 'excel')]")
        excel_links.extend(excel_text_links)
        
        il_excel_links = driver.find_elements(By.XPATH, "//a[contains(text(), 'Adana') or contains(text(), 'Ankara') or contains(text(), 'İstanbul') or contains(text(), 'Merkezi') or contains(text(), 'İl ')]")
        for link in il_excel_links:
            href = link.get_attribute('href')
            if href and ('.xlsx' in href or '.xls' in href):
                excel_links.append(link)
        
        # Tekilleştir ve verileri çıkar
        seen_hrefs = set()
        for link in excel_links:
            href = link.get_attribute('href')
            if href and href not in seen_hrefs and link.is_displayed():
                seen_hrefs.add(href)
                link_text = link.text.strip() if link.text else f"Excel_{year}_{len(links_data)+1}"
                links_data.append((link_text, href))
                
    except TimeoutException:
        print("❌ Hata: Sayfa yükleme zaman aşımına uğradı!")
    except Exception as e:
        print(f"❌ Genel Hata: {e}")
    finally:
        print("🏁 Tarayıcı kapatılıyor...")
        driver.quit()
        print("✅ Tarayıcı kapatıldı.")

    # İndirme aşaması (Paralel)
    if links_data:
        print(f"\n🚀 {len(links_data)} adet Excel linki bulundu.")
        print("📥 Paralel indirme başlatılıyor (max_workers=10)...")
        
        downloaded_files = []
        session = requests.Session()
        
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [
                executor.submit(download_file, session, text, href, indir_konumu, idx, len(links_data))
                for idx, (text, href) in enumerate(links_data, 1)
            ]
            
            for future in as_completed(futures):
                success, file_path = future.result()
                if success and file_path:
                    downloaded_files.append(file_path)
                    
        download_duration = time.time() - start_time
        print(f"⏱️ İndirmeler {download_duration:.2f} saniyede tamamlandı.")
        
        # .xls dosyalarını .xlsx formatına dönüştür ve isimlendir
        xls_files = glob.glob(os.path.join(indir_konumu, "*.xls"))
        if xls_files:
            print("\n🔄 Dosya biçimleri dönüştürülüyor (Excel conversion)...")
            conversion_start = time.time()
            
            for xls_file in xls_files:
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
                    print(f"❌ Dönüştürme hatası ({os.path.basename(xls_file)}): {e}")
                    
            conversion_duration = time.time() - conversion_start
            print(f"⏱️ Dönüştürme {conversion_duration:.2f} saniyede tamamlandı.")
            
        print(f"\n{'='*60}")
        print(f"🎉 {year} YILI TAMAMLANDI!")
        print(f"📊 Toplam {len(downloaded_files)} dosya hazırlandı.")
        print(f"📁 Konum: {indir_konumu}")
        print(f"{'='*60}")
    else:
        print(f"❌ İndirilecek link bulunamadı.")

if __name__ == "__main__":
    main()
