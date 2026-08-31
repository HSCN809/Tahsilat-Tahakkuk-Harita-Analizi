use axum::Json;
use serde_json::json;

use crate::models::{HealthResponse, RootResponse};

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
    })
}

pub async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
    })
}

pub async fn read_root() -> Json<RootResponse> {
    Json(RootResponse {
        status: "online".to_string(),
        message: "Tahsilat Tahakkuk Veri API (Rust Axum) aktif durumda.".to_string(),
        endpoints: json!({
            "GET /api/years": "Mevcut yılları listeler",
            "GET /api/config?year=2025": "Yıla ait ayları ve gelir kalemlerini tek istekte döner",
            "GET /api/data?year=2025&category=Özel Tüketim Vergisi": "Yıl ve kalem bazlı ham il verilerini listeler",
            "GET /api/geojson": "Türkiye sınırları GeoJSON dosyasını döner",
            "GET /api/files?year=2025": "Yıla ait ham .xls dosyalarını listeler",
            "GET /api/files/download?year=2025&files=01-Adana-2025,06-Ankara-2025": "Seçilen ham dosyaları zip olarak indirir",
            "GET /api/jobs/status": "Aktif/son scrape işinin durumunu döner",
            "POST /api/scrape?year_input=2024-2025": "Arka planda veri indirmeyi başlatır (token gerekir)",
        }),
    })
}
