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

Uygulama Railway'e başarıyla deploy edildikten sonra erişim ve test işlemleri aşağıdaki gibi gerçekleştirilir:

### 2.1. Servis Adresleri ve Giriş Bilgileri

| Servis                             | Erişim Adresi                                                          | Açıklama                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Frontend (React + Nginx)** | `https://<uygulama-adi>.up.railway.app` | Dünyanın her yerinden erişilebilen, SSL/TLS şifrelemeli ana kullanıcı arayüzü. |
| **Backend API**              | *Dışarıya Kapalı (İç Ağ)*                                                 | Güvenlik amacıyla sadece frontend container'ı üzerinden erişilebilir.                 |
| **Canlı Loglar**             | **Railway Dashboard -> Deployments -> View Logs**                        | Sistem logları doğrudan Railway arayüzü üzerinden izlenir.                          |

---

### 2.2. Canlı API Sağlık ve Scrape Testleri

Railway üzerindeki API uç noktalarını (endpoints) test etmek için aşağıdaki komutları kullanabilirsiniz.
*(Komutlardaki `<uygulama-adi>` kısmını kendi Railway canlı adresinizle değiştirin).*

#### Sağlık Kontrolü Testi
```powershell
Invoke-RestMethod -Method Get -Uri "https://<uygulama-adi>.up.railway.app/healthz"
```
*Beklenen Yanıt:* `ok` metni.

#### Yetkisiz Scrape Girişim Testi (401 Unauthorized)
Token olmadan veri çekme isteği gönderildiğinde reddedilmelidir:
```powershell
try {
    Invoke-RestMethod -Method Post -Uri "https://<uygulama-adi>.up.railway.app/api/scrape?year_input=2024"
} catch {
    Write-Host "Hata Kodu: $_"
    # 401 Unauthorized hatası alınmalıdır.
}
```

#### Yetkili Scrape Testi
Railway arayüzünde belirlediğiniz `SCRAPE_TOKEN` değerini kullanarak veri çekmeyi tetikleme:
```powershell
$token = "Railway-Dashboard-Uzerinden-Belirlediginiz-Token"
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "https://<uygulama-adi>.up.railway.app/api/scrape?year_input=2024" -Headers $headers
```

---

## 3. Sistem Sorun Giderme ve Log İzleme

Railway üzerinde herhangi bir sorun yaşanması durumunda:
1. Railway paneline gidin.
2. İlgili servisi (`backend` veya `frontend`) seçin.
3. **Logs** sekmesine tıklayarak canlı hata kayıtlarını ve sistem çıktılarını anlık olarak izleyin.
