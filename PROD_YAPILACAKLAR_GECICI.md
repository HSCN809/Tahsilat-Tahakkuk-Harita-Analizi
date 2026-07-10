# Üretim Ortamı Yapılacaklar

Bu liste, uygulamayı internete açık üretim ortamına almadan önce uygulanmalıdır.

## Kritik

- [ ] `/api/scrape` endpoint'ini yetkilendir ve rate limit uygula. Bu endpoint Selenium ve alt süreç başlatır; yetkisiz veya çok sayıda çağrı sunucu kaynaklarını tüketebilir.
- [ ] Scrape işlerini API sürecinden ayır. Tek aktif iş kuralı, iş durumu, zaman aşımı ve hata kaydı ekle. Aynı anda çalışan işler veri klasörlerini silip yazabilir; bu veri kaybı ve tutarsız yanıt oluşturur.
- [ ] `veriler/` için kalıcı named volume, başlangıç verisi ve yedekleme süreci tanımla. Üretimde bind mount kaldırılınca image veri dosyalarını taşımaz.
- [ ] Scraper'ı ayrı bir Compose servisi/worker olarak çalıştır. Chromium içeren `scraper.Dockerfile` şu an Compose tarafından kullanılmıyor; backend image içinde Chromium yok.

## Yüksek

- [ ] Backend'in `8000` portunu internete açma. Sadece ters proxy dışarı açık olsun. Aksi halde backend, TLS ve koruma katmanlarını doğrudan bypass edebilir.
- [ ] TLS sonlandırmasını Nginx, Caddy, Cloudflare veya yük dengeleyici üzerinde zorunlu yap. HTTPS, istemci ile sunucu arasındaki trafiği korur.
- [ ] Backend'i `--reload` olmadan, uygun worker sayısıyla çalıştır. `--reload` geliştirme amaçlıdır ve üretimde ek süreç/kararlılık riski oluşturur.
- [ ] Backend ve scraper image'larını non-root kullanıcıyla çalıştır. Uygulama veya scraper ele geçirilirse container içindeki yetki sınırlandırılmış olur.
- [ ] CPU, bellek ve restart politikası ekle. Özellikle Selenium işlemleri kontrolsüz kaynak tüketimini ve beklenmedik kapanmalarda hizmet kesintisini önler.
- [ ] `react-simple-maps -> d3-color@2.0.0` bağımlılık zincirindeki high güvenlik bulgusunu gider veya güvenli sürüm override'ını uyumluluk testiyle uygula.

## Orta

- [ ] `/health` ve readiness endpoint'i ekle; Compose healthcheck tanımla. Proxy ve orkestratör, servisin yalnız çalıştığını değil istek kabul edebildiğini doğrular.
- [ ] Prod CORS origin'lerini ortam değişkeninden tanımla; izin verilen method/header listesini daralt. Aynı origin kullanılıyorsa CORS middleware'ini kaldırmayı değerlendir.
- [ ] Docker log rotasyonu ekle. Sınırsız container logları disk alanını tüketebilir.
- [ ] Python bağımlılıklarını ve Docker base image'larını sabitle. Tekrarlanabilir build ve güvenlik güncellemesi takibi sağlar.
- [ ] Nginx'e CSP ekle; HSTS'i yalnız HTTPS sonlandırılan katmanda etkinleştir. Tarayıcı tarafı saldırı yüzeyini azaltır.
- [ ] Sentry veya GlitchTip ekle. ErrorBoundary var ancak şu an hataları yalnız tarayıcı konsoluna yazıyor.
- [ ] En az parser, veri hazırlama ve API doğrulama fonksiyonları için unit test ekle; CI'da `pytest`, `npm run lint` ve `npm run build` çalıştır.
- [ ] README'ye prod kurulum, gerekli ortam değişkenleri, veri volume'u, scrape iş akışı ve rollback/yedekleme notlarını ekle.
- [ ] Kamuya açık olması gerekmeyen FastAPI `/docs` ve `/openapi.json` uçlarını prod'da kapat veya koru.

## Uygulama Sırası

1. Veri volume'u ve ayrı scraper worker.
2. Scrape yetkilendirmesi, job kilidi ve kaynak limitleri.
3. Backend portunun kapatılması, TLS ve prod Compose dosyası.
4. Healthcheck, loglama, gözlemlenebilirlik ve CI/testler.
