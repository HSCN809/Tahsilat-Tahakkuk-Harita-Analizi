# Tahsilat-Tahakkuk-Harita-Analizi

İl bazında vergi gelirleri (tahsilat/tahakkuk) analizlerini harita ve grafiklerle
sunan tam yığın uygulama. Backend FastAPI, frontend React (Vite + Nginx), veri
toplayıcı Selenium tabanlı bir one-shot scraper.

## Dokümantasyon ve Kurulum

Projenin kurulumu ve çalıştırılması için aşağıdaki kılavuzları inceleyebilirsiniz:

*   **Yerel Geliştirme (Dev) Ortamı**: Detaylı kurulum adımları, portlar ve yerel test yönergeleri için [docs/DEV_ORTAMI.md](file:///c:/Users/ozenh/OneDrive/Desktop/Projelerim/Tahsilat-Tahakkuk-Harita-Analizi/docs/DEV_ORTAMI.md) kılavuzuna bakın.
*   **Canlı Yayın (Production)**: Uygulama **Railway** bulut platformu üzerinde çalışmak üzere optimize edilmiştir. Railway'de backend ve frontend **manuel olarak ayrı birer servis** şeklinde oluşturulmalıdır; scraping işlemi Railway'de backend'in `/api/scrape` endpoint'i üzerinden önerilir. `docker-compose.yml` Railway tarafından doğrudan okunmaz. Detaylı kurulum adımları için aşağıdaki [Railway Deployment](#railway-deployment) bölümüne bakın.

## Railway Deployment

### ⚠️ Önemli: Railway docker-compose'u çoklu servis olarak deploy ETMEZ

Railway, `docker-compose.yml` dosyasını **doğrudan okumaz** ve bu repodaki
çoklu servis yapısını (backend, frontend, scraper) otomatik olarak deploy
edemez. `docker-compose.yml` üretim/Railway-referans compose dosyası,
`docker-compose.dev.yml` ise yerel geliştirme/test amaçlıdır.

Railway'de **her bir servis ayrı ayrı manuel olarak oluşturulmalıdır**.
Repo kökündeki `railway.toml` dosyası yalnızca **backend** servisini tanımlar;
Railway bu repoyu GitHub'a bağladığınızda yalnızca backend servisini otomatik
algılar. Frontend ve scraper için Dashboard üzerinden ek servisler tanımlamanız
gerekir.

Her servis için aşağıdaki adımları sırasıyla uygulayın.

---

### 1. Backend Servisi (Otomatik Algılanır)

Repo kökündeki `railway.toml` dosyası sayesinde backend servisi, repoyu Railway'e
bağladığınızda otomatik olarak algılanır. Aşağıdaki ayarları kontrol edin:

- **Kaynak**: GitHub reposu (otomatik)
- **Root Directory**: `/` (repo kökü — Railway otomatik belirler)
- **Dockerfile Path**: `backend.Dockerfile` (`railway.toml` içinde tanımlı)
- **Health Check Path**: `/health` veya `/healthz` (auth gerektirmez,
  `railway.toml` içinde tanımlı)
- **Port**: `8080` (iç port — Railway `PORT` env değişkenini otomatik atar,
  ancak `backend.Dockerfile` varsayılan olarak 8080 kullanır)
- **Ortam Değişkenleri**: Railway Dashboard > Servis > Variables sekmesinden
  aşağıdaki değişkenleri tanımlayın (`.env.prod.example` referans alınabilir,
  ancak Railway bu dosyayı **otomatik okumaz**):

| Değişken | Açıklama | Örnek |
|---|---|---|
| `ALLOWED_ORIGINS` | CORS izin verilen origin'ler (virgülle) | `https://tahsilat.example.com` |
| `SCRAPE_TOKEN` | `/api/scrape` için Bearer token | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `BACKUP_DIR` | Snapshot yedek dizini (örn. `/app/backups`) | `/app/backups` |
| `WORKERS` | Uvicorn worker sayısı | `2` |

- **Volume**: Railway'de kalıcı veri için **tek bir Volume** tanımlayın ve mount
  path olarak **`/app`** dizinini kullanın. Railway tek bir volume'un birden fazla
  mount path'e bağlanmasını desteklemez. `/app` mount path'i sayesinde hem
  `/app/veriler` (veri dizini) hem de `/app/backups` (yedek dizini) aynı volume
  üzerinde yer alır. Aksi takdirde veriler container yeniden başladığında silinir.

---

### 2. Frontend Servisi (Manuel Oluşturulmalı)

Frontend için Railway Dashboard'da **yeni bir servis** oluşturun
(New Service > GitHub Repo > aynı repo):

- **Kaynak**: Aynı GitHub reposu (manuel seçin)
- **Root Directory**: `/` (repo kökü) — Railway'in Dockerfile'ı bulabilmesi
  için root directory'yi repo kökü olarak bırakın veya servis ayarlarından
  Dockerfile path'i mutlak yol olarak `frontend/frontend.Dockerfile` şeklinde
  belirtin.
- **Dockerfile Path**: `frontend/frontend.Dockerfile` (Servis ayarları >
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
Bu endpoint (`api.py` içinde halihazırda uygulanmıştır) scraping işlemini
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

Yerel geliştirme/test için `docker-compose.yml` içinde tanımlı scraper
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
| `BACKUP_DIR` | ✅ | — | Snapshot yedek dizini (örn. `/app/backups`) |
| `WORKERS` | ✅ | — | Uvicorn worker sayısı (varsayılan: 2) |
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
2. [ ] Backend servisinin otomatik algılandığını doğrulayın
3. [ ] Backend servisine ortam değişkenlerini ekleyin (Variables)
4. [ ] Backend servisine volume tanımlayın (mount path: `/app`; hem `/app/veriler` hem `/app/backups` aynı volume üzerinde yer alır)
5. [ ] Frontend servisini manuel oluşturun, Dockerfile path'i ayarlayın
6. [ ] Scraping için `/api/scrape` endpoint'inin çalıştığını doğrulayın (önerilen yöntem — bkz. bölüm 3)
7. [ ] Backend health check'in yeşil olduğunu doğrulayın
8. [ ] Frontend health check'in yeşil olduğunu doğrulayın

## Dizin Yapısı

```text
docker-compose.yml          # Üretim / Railway-referans compose dosyası
docker-compose.dev.yml      # Geliştirme (Dev) ortamı compose dosyası
backend.Dockerfile          # Backend Dockerfile'ı (FastAPI)
scraper.Dockerfile          # Scraper Dockerfile'ı (Selenium + Chromium)
frontend/                   # React frontend kaynak kodları ve nginx.conf
Tahsilat Tahakkuk Harita Analizi/  # Backend Python modülleri ve api.py
docs/
  DEV_ORTAMI.md             # Geliştirme ortamı detaylı kurulum kılavuzu
```

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `ALLOWED_ORIGINS` | CORS izin verilen origin'ler (virgülle) | localhost |
| `SCRAPE_TOKEN` | `/api/scrape` için Bearer token (zorunlu) | — |
| `BACKUP_DIR` | Snapshot yedeğinin yazılacağı dizin | — |
| `BACKEND_WORKERS` | Uvicorn worker sayısı | 2 |
| `GRAFANA_USER` / `GRAFANA_PASSWORD` | Grafana erişimi | admin / — |
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

## Gözlemlenebilirlik

- **Loki + Promtail**: Tüm container logları JSON olarak toplanır.
- **Grafana**: Hazır "Servis Logları" dashboard'u `grafana/provisioning/dashboards/`
  altında provision edilir. Backend logları JSON formatında (`level`, `message`).
- Hata olayları için Sentry kullanılmaz; loglar Grafana'da sorgulanır.

## Güvenlik Notları

- Backend 8080 portu host'a **açık değildir**; yalnızca nginx (internal ağ) erişir.
- `/docs`, `/redoc`, `/openapi.json` üretimde **kapalıdır**.
- `/api/scrape` Bearer token ile korunur; yoksa `401`/`503`.
- Nginx: TLS zorunlu, HSTS, CSP, `/api/scrape` rate limit (dakikada 1).
- Image'lar non-root kullanıcı ve `tini` ile çalışır.

## Test & CI

```bash
pip install -r requirements-dev.txt
cd "Tahsilat Tahakkuk Harita Analizi" && pytest -q
```

GitHub Actions (`.github/workflows/ci.yml`): backend pytest, frontend lint+build,
ve prod compose config doğrulaması çalıştırır.
