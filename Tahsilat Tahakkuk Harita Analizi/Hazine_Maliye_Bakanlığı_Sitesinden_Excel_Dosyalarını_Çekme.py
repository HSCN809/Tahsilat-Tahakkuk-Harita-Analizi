import os
import time
import requests
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

def main():
    print("🗓️ Hangi yılın verilerini indirmek istiyorsunuz?")
    print("📝 Mevcut yıllar: 2004-2025 arası")
    year = input("➡️ Yıl girin (örn: 2023): ").strip()

    try:
        year_int = int(year)
        if year_int < 2004 or year_int > 2025:
            raise ValueError("Yıl aralık dışında.")
    except ValueError:
        print("❌ Hata: Geçerli bir yıl girin (2004-2025)!")
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
    options.add_experimental_option("prefs", {
        "download.default_directory": str(indir_konumu.resolve()),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": False,
        "safebrowsing.disable_download_protection": True,
        "plugins.always_open_pdf_externally": True
    })

    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-extensions")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--headless=new")  # Arka planda calis
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)

    # WebDriver'ı dinamik olarak başlat
    print("🤖 WebDriver başlatılıyor...")
    driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    wait = WebDriverWait(driver, 20)

    try:
        print("🌐 Siteye bağlanılıyor...")
        driver.get("https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-2019")
        time.sleep(3)
        
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        print("✅ Sayfa yüklendi")
        
        print(f"\n{'='*50}")
        print(f"📅 {year} YILI İŞLENİYOR")
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
        
        # Tekilleştir
        unique_links = []
        seen_hrefs = set()
        for link in excel_links:
            href = link.get_attribute('href')
            if href and href not in seen_hrefs and link.is_displayed():
                seen_hrefs.add(href)
                unique_links.append(link)
        
        excel_links = unique_links
        
        if excel_links:
            print(f"📊 {year} için {len(excel_links)} Excel dosyası bulundu")
            year_downloads = 0
            
            for idx, link in enumerate(excel_links, 1):
                try:
                    link_text = link.text.strip() if link.text else f"Excel_{year}_{idx}"
                    link_href = link.get_attribute('href')
                    
                    print(f"➡️ {year} - {idx}/{len(excel_links)} - {link_text}")
                    
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", link)
                    time.sleep(0.5)
                    
                    download_success = False
                    
                    # Yöntem 1: Tıklama
                    try:
                        current_windows = driver.window_handles
                        link.click()
                        time.sleep(1.5)
                        
                        new_windows = driver.window_handles
                        if len(new_windows) > len(current_windows):
                            driver.switch_to.window(new_windows[-1])
                            driver.close()
                            driver.switch_to.window(current_windows[0])
                        
                        download_success = True
                    except Exception:
                        pass
                    
                    # Yöntem 2: JavaScript
                    if not download_success:
                        try:
                            safe_filename = "".join(c for c in link_text if c.isalnum() or c in (' ', '-', '_')).rstrip()
                            if not safe_filename.endswith(('.xlsx', '.xls')):
                                safe_filename += '.xls'
                            
                            download_script = f"""
                            var link = arguments[0];
                            var downloadLink = document.createElement('a');
                            downloadLink.href = link.href;
                            downloadLink.download = '{safe_filename}';
                            downloadLink.target = '_self';
                            document.body.appendChild(downloadLink);
                            downloadLink.click();
                            document.body.removeChild(downloadLink);
                            """
                            driver.execute_script(download_script, link)
                            time.sleep(1.5)
                            download_success = True
                        except Exception:
                            pass
                    
                    # Yöntem 3: Requests
                    if not download_success:
                        try:
                            headers = {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
                            }
                            response = requests.get(link_href, headers=headers, timeout=30)
                            response.raise_for_status()
                            
                            safe_filename = "".join(c for c in link_text if c.isalnum() or c in (' ', '-', '_')).rstrip()
                            if not safe_filename.endswith(('.xlsx', '.xls')):
                                safe_filename += '.xls'
                            
                            file_path = indir_konumu / safe_filename
                            with open(file_path, 'wb') as file:
                                file.write(response.content)
                            download_success = True
                        except Exception as e:
                            print(f"❌ Tüm indirme yöntemleri başarısız: {e}")
                    
                    if download_success:
                        year_downloads += 1
                    time.sleep(0.5)
                    
                except Exception as e:
                    print(f"❌ Dosya indirme hatası: {e}")
                    continue
            
            print("⏳ İndirmelerin tamamlanması bekleniyor...")
            time.sleep(5)
            
            # .xls dosyalarını .xlsx formatına dönüştür ve isimlendir
            print("🔄 Dosya biçimleri dönüştürülüyor...")
            xls_files = glob.glob(os.path.join(indir_konumu, "*.xls"))
            
            for xls_file in xls_files:
                try:
                    base_name = os.path.basename(xls_file)
                    cleaned_name = clean_and_format_filename(base_name, year)
                    if cleaned_name:
                        xlsx_path = indir_konumu / cleaned_name
                        # xlrd motoru ile oku, openpyxl ile kaydet
                        df = pd.read_excel(xls_file, engine='xlrd')
                        df.to_excel(xlsx_path, index=False)
                        print(f"   Dönüştürüldü: {base_name} -> {cleaned_name}")
                    os.remove(xls_file)
                except Exception as e:
                    print(f"❌ Dönüştürme hatası ({base_name}): {e}")
                    
            print(f"\n{'='*60}")
            print(f"🎉 {year} YILI TAMAMLANDI!")
            print(f"📊 Toplam {year_downloads} dosya hazırlandı")
            print(f"📁 Konum: {indir_konumu}")
            print(f"{'='*60}")
        else:
            print(f"❌ {year} için Excel dosyası bulunamadı.")
            
    except TimeoutException:
        print("❌ Hata: Sayfa yükleme zaman aşımına uğradı!")
    except Exception as e:
        print(f"❌ Genel Hata: {e}")
    finally:
        print("🏁 Tarayıcı kapatılıyor...")
        driver.quit()
        print("✅ İşlem tamamlandı")

if __name__ == "__main__":
    main()
