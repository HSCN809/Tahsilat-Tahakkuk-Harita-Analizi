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

### Adım 2: Docker Compose ile Başlatma (Önerilen)
Tüm servisleri geliştirme profilinde derleyin ve arka planda çalışacak şekilde başlatın:
```powershell
docker compose -f docker-compose.dev.yml up -d --build --force-recreate
```

---

## 2. Manuel Çalıştırma (Docker Olmadan)

### 1. Backend (Rust Axum)
```powershell
cd backend
cargo run
```
* **API:** http://localhost:8080 veya http://localhost:8000

### 2. Frontend (React + Vite)
```powershell
cd frontend
npm install
npm run dev
```
* **Kullanıcı Arayüzü:** http://localhost:5173

---

## 3. Erişim Adresleri

* **Kullanıcı Arayüzü (React + Vite)**: [http://localhost:5173](http://localhost:5173)
* **Backend API**: [http://localhost:8000](http://localhost:8000) (veya Rust doğrudan portu 8080)
* **Sağlık Kontrolü**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 4. Geliştirme Testleri

### Yetkili Veri Çekme (Scrape) Testi
Yerelde veri çekme işlemini tetiklemek için aşağıdaki PowerShell komutunu çalıştırabilirsiniz:

```powershell
$token = (Get-Content .env | Select-String "SCRAPE_TOKEN=").Line.Split("=")[1].Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/scrape?year_input=2024" -Headers $headers
```

### Backend Testlerini Koşma
```powershell
cd backend
cargo test
```
