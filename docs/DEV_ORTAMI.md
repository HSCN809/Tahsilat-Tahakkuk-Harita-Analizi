# Geliştirme (Dev) Ortamı Kılavuzu

Bu kılavuz, uygulamanın yerel makinenizde geliştirme (dev) ortamında nasıl kurulacağını ve çalıştırılacağını adım adım açıklar.

---

## 1. Hazırlık ve Kurulum

### Adım 1: `.env` Dosyasını Oluşturma
Geliştirme ortamında veri çekme (scrape) endpoint'ini korumak için 32 karakterlik bir token üretmeniz gerekir.

Önce güçlü bir token üretmek için şu komutu çalıştırın:
```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Ardından kök dizinde bir `.env` dosyası oluşturun ve ürettiğiniz token'ı ekleyin:
```powershell
# Windows PowerShell için:
New-Item -Path .env -ItemType File -Value "SCRAPE_TOKEN=urettiginiz-token-degeri"
```

### Adım 2: Docker Compose ile Başlatma
Tüm servisleri geliştirme profilinde derleyin ve arka planda çalışacak şekilde başlatın:
```powershell
docker compose -f docker-compose.dev.yml up -d --build --force-recreate
```

---

## 2. Erişim Adresleri

Geliştirme ortamı başlatıldığında servisler şu adreslerden yayın yapar:

*   **Kullanıcı Arayüzü (React + Vite)**: [http://localhost:5173](http://localhost:5173) (Yerel kod değişiklikleriniz anında tarayıcıya yansır).
*   **Backend API**: [http://localhost:8000](http://localhost:8000)
*   **Swagger API Dokümantasyonu**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 3. Geliştirme Testleri

### Yetkili Veri Çekme (Scrape) Testi
Yerelde veri çekme işlemini tetiklemek için aşağıdaki PowerShell komutunu çalıştırabilirsiniz (token'ı `.env` dosyasından otomatik çeker):

```powershell
$token = (Get-Content .env | Select-String "SCRAPE_TOKEN=").Line.Split("=")[1].Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/scrape?year_input=2024" -Headers $headers
```

### Yerel Pytest Testlerini Koşma
Backend testlerini yerel makinenizde çalıştırmak için:

```powershell
# Python 3.11 veya 3.12 ile temiz bir sanal ortam kurun
py -3.11 -m venv venv
.\venv\Scripts\pip install -r requirements-dev.txt

# Testleri koşun
cd "Tahsilat Tahakkuk Harita Analizi"
..\venv\Scripts\pytest -v
```
