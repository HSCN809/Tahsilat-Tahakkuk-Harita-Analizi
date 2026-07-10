# Kurulum ve Çalıştırma Kılavuzu

Bu kılavuz, projenin **Geliştirme (Dev)** ve **Üretim (Prod)** ortamlarında nasıl kurulup çalıştırılacağını adım adım gösteren komutları içerir.

---

## 1. Geliştirme (Dev) Ortamı Kurulumu

Geliştirme ortamı yerel kod değişikliklerini anında yansıtmak (bind mount) ve kolayca test etmek için tasarlanmıştır.

### Adım 1: `.env` Dosyasını Oluşturma
Terminalde projenin kök dizinindeyken geliştirme çevresel değişkenlerini içeren `.env` dosyasını oluşturun.

Önce güçlü bir 32 karakterlik token üretmek için şu Python komutunu çalıştırabilirsiniz:
```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Ardından bu token değerini içeren `.env` dosyasını oluşturun (komut satırındaki `"dev-token"` yerine ürettiğiniz token değerini de yazabilirsiniz):
```powershell
# Windows PowerShell için:
New-Item -Path .env -ItemType File -Value "SCRAPE_TOKEN=dev-token"
```

### Adım 2: Docker Compose ile Başlatma
Uygulamayı sıfırdan derleyip başlatın:
```powershell
docker compose up -d --build --force-recreate
```

### Adım 3: Erişim Adresleri
*   **Frontend**: [http://localhost:5173](http://localhost:5173) (Kod değişiklikleri anında tarayıcıya yansır)
*   **Backend API**: [http://localhost:8000](http://localhost:8000)
*   **Swagger API Dokümantasyonu**: [http://localhost:8000/docs](http://localhost:8000/docs)

### Adım 4: Dev Ortamında Scrape Testi
Yetkilendirilmiş scrape isteğini tetiklemek için aşağıdaki PowerShell komutunu çalıştırabilirsiniz (token'ı `.env` dosyasından otomatik okur):
```powershell
# .env dosyasından token'ı otomatik okur ve header'a ekler
$token = (Get-Content .env | Select-String "SCRAPE_TOKEN=").Line.Split("=")[1].Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/scrape?year_input=2024" -Headers $headers
```

---

## 2. Üretim (Prod) Ortamı Kurulumu

Üretim ortamı TLS (Nginx üzerinden HTTPS), sınırlı kaynaklar, non-root güvenlik, log rotasyonu ve Grafana gözlemlenebilirliği içerir.

### Adım 1: `.env.prod` Değişkenlerini Tanımlama
Şablon dosyasını kopyalayın:
```powershell
Copy-Item .env.prod.example .env.prod
```

Güçlü şifreler ve token'lar üretmek için şu komutu kullanabilirsiniz:
```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

> [!IMPORTANT]
> [ .env.prod ](file:///c:/Users/ozenh/OneDrive/Desktop/Projelerim/Tahsilat-Tahakkuk-Harita-Analizi/.env.prod) dosyasını açarak `SCRAPE_TOKEN` ve `GRAFANA_PASSWORD` alanlarını yukarıda ürettiğiniz güçlü değerlerle güncelleyin.

### Adım 2: SSL Test Sertifikalarını Oluşturma
Nginx'in HTTPS üzerinden çalışabilmesi için test amaçlı self-signed sertifikaları Docker yardımıyla oluşturun:
```powershell
docker run --rm -v ${PWD}/certs:/certs alpine sh -c "apk add --no-cache openssl && openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj '/C=TR/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'"
```

### Adım 3: Docker Volume İzinlerini Düzenleme (Kritik)
Backend ve Scraper servisleri güvenli non-root kullanıcı (`appuser`) ile çalıştığından, Docker named volume dizin yetkilerinin verilmesi gerekir. Aksi halde `PermissionError` alınır.
Aşağıdaki komutları sırayla çalıştırın:
```powershell
# veriler_named volume yetkilerini güncelle
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --user root backend chown -R appuser:appuser /app/veriler

# veriler_backup_named volume yetkilerini güncelle
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --user root backend chown -R appuser:appuser /backups
```

> [!TIP]
> Yetim container (orphan) birikmesini önlemek için tek seferlik komutlarda `--rm` flag'i kullanılmıştır. Eğer sistemde eskiden kalan yetim container'lar varsa aşağıdaki komutla temizleyebilirsiniz:
> ```powershell
> docker compose -f docker-compose.prod.yml --env-file .env.prod down --remove-orphans
> ```

### Adım 4: Üretim Ortamını Başlatma
Tüm servisleri üretim profilinde ayağa kaldırın:
```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --force-recreate
```

### Adım 5: Erişim ve Kontrol
*   **Uygulama (Güvenli HTTPS)**: [https://localhost](https://localhost)
*   **Grafana Log Paneli**: [http://localhost:3000](http://localhost:3000) (Giriş: `admin` / `.env.prod` içinde belirlediğiniz şifre)
*   **Servis Durumları**:
    ```powershell
    docker compose -f docker-compose.prod.yml --env-file .env.prod ps
    ```
*   **Canlı Logları Takip Etme**:
    ```powershell
    docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
    ```

---

## 3. Yerel Testleri Çalıştırma (Pytest)

> [!WARNING]
> Bilgisayarınızdaki yerel Python sürümü **3.14+** ise eski pandas/numpy sürümleri derlenemeyebilir. Testleri yerelde koşmak için yerel Python sürümünüzün **3.11 veya 3.12** olması önerilir.

```powershell
# Eski sanal ortamı silin (varsa)
Remove-Item -Recurse -Force .\venv -ErrorAction SilentlyContinue

# Python 3.11 veya 3.12 ile temiz venv kurun
py -3.11 -m venv venv

# Geliştirme bağımlılıklarını yükleyin
.\venv\Scripts\pip install -r requirements-dev.txt

# Testleri çalıştırın
cd "Tahsilat Tahakkuk Harita Analizi"
..\venv\Scripts\pytest -v
```
