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

## 2. Üretim (Prod) Ortamı ve Railway Canlı Yayın Kılavuzu

Uygulamanın canlı yayına alınması için **Railway** bulut platformu kullanılmaktadır. Railway, otomatik HTTPS (SSL) sertifikası sağlar ve GitHub deponuzu bağladığınızda kod değişikliklerini otomatik olarak yayına alır.

### Adım 1: GitHub Reposunu Hazırlama
Projenizi kendi GitHub hesabınızda özel (private) veya genel (public) bir depoya yükleyin.

### Adım 2: Railway Üzerinde Yeni Proje Oluşturma
1. [Railway.app](https://railway.app/) adresine gidin ve giriş yapın.
2. **New Project** -> **Deploy from GitHub repo** seçeneğini seçin ve bu projeyi içeren repoyu bağlayın.
3. Railway, kök dizindeki `docker-compose.prod.yml` dosyasını otomatik olarak algılayacaktır.
4. Railway projeyi iki ana servis olarak bölecektir: `backend` ve `frontend`.

### Adım 3: Ortam Değişkenlerini (Variables) Yapılandırma
Railway arayüzünde her servis için aşağıdaki çevresel değişkenleri tanımlayın:

#### Backend Servisi Değişkenleri:
*   `ALLOWED_ORIGINS`: `https://tahsilat-tahakkuk-analizi.up.railway.app` (Frontend servisinizin Railway üzerinde alacağı canlı URL adresi).
*   `SCRAPE_TOKEN`: Güçlü ve gizli bir API anahtarı (Scraper isteklerini doğrulamak için).
*   `BACKUP_DIR`: `/backups`

#### Frontend Servisi Değişkenleri:
Hiçbir değişkene gerek yoktur. Nginx gelen tüm `/api` isteklerini Railway iç ağı (private network) üzerinden otomatik olarak `http://backend:8000` adresine yönlendirir.

### Adım 4: Kalıcı Veri Depolama (Persistent Volume) Ekleme
Backend container'ı her yeniden başladığında verilerinizin silinmemesi için:
1. Railway panelinde **backend** servisine tıklayın.
2. **Settings** -> **Volumes** sekmesine gelin.
3. **Mount Volume** seçeneğine basarak yeni bir disk oluşturun.
4. Mount yolu (Mount Path) olarak `/app/veriler` yazın ve kaydedin.
5. (İsteğe bağlı) Yedekler için `/backups` yoluna ikinci bir disk mount edebilirsiniz.

### Adım 5: Canlı Adresi ve Erişim
*   **Canlı Uygulama**: Railway'in frontend servisine otomatik atadığı `https://<uygulama-adi>.up.railway.app` adresi üzerinden sisteme dünyanın her yerinden şifresiz ve güvenli (SSL) olarak erişilebilir.

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
