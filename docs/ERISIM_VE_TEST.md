# Servis Erişim ve Test Kılavuzu

Bu kılavuz, projedeki servislerin adreslerini, erişim kimlik bilgilerini ve bu servislerin çalışıp çalışmadığını doğrulamak için kullanabileceğiniz test komutlarını içerir.

---

## 1. Geliştirme (Dev) Ortamı

Geliştirme ortamı `docker compose up -d` komutuyla başlatıldığında aşağıdaki servisler aktif olur:

### 1.1. Servis Adresleri ve Durumları

| Servis                          | Erişim Adresi                                          | Açıklama                                               |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| **Frontend (React)**      | [http://localhost:5173](http://localhost:5173)           | Kullanıcı arayüzü (değişiklikler anında yansır). |
| **Backend API (FastAPI)** | [http://localhost:8000](http://localhost:8000)           | Veri sağlayan API sunucusu.                             |
| **API Dokümantasyonu**   | [http://localhost:8000/docs](http://localhost:8000/docs) | İnteraktif Swagger UI dokümantasyonu.                  |

### 1.2. Sağlık ve Bağlantı Test Komutları

Aşağıdaki PowerShell komutlarını kullanarak servislerin yanıt verip vermediğini test edebilirsiniz:

#### API Kök Dizin Kontrolü (Sağlık Testi)

API'nin çalışıp çalışmadığını kontrol etmek için:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8000/"
```

*Beklenen Yanıt:* API rotaları ve durum bilgisi içeren bir JSON nesnesi.

#### Scrape Tetikleme Yetkilendirme Testi

Geliştirme ortamında [ .env ](file:///c:/Users/ozenh/OneDrive/Desktop/Projelerim/Tahsilat-Tahakkuk-Harita-Analizi/.env) dosyası içindeki `SCRAPE_TOKEN` ile veri çekme tetikleme testi yapabilirsiniz:

```powershell
# .env dosyasından token'ı otomatik okur ve header'a ekler
$token = (Get-Content .env | Select-String "SCRAPE_TOKEN=").Line.Split("=")[1].Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/scrape?year_input=2024" -Headers $headers
```

*Beklenen Yanıt:* `"status": "started"` ve işleme ait `"job_id"` içeren başarı JSON'ı.

---

## 2. Üretim (Prod) Ortamı

Üretim ortamı `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` komutuyla başlatıldığında tüm güvenlik ve loglama servisleri aktif olur:

### 2.1. Servis Adresleri ve Giriş Bilgileri

| Servis                             | Erişim Adresi                                | Giriş Bilgileri                                                                               | Açıklama                                                                            |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Frontend (React + Nginx)** | [https://localhost](https://localhost)         | Şifresiz / Açık                                                                             | TLS/SSL şifrelemeli ana kullanıcı arayüzü (port 80 ve 443).                      |
| **Grafana (Log Arayüzü)**  | [http://localhost:3000](http://localhost:3000) | **Kullanıcı:** `admin`**Şifre:** `.env.prod` içindeki `GRAFANA_PASSWORD` | Logları ve sistem metriklerini izleme paneli.                                        |
| **Backend API**              | *Dışarıya Kapalı*                       | Yalnızca Nginx üzerinden erişilir                                                           | Güvenlik amacıyla port 8000 dış erişime kapatılmıştır.                       |
| **API Dokümantasyonu**      | *Kapalı (Kapatıldı)*                     | —                                                                                             | Üretim ortamında`/docs` ve `/redoc` yolları güvenlik için devre dışıdır. |

### 2.2. Sağlık ve Bağlantı Test Komutları

#### SSL/TLS Bağlantı ve Nginx Sağlık Testi

Nginx ters proxy sunucusunun HTTPS üzerinden düzgün yanıt verdiğini doğrulamak için:

```powershell
# SSL sertifika uyarısını yoksayarak HTTPS isteği atar (self-signed kullanıldığı için)
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
Invoke-RestMethod -Method Get -Uri "https://localhost/healthz"
```

*Beklenen Yanıt:* `OK` metni.

#### Yetkisiz Scrape Girişim Testi (401 Unauthorized)

Token olmadan veri çekme endpoint'ine erişmeye çalışıldığında reddedilmesi gerekir:

```powershell
try {
    Invoke-RestMethod -Method Post -Uri "https://localhost/api/scrape?year_input=2024"
} catch {
    Write-Host "Hata Kodu: $_"
    # $_.Exception.Response.StatusCode.value__ değeri 401 olmalıdır.
}
```

*Beklenen Yanıt:* İstek engellenmeli ve HTTP `401 Unauthorized` hatası alınmalıdır.

#### Yetkili Scrape Testi ve Çakışma Yönetimi (409 Conflict)

Doğru token ile istek atıp durumu izleme:

```powershell
# 1. İstek (.env.prod dosyasından token'ı otomatik okur ve başlatır - 200 OK)
$token = (Get-Content .env.prod | Select-String "SCRAPE_TOKEN=").Line.Split("=")[1].Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "https://localhost/api/scrape?year_input=2024" -Headers $headers

# 2. İstek (İlk işlem devam ederken çakışma yaratır - 409 Conflict)
try {
    Invoke-RestMethod -Method Post -Uri "https://localhost/api/scrape?year_input=2024" -Headers $headers
} catch {
    Write-Host "Çakışma Testi Başarılı: $_" # 409 Conflict dönmelidir
}

# 3. Durum Sorgulama
Invoke-RestMethod -Method Get -Uri "https://localhost/api/jobs/status"
```

#### Grafana Loki Log Kontrolü

Grafana ([http://localhost:3000](http://localhost:3000)) paneline girin:

1. Sol menüden **Explore** (Pusula simgesi) sekmesine gidin.
2. Datasource olarak **Loki** seçin.
3. Sorgu alanına `{container_name="tahsilat-tahakkuk-harita-analizi-backend-1"}` yazarak **Run Query** butonuna basın.
4. Backend loglarının canlı olarak düştüğünü doğrulayın.

---

## 3. Sistem Durumu ve Sorun Giderme Testleri

Tüm servislerin anlık durumunu ve kaynak tüketimini doğrulamak için:

```powershell
# Tüm container'ların sağlık durumlarını gösterir (Up (healthy) görmelisiniz)
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# Container'ların CPU, Bellek ve Ağ kullanımını canlı gösterir
docker stats
```
