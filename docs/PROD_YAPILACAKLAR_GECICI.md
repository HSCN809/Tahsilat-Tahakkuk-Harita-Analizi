# Üretim Ortamı Yapılacaklar — Durum Takibi

Uygulama: 2026-07-10 itibarıyla tamamlandı maddeler işaretlendi. Kalanlar
açıkça belirtildi. Bu liste artık "yol haritası" değil, "ne yapıldı" kaydıdır.

## Kritik

- [x] `/api/scrape` endpoint'i Bearer token ile yetkilendirildi (`api.py` → `require_scrape_token`).
      SCRAPE_TOKEN tanımsızsa 503 ile devre dışı.
- [x] Scrape işleri API sürecinden ayrıldı: `job_manager.py` tek-aktif-iş kuralı + `/api/jobs/status`.
      Çakışmada 409. (Not: scraper hâlâ subprocess ile çağrılır ama tek job garanti.)
- [x] `veriler/` için named volume (`veriler_named`) tanımlandı. Başlangıç verisi: repo'daki
      `veriler/` klasörü build sırasında image'a kopyalanır (bind mount kaldırıldı).
- [x] Scraper ayrı image (`scraper.Dockerfile`) ve one-shot `docker compose run --rm scraper`
      ile çalıştırılır; prod compose'da kalıcı servis değil (`profiles: [manual]`).

## Yüksek

- [x] Backend 8000 portu host'a kapalı; yalnız `expose` ile internal ağda. Ters proxy: nginx.
- [x] TLS Nginx üzerinde sonlandırılır (`nginx.prod.conf`, `certs/`). HSTS eklendi.
- [x] Backend `--reload` olmadan, `WORKERS` env ile worker sayısıyla çalışır.
- [x] Backend ve scraper image'ları non-root (`appuser`) + `tini` ile çalışır.
- [x] CPU/bellek limiti + restart politikası (`unless-stopped`) + healthcheck eklendi.
- [x] `d3-color@2.0.0`→`^3.1.0` override `frontend/package.json` `overrides` ile uygulandı.

## Orta

- [x] `/healthz` (nginx) ve backend healthcheck tanımlandı.
- [x] Prod CORS origin'leri env'den; method `GET,POST`, header `Authorization,Content-Type` daraltıldı.
- [x] Docker log rotasyonu (`json-file`, max-size 10m, max-file 5) eklendi.
- [x] Python base image sabitlendi (`python:3.11.10-slim`), bağımlılıklar requirements-dev ile ayrıldı.
- [x] Nginx CSP + HSTS eklendi.
- [x] Sentry yerine Grafana + Loki (self-host) kullanıldı; hazır dashboard provision edildi.
- [x] `pytest` (parser/validation/auth/job) + GitHub Actions CI eklendi. Frontend lint+build CI'da.
- [x] README prod kurulum, env değişkenleri, yedekleme, scrape akışı ve rollback notlarıyla genişletildi.
- [x] `/docs`, `/redoc`, `/openapi.json` üretimde kapatıldı (`docs_url=None`).

## Uygulama Sırası (uygulandı)

1. Veri volume + ayrı scraper worker + Dockerfile düzeltmeleri
2. Scrape token + job lock + kaynak limitleri
3. Backend port kapatma + TLS + prod compose
4. Healthcheck + loglama (Loki/Grafana) + test/CI

## Notlar / İzlenecekler

- Yedekleme: her scrape sonrası `veriler_backup_named` içine `veriler-snapshot.tar.gz`
  üzerine yazılır (rotasyon yok). Frontend henüz job durumu/backup mesajını göstermiyor;
  `/api/jobs/status` üzerinden polleme eklenebilir.
- Deploy hedefi henüz belirlenmedi; compose platform-agnostic (Linux hedefli).
- İleride genişletilebilir: Sentry, detaylı test coverage, alerting.
