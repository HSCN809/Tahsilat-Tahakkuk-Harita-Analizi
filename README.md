# Tahsilat-Tahakkuk-Harita-Analizi

İl bazında vergi gelirleri (tahsilat/tahakkuk) analizlerini harita ve grafiklerle
sunan tam yığın uygulama. Backend FastAPI, frontend React (Vite + Nginx), veri
toplayıcı Selenium tabanlı bir one-shot scraper.

## Dokümantasyon ve Kurulum

Projenin kurulumu ve çalıştırılması için aşağıdaki kılavuzları inceleyebilirsiniz:

*   **Yerel Geliştirme (Dev) Ortamı**: Detaylı kurulum adımları, portlar ve yerel test yönergeleri için [docs/DEV_ORTAMI.md](file:///c:/Users/ozenh/OneDrive/Desktop/Projelerim/Tahsilat-Tahakkuk-Harita-Analizi/docs/DEV_ORTAMI.md) kılavuzuna bakın.
*   **Canlı Yayın (Production)**: Uygulama **Railway** bulut platformu üzerinde çalışmak üzere optimize edilmiştir. `docker-compose.yml` dosyası doğrudan Railway'e yüklenebilir. Detaylar için ilgili bulut platformunun Docker Compose dokümantasyonunu inceleyin.

## Dizin Yapısı

```text
docker-compose.yml          # Üretim (Railway) ortamı compose dosyası
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
