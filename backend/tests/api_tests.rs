use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use backend::config::AppConfig;
use backend::create_app;
use backend::db::{clean_category_text, init_pool};
use backend::job_manager::JobManager;
use backend::security::{validate_year, validate_year_input, verify_scrape_token};
use backend::state::AppState;

fn setup_test_state(temp_dir: &tempfile::TempDir) -> AppState {
    let temp_db_path = temp_dir.path().join("test.db");
    let pool = init_pool(&temp_db_path).expect("Test DB pool oluşturulamadı");

    // Test verileri ekle
    {
        let conn = pool.get().expect("Bağlantı alınamadı");
        conn.execute(
            "INSERT OR REPLACE INTO metadata_config (year, months_json, categories_json)
             VALUES (2025, '[\"Ocak\",\"Şubat\"]', '[{\"id\":\"01. Gelir Vergisi\",\"name\":\"Gelir Vergisi\"}]')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO tax_records (year, month, category_id, category_clean, province, accrual, collection, ratio)
             VALUES (2025, 'Ocak', '01. Gelir Vergisi', 'gelir vergisi', 'Adana', 1000.0, 800.0, 80.0)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO tax_records (year, month, category_id, category_clean, province, accrual, collection, ratio)
             VALUES (2025, 'Ocak', '01. Gelir Vergisi', 'gelir vergisi', 'Ankara', 2000.0, 1500.0, 75.0)",
            [],
        ).unwrap();
    }

    // Sahte raw_xls klasörü oluştur
    let raw_dir = temp_dir.path().join("Tahsilat Tahakkuk Excel Dosyaları").join("İllere Göre Tahsilat Tahakkuk 2025").join("raw_xls");
    std::fs::create_dir_all(&raw_dir).unwrap();
    let sample_xls = raw_dir.join("01-Adana-2025.xls");
    let mut f = File::create(&sample_xls).unwrap();
    f.write_all(b"fake-xls-content-data").unwrap();

    let config = AppConfig {
        host: "127.0.0.1".to_string(),
        port: 8080,
        allowed_origins: vec!["*".to_string()],
        scrape_token: "super-secret-scrape-token".to_string(),
        backup_dir: "".to_string(),
        data_dir: temp_dir.path().to_path_buf(),
        db_path: temp_db_path,
        geojson_path: PathBuf::from("tr.json"),
        scraper_script_path: PathBuf::from("mock_scraper.py"),
        python_bin: "python".to_string(),
    };

    AppState {
        config,
        db_pool: pool,
        job_manager: JobManager::new(),
        geojson_cache: Arc::new(serde_json::json!({"type": "FeatureCollection", "features": []})),
        cache: backend::state::AppCache::new(),
    }
}

#[tokio::test]
async fn test_health_and_root_endpoints() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    // /health
    let resp = app
        .clone()
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "healthy");

    // /healthz
    let resp2 = app
        .clone()
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    // /
    let resp3 = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp3.status(), StatusCode::OK);
    let body3 = resp3.into_body().collect().await.unwrap().to_bytes();
    let json3: Value = serde_json::from_slice(&body3).unwrap();
    assert_eq!(json3["status"], "online");
}

#[tokio::test]
async fn test_years_and_config_endpoints() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    // /api/years
    let resp = app
        .clone()
        .oneshot(Request::builder().uri("/api/years").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["years"], serde_json::json!([2025]));

    // /api/config?year=2025
    let resp2 = app
        .clone()
        .oneshot(Request::builder().uri("/api/config?year=2025").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(json2["year"], 2025);
    assert_eq!(json2["months"], serde_json::json!(["Ocak", "Şubat"]));
    assert_eq!(json2["categories"][0]["name"], "Gelir Vergisi");

    // /api/config?year=1990 (Geçersiz yıl -> 400 Bad Request)
    let resp_bad = app
        .oneshot(Request::builder().uri("/api/config?year=1990").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp_bad.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_data_endpoint_calculation() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    // /api/data?year=2025&category=Gelir%20Vergisi&month=Ocak
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/data?year=2025&category=Gelir%20Vergisi&month=Ocak")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["year"], 2025);
    assert_eq!(json["summary"]["total_accrual"], 3000.0);
    assert_eq!(json["summary"]["total_collection"], 2300.0);
    // (2300 / 3000) * 100 = 76.67
    assert_eq!(json["summary"]["overall_ratio"], 76.67);

    let data = json["data"].as_array().unwrap();
    assert_eq!(data.len(), 2);
    assert_eq!(data[0]["province"], "Adana");
    assert_eq!(data[0]["ratio"], 80.0);
    assert_eq!(data[1]["province"], "Ankara");
    assert_eq!(data[1]["ratio"], 75.0);
}

#[tokio::test]
async fn test_files_list_and_download_endpoint() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    // /api/files?year=2025
    let resp = app
        .clone()
        .oneshot(Request::builder().uri("/api/files?year=2025").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["year"], 2025);
    let files = json["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["name"], "01-Adana-2025.xls");

    // /api/files/download?year=2025&all=true
    let resp_dl = app
        .oneshot(Request::builder().uri("/api/files/download?year=2025&all=true").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp_dl.status(), StatusCode::OK);
    assert_eq!(resp_dl.headers().get(header::CONTENT_TYPE).unwrap(), "application/zip");
    let zip_bytes = resp_dl.into_body().collect().await.unwrap().to_bytes();
    assert!(!zip_bytes.is_empty());
}

#[tokio::test]
async fn test_scrape_authentication_and_job_conflict() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    // 1. Token olmadan -> 401
    let resp_no_auth = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/scrape?year_input=2025")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_no_auth.status(), StatusCode::UNAUTHORIZED);

    // 2. Yanlış token -> 401
    let resp_bad_auth = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/scrape?year_input=2025")
                .header("Authorization", "Bearer invalid-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_bad_auth.status(), StatusCode::UNAUTHORIZED);

    // 3. /api/jobs/status kontrolü
    let resp_status = app
        .oneshot(Request::builder().uri("/api/jobs/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp_status.status(), StatusCode::OK);
    let body = resp_status.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["running"], false);
}

#[tokio::test]
async fn test_security_token_verification() {
    // 1. Doğru token -> Ok
    let ok = verify_scrape_token(Some("Bearer super-secret-scrape-token"), "super-secret-scrape-token");
    assert!(ok.is_ok());

    // 2. Yanlış token -> Unauthorized
    let wrong = verify_scrape_token(Some("Bearer wrong-token"), "super-secret-scrape-token");
    assert!(wrong.is_err());

    // 3. Eksik header -> Unauthorized
    let missing = verify_scrape_token(None, "super-secret-scrape-token");
    assert!(missing.is_err());

    // 4. Yanlış şema -> Unauthorized
    let bad_scheme = verify_scrape_token(Some("Basic 12345"), "super-secret-scrape-token");
    assert!(bad_scheme.is_err());

    // 5. Sunucuda token tanımsız -> ServiceUnavailable
    let unconfigured = verify_scrape_token(Some("Bearer any"), "");
    assert!(unconfigured.is_err());
}

#[tokio::test]
async fn test_input_validation_rules() {
    // Yıl doğrulama
    assert!(validate_year(2025).is_ok());
    assert!(validate_year(1999).is_err());
    assert!(validate_year(2101).is_err());

    // Yıl girdisi regex
    assert!(validate_year_input("2024").is_ok());
    assert!(validate_year_input("2024-2025").is_ok());
    assert!(validate_year_input("2024-2025,2023").is_ok());
    assert!(validate_year_input("hepsi").is_ok());
    assert!(validate_year_input("Hepsi").is_ok());

    assert!(validate_year_input("").is_err());
    assert!(validate_year_input("DROP TABLE tax_records;").is_err());
    assert!(validate_year_input("../../../etc/passwd").is_err());
    assert!(validate_year_input("202x").is_err());
}

#[test]
fn test_category_text_cleaning() {
    assert_eq!(clean_category_text("01. Gelir Vergisi"), "gelir vergisi");
    assert_eq!(clean_category_text("01.02.   Kurumlar   Vergisi "), "02. kurumlar vergisi");
    assert_eq!(clean_category_text("Özel Tüketim Vergisi"), "özel tüketim vergisi");
}

#[tokio::test]
async fn test_security_headers_and_caching() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state.clone());

    // 1. Güvenlik başlıkları kontrolü
    let resp = app
        .clone()
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let headers = resp.headers();
    assert_eq!(
        headers.get("x-content-type-options").and_then(|v| v.to_str().ok()),
        Some("nosniff")
    );
    assert_eq!(
        headers.get("x-frame-options").and_then(|v| v.to_str().ok()),
        Some("DENY")
    );
    assert_eq!(
        headers.get("x-xss-protection").and_then(|v| v.to_str().ok()),
        Some("1; mode=block")
    );
    assert_eq!(
        headers.get("referrer-policy").and_then(|v| v.to_str().ok()),
        Some("strict-origin-when-cross-origin")
    );
    assert!(headers.contains_key("content-security-policy"));

    // 2. Önbellek (Moka cache) kontrolü: Years, Config ve Data
    let resp_years1 = app
        .clone()
        .oneshot(Request::builder().uri("/api/years").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp_years1.status(), StatusCode::OK);

    // Cache'den hızlı get kontrolü
    let cached_years = state.cache.years.get(&()).await;
    assert!(cached_years.is_some());
    assert_eq!(cached_years.unwrap(), vec![2025]);

    // Config cache kontrolü
    let resp_config = app
        .clone()
        .oneshot(Request::builder().uri("/api/config?year=2025").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp_config.status(), StatusCode::OK);
    assert!(state.cache.config.get(&2025).await.is_some());

    // Data cache kontrolü
    let resp_data = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data?year=2025&category=01.+Gelir+Vergisi&month=Ocak")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_data.status(), StatusCode::OK);
    let data_cache_key = (2025, "01. Gelir Vergisi".to_string(), Some("Ocak".to_string()));
    assert!(state.cache.data.get(&data_cache_key).await.is_some());

    // Cache invalidate_all testi (years, config, data hepsini temizlemeli)
    state.cache.invalidate_all().await;
    assert!(state.cache.years.get(&()).await.is_none());
    assert!(state.cache.config.get(&2025).await.is_none());
    assert!(state.cache.data.get(&data_cache_key).await.is_none());
}

#[test]
fn test_smart_peer_ip_extractor() {
    use backend::security::SmartPeerIpExtractor;
    use tower_governor::key_extractor::KeyExtractor;
    use std::net::IpAddr;

    let extractor = SmartPeerIpExtractor;

    // 1. X-Forwarded-For birden fazla IP ile (ilk IP seçilmeli)
    let req1 = Request::builder()
        .header("x-forwarded-for", "198.51.100.25, 203.0.113.195")
        .body(())
        .unwrap();
    assert_eq!(extractor.extract(&req1).unwrap(), "198.51.100.25".parse::<IpAddr>().unwrap());

    // 2. X-Real-IP
    let req2 = Request::builder()
        .header("x-real-ip", "203.0.113.50")
        .body(())
        .unwrap();
    assert_eq!(extractor.extract(&req2).unwrap(), "203.0.113.50".parse::<IpAddr>().unwrap());

    // 3. ConnectInfo extension
    let mut req3 = Request::builder().body(()).unwrap();
    req3.extensions_mut().insert(axum::extract::ConnectInfo(
        "192.168.1.100:12345".parse::<std::net::SocketAddr>().unwrap(),
    ));
    assert_eq!(extractor.extract(&req3).unwrap(), "192.168.1.100".parse::<IpAddr>().unwrap());

    // 4. Başlık ve extension yoksa güvenli yerel fallback (127.0.0.1)
    let req4 = Request::builder().body(()).unwrap();
    assert_eq!(extractor.extract(&req4).unwrap(), "127.0.0.1".parse::<IpAddr>().unwrap());
}

#[tokio::test]
async fn test_rate_limiting_governor() {
    let tmp = tempfile::tempdir().unwrap();
    let state = setup_test_state(&tmp);
    let app = create_app(state);

    let mut hit_429 = false;
    for i in 0..120 {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("x-forwarded-for", "192.0.2.99")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        if resp.status() == StatusCode::TOO_MANY_REQUESTS {
            hit_429 = true;
            break;
        }
        let _ = i;
    }

    assert!(hit_429, "120 ardışık hızlı istek sonrasında rate limiter 429 Too Many Requests döndürmelidir");
}

