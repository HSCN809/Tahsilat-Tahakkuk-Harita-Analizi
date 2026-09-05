# Tahsilat-Tahakkuk-Harita-Analizi

İl bazında vergi gelirleri (tahsilat/tahakkuk) analizlerini harita ve grafiklerle
sunan hibrit tam yığın uygulama. Backend Rust (Axum), frontend React (Vite + Nginx), veri
toplayıcı Selenium tabanlı one-shot Python scraper.

## Dokümantasyon ve Kurulum

Projenin kurulumu ve çalıştırılması için aşağıdaki kılavuzları inceleyebilirsiniz:

*   **Yerel Geliştirme (Dev) Ortamı**: Detaylı kurulum adımları, portlar ve yerel test yönergeleri için [docs/DEV_ORTAMI.md](docs/DEV_ORTAMI.md) kılavuzuna bakın.
*   **Canlı Yayın (Production)**: Uygulama **Railway** bulut platformu üzerinde çalışmak üzere optimize edilmiştir. Railway'de backend ve frontend **manuel olarak ayrı birer servis** şeklinde oluşturulmalıdır; scraping işlemi Railway'de backend'in `/api/scrape` endpoint'i üzerinden önerilir. `docker-compose.prod.yml` Railway tarafından doğrudan okunmaz. Detaylı kurulum adımları için aşağıdaki [Railway Deployment](#railway-deployment) bölümüne bakın.

## Railway Deployment

### ⚠️ Önemli: Railway docker-compose'u çoklu servis olarak deploy ETMEZ

Railway, `docker-compose.prod.yml` dosyasını **doğrudan okumaz** ve bu repodaki
çoklu servis yapısını (backend, frontend, scraper) otomatik olarak deploy
edemez. `docker-compose.prod.yml` üretim/Railway-referans compose dosyası,
`docker-compose.dev.yml` ise yerel geliştirme/test amaçlıdır.

Railway'de **her bir servis ayrı ayrı manuel olarak oluşturulmalıdır**.
Railway projenize GitHub reponuzu bağladıktan sonra Backend ve Frontend servislerini
Dashboard üzerinden ilgili Dockerfile yollarını (`backend/Dockerfile`, `frontend/Dockerfile`)
belirterek tanımlamanız gerekir.

Her servis için aşağıdaki adımları sırasıyla uygulayın.

---

### 1. Backend Servisi

Backend servisini Railway Dashboard üzerinden oluşturun (New Service > GitHub Repo):

- **Kaynak**: GitHub reposu
- **Root Directory**: `/` (repo kökü)
- **Dockerfile Path**: `backend/Dockerfile`
- **Health Check Path**: `/health` veya `/healthz` (auth gerektirmez)
- **Port**: `8080` (Railway `PORT` env değişkenini otomatik atar; backend varsayılan olarak 8080 kullanır)
- **Ortam Değişkenleri**: Railway Dashboard > Servis > Variables sekmesinden
  aşağıdaki değişkenleri tanımlayın (`.env.prod.example` referans alınabilir):

| Değişken | Açıklama | Örnek |
|---|---|---|
| `ALLOWED_ORIGINS` | CORS izin verilen origin'ler (virgülle) | `https://tahsilat.example.com` |
| `SCRAPE_TOKEN` | `/api/scrape` için Bearer token | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `BACKUP_DIR` | Snapshot yedek dizini (örn. `/app/veriler/backups`) | `/app/veriler/backups` |

- **Volume**: Railway'de kalıcı veri için **tek bir Volume** tanımlayın ve mount
  path olarak **`/app/veriler`** dizinini kullanın. ⚠️ **Kesinlikle `/app` mount
  etmeyin** — boş volume uygulama kodunun üzerine yazar, container başlatılamaz.
  `/app/veriler` mount path'i hem verileri hem de `BACKUP_DIR` içindeki yedekleri
  aynı volume üzerinde tutar. Aksi takdirde veriler container yeniden başladığında
  silinir.

---

### 2. Frontend Servisi (Manuel Oluşturulmalı)

Frontend için Railway Dashboard'da **yeni bir servis** oluşturun
(New Service > GitHub Repo > aynı repo):

- **Kaynak**: Aynı GitHub reposu (manuel seçin)
- **Root Directory**: `/` (repo kökü)
- **Dockerfile Path**: `frontend/Dockerfile` (Servis ayarları >
  Settings > Dockerfile Path)
- **Port**: `80` (Nginx'in dinlediği port — Railway `PORT` env değişkenini
  otomatik atar, Nginx bu portu dinleyecek şekilde yapılandırılmıştır)
- **Health Check Path**: `/healthz` (Nginx health check endpoint'i — 
  `frontend/nginx.conf` içinde tanımlıdır)
- **Ortam Değişkenleri**: Frontend statik olduğu için ek değişken gerekmez.
  Nginx yapılandırması `frontend/nginx.conf` içinde gömülüdür ve backend
  adresini `backend.railway.internal:8080` olarak çözümler.
- **Volume**: Gerekmez (statik servis).

---

### 3. Scraper (Önerilen Yöntem: Backend `/api/scrape` Endpoint'i)

Railway **tek bir volume'un birden fazla servis tarafından paylaşılmasını
desteklemez.** Bu nedenle, scraper'ı backend'den ayrı bir Railway servisi
olarak çalıştırıp aynı volume'u paylaşmak mümkün değildir.

**Önerilen yöntem:** Backend'in sunduğu `/api/scrape` endpoint'ini kullanın.
Bu endpoint (Rust Axum backend `handlers/scrape.rs` tarafından yönetilir) scraping işlemini
**backend container'ı içinde** (tek servis, tek volume) çalıştırır ve
indirilen veriler doğrudan backend'in bağlı olduğu volume'a yazılır.

```bash
curl -X POST "https://<railway-domain>/api/scrape?year_input=2024-2025" \
  -H "Authorization: Bearer $SCRAPE_TOKEN"
```

Bu yöntem için:
- Backend servisine bir volume tanımlanmış olması yeterlidir (`/app/veriler`).
- Ayrı bir scraper servisi oluşturmaya gerek yoktur.
- `SCRAPE_TOKEN` ortam değişkeni backend servisinde tanımlı olmalıdır.

**Alternatif (tamamen ayrı scraper servisi):** Scraper'ı backend'den bağımsız,
ayrı bir Railway servisi olarak çalıştırmak **yalnızca harici paylaşımlı
depolama (örn. S3)** ile mümkündür. Bu durumda hem backend hem scraper aynı
S3 bucket'ına okuma/yazma yapacak şekilde yapılandırılmalıdır. Mevcut
named-volume paylaşımı yaklaşımı Railway'de desteklenmez.

Yerel geliştirme/test için `docker-compose.prod.yml` içinde tanımlı scraper
servisi kullanılabilir (bkz. [Manuel Veri Çekme](#manuel-veri-çekme-scraping)).

---

### 4. Ortam Değişkenleri (Railway)

Railway, `.env.prod.example` dosyasını **otomatik okumaz**. Tüm ortam
değişkenlerini her servis için Railway Dashboard > Servis > Variables
sekmesinden manuel olarak tanımlamanız gerekir. Referans için
`.env.prod.example` dosyasına bakabilirsiniz; ancak bu dosya yalnızca
yerel `docker compose` testleri için kullanılır.

**Özet — Her servise tanımlanması gereken değişkenler:**

| Değişken | Backend | Frontend | Açıklama |
|---|---|---|---|---|
| `ALLOWED_ORIGINS` | ✅ | — | CORS izin verilen origin'ler |
| `SCRAPE_TOKEN` | ✅ | — | `/api/scrape` için Bearer token |
| `BACKUP_DIR` | ✅ | — | Snapshot yedek dizini (örn. `/app/veriler/backups`) |
| `SCRAPE_YEARS` | — | — | Yerel/manuel: one-shot scraper yıl aralığı |

---

### 5. Servisler Arası İletişim

Railway'de servisler birbirine **internal hostname** üzerinden erişir.
Frontend'in backend'e proxy yapabilmesi için `frontend/nginx.conf` dosyasında
`backend.railway.internal:8080` adresi kullanılır. Railway bu hostname'i
otomatik çözümler.

---

### 6. Hızlı Başlangıç Kontrol Listesi

1. [ ] Repoyu Railway'e bağlayın (GitHub entegrasyonu)
2. [ ] Backend servisini oluşturun (Dockerfile yolu: `backend/Dockerfile`, port: `8080`)
3. [ ] Backend servisine ortam değişkenlerini ekleyin (Variables)
4. [ ] Backend servisine volume tanımlayın (mount path: `/app/veriler`; hem veriler hem yedekler bu volume üzerinde yer alır)
5. [ ] Frontend servisini manuel oluşturun (Dockerfile yolu: `frontend/Dockerfile`, port: `80`)
6. [ ] Scraping için `/api/scrape` endpoint'inin çalıştığını doğrulayın (önerilen yöntem — bkz. bölüm 3)
7. [ ] Backend health check'in yeşil olduğunu doğrulayın (`/health`)
8. [ ] Frontend health check'in yeşil olduğunu doğrulayın (`/healthz`)

## Dizin Yapısı

```text
docker-compose.prod.yml     # Üretim / Railway-referans compose dosyası
docker-compose.dev.yml      # Geliştirme (Dev) ortamı compose dosyası
backend/
  Dockerfile                # Multi-stage Dockerfile (Rust derleme + Python/Selenium runtime)
  src/                      # Rust (Axum) API sunucusu kaynak kodları
  tests/                    # Entegrasyon ve API testleri
  tr.json                   # İl GeoJSON harita verisi
frontend/
  Dockerfile                # Multi-stage Dockerfile (Vite build + Nginx alpine)
  src/                      # React 19 (Vite, TypeScript, Tailwind) kaynak kodları
  nginx.conf                # Üretim Nginx reverse-proxy ve güvenlik yapılandırması
scraper/
  Dockerfile                # Bağımsız scraper container'ı (Selenium + Chromium)
  scraper.py                # Veri toplama ve indirme motoru
  excel_parser.py           # Excel parse etme ve SQLite aktarım modülü
docs/
  DEV_ORTAMI.md             # Geliştirme ortamı detaylı kurulum kılavuzu
```

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `ALLOWED_ORIGINS` | CORS izin verilen origin'ler (virgülle) | localhost |
| `SCRAPE_TOKEN` | `/api/scrape` için Bearer token (zorunlu) | — |
| `BACKUP_DIR` | Snapshot yedeğinin yazılacağı dizin | `/app/veriler/backups` |
| `PORT` | API sunucusu dinleme portu | 8080 |
| `HOST` | API sunucusu dinleme adresi | 0.0.0.0 |
| `DB_PATH` | SQLite veritabanı dosya yolu | `/app/veriler/tahsilat_tahakkuk.db` |
| `SCRAPE_YEARS` | One-shot scraper için yıl aralığı | hepsi |

## Manuel Veri Çekme (Scraping)

### Yerel/Docker Compose (Manuel Tetikleme)

Scraper sürekli çalışmaz; yalnızca siz tetiklersiniz. Bu yöntem yalnızca
yerel docker compose ortamında çalışır (Railway'de kullanılmaz):

```bash
./scripts/run-scraper.sh 2024-2025
# veya tüm yıllar:
./scripts/run-scraper.sh hepsi
```

Container işi bitirince otomatik silinir (`--rm`). Veriler `veriler_named`
volume'una yazılır; backend aynı volume'u paylaşır (docker compose aynı
volume'u iki servise bağlayabildiği için yerel ortamda çalışır).

### Yerel Production Testi

Production ortamını yerel olarak test etmek için:

```bash
cp .env.prod.example .env.prod   # değerleri doldur
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Railway / Production (API Endpoint ile)

Railway'de önerilen yöntem backend'in `/api/scrape` endpoint'ini kullanmaktır.
Bu yöntem tek servis, tek volume ile çalışır ve Railway'in volume paylaşım
kısıtlamasından etkilenmez:

```bash
curl -X POST "https://<domain>/api/scrape?year_input=2024-2025" \
  -H "Authorization: Bearer $SCRAPE_TOKEN"
```

İş durumu: `GET /api/jobs/status`. Aynı anda yalnızca bir scrape işi çalışır;
ikinci istek `409` döner.

## Yedekleme & Geri Yükleme

Her başarılı scrape işleminden **sonra** mevcut veriler tek bir snapshot dosyasına
yazılır (`veriler_backup_named` volume'u, `veriler-snapshot.tar.gz`). Yeni yedek
eski yedeğin **üzerine yazar** (rotasyon yok).

Snapshot'ı dışa aktarma:
```bash
docker run --rm -v veriler_backup_named:/backup -v $(pwd):/out alpine \
  cp /backup/veriler-snapshot.tar.gz /out/
```

Geri yükleme:
```bash
docker run --rm -v veriler_backup_named:/backup -v $(pwd):/out alpine \
  sh -c "cp /out/veriler-snapshot.tar.gz /backup/ && \
         cd /backup && tar xzf veriler-snapshot.tar.gz"
```

## Gözlemlenebilirlik & Loglama

- **Yapılandırılmış JSON Logları**: Rust backend `tracing-subscriber` ile JSON formatında (`level`, `message`, `target`) yapılandırılmış loglar üretir.
- **Docker & Railway Log Akışı**: Docker Compose ortamında `json-file` log sürücüsü (dosya başı 10MB, maksimum 5 dosya rotasyonu) kullanılır. Railway üzerinde stdout/stderr logları Railway Dashboard üzerinden canlı olarak izlenebilir.
- **Scraper & İş Takibi**: Scraper süreç çıktısı ve olası hatalar backend log akışında `[scraper]` ve `[scraper-err]` etiketleriyle eş zamanlı takip edilir; aktif iş durumu `GET /api/jobs/status` endpoint'i üzerinden sorgulanabilir.

## Güvenlik Notları

- Backend 8080 portu host'a **açık değildir**; yalnızca internal ağ veya nginx üzerinden erişilir.
- Rust Axum mimarisinde `tower-governor` ile IP tabanlı rate limiting uygulanır.
- OWASP uyumlu güvenlik başlıkları (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) tüm API yanıtlarına otomatik eklenir.
- `/api/scrape` endpoint'i Bearer token ile korunur; geçersiz veya eksik token durumunda `401`/`503` döner.
- Container image'ları non-root kullanıcı (`appuser`) ve `tini` init sistemi ile çalışır.

## Test & CI

```bash
# Backend testleri (Rust):
cd backend
cargo test

# Frontend lint ve derleme (React 19, TypeScript):
cd frontend
npm run lint
npm run build
```

GitHub Actions (`.github/workflows/ci.yml`):
- **backend**: Rust stabil toolchain üzerinde `cargo test` ile tüm birim ve entegrasyon testlerini koşar.
- **frontend**: Node.js 24 ortamında `oxlint` ile lint ve `vite build` ile üretim derlemesini doğrular.
- **compose-config**: `docker-compose.prod.yml` ve `docker-compose.dev.yml` dosyalarını `docker compose config --quiet` ile doğrular.
