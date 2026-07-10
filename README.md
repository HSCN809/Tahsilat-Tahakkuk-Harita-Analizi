# Tahsilat-Tahakkuk-Harita-Analizi

İl bazında vergi gelirleri (tahsilat/tahakkuk) analizlerini harita ve grafiklerle
sunan tam yığın uygulama. Backend FastAPI, frontend React (Vite + Nginx), veri
toplayıcı Selenium tabanlı bir one-shot scraper.

## Dizin Yapısı

```
backend.Dockerfile          # Backend image (non-root, tini, --reload kapalı)
scraper.Dockerfile          # Selenium/Chromium scraper image (one-shot)
docker-compose.yml          # Geliştirme ortamı
docker-compose.prod.yml     # Üretim ortamı (Nginx TLS + Loki/Grafana)
frontend/                   # React + Vite + Nginx
  nginx.conf                #   dev Nginx
  nginx.prod.conf           #   prod Nginx (TLS, CSP, HSTS, rate limit)
Tahsilat Tahakkuk Harita Analizi/   # Backend kaynakları (api.py, lib, job_manager, backup)
promtail/                   # Log toplayıcı config
grafana/provisioning/       # Loki datasource + hazır dashboard
certs/                      # TLS sertifikaları (git dışı)
scripts/run-scraper.sh      # Manuel scrape tetikleyici
```

## Hızlı Başlangıç (Geliştirme)

```bash
docker compose up --build
# frontend: http://localhost:5173  (dev)
# backend:   http://localhost:8000  (dev, /docs açık)
```

## Üretim Kurulumu

1. Ortam değişkenlerini hazırlayın:
   ```bash
   cp .env.prod.example .env.prod
   # .env.prod içindeki SCRAPE_TOKEN, GRAFANA_PASSWORD ve ALLOWED_ORIGINS değerlerini doldurun
   ```
2. TLS sertifikalarını `certs/` altına koyun (`fullchain.pem`, `privkey.pem`).
   Geliştirme için: `bash certs/make-selfsigned.sh`
3. Başlatın:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
4. Erişim:
   - Uygulama: `https://<domain>` (nginx TLS sonlandırır)
   - Grafana (loglar): `http://<host>:3000` (admin / .env.prod parolası)

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

Scraper sürekli çalışmaz; yalnızca siz tetiklersiniz:

```bash
./scripts/run-scraper.sh 2024-2025
# veya tüm yıllar:
./scripts/run-scraper.sh hepsi
```

Container işi bitirince otomatik silinir (`--rm`). Veriler `veriler_named`
volume'una yazılır; backend aynı volume'u paylaşır.

Ayrıca API üzerinden de tetiklenebilir (token gerekir):

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

- Backend 8000 portu host'a **açık değildir**; yalnızca nginx (internal ağ) erişir.
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
