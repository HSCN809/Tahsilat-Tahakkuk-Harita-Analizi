pub mod config;
pub mod db;
pub mod handlers;
pub mod job_manager;
pub mod models;
pub mod security;
pub mod state;

use std::sync::Arc;
use axum::http::header::{HeaderName, HeaderValue, X_CONTENT_TYPE_OPTIONS, X_FRAME_OPTIONS};
use axum::http::Method;
use axum::routing::{get, post};
use axum::Router;
use tower::ServiceBuilder;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::security::SmartPeerIpExtractor;
use crate::state::AppState;

pub fn create_app(state: AppState) -> Router {
    let mut cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ]);

    if state.config.allowed_origins.is_empty() || state.config.allowed_origins.contains(&"*".to_string()) {
        cors = cors.allow_origin(Any);
    } else {
        let origins: Vec<HeaderValue> = state
            .config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        cors = cors.allow_origin(origins).allow_credentials(true);
    }

    // Temel rate limiting: İstemci başına saniyede 50 istek, 100 burst kapasitesi
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(20)
            .burst_size(100)
            .key_extractor(SmartPeerIpExtractor)
            .finish()
            .expect("GovernorConfig oluşturulamadı"),
    );

    // OWASP & Güvenlik Başlıkları Katmanı
    let security_headers = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-xss-protection"),
            HeaderValue::from_static("1; mode=block"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; frame-ancestors 'none';"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("geolocation=(), camera=(), microphone=()"),
        ));

    Router::new()
        .route("/health", get(handlers::health::health_check))
        .route("/healthz", get(handlers::health::healthz))
        .route("/", get(handlers::health::read_root))
        .route("/api/years", get(handlers::data::get_years))
        .route("/api/config", get(handlers::data::get_config))
        .route("/api/data", get(handlers::data::get_data))
        .route("/api/bootstrap", get(handlers::data::get_bootstrap))
        .route("/api/geojson", get(handlers::geojson::get_geojson))
        .route("/api/files", get(handlers::files::list_files))
        .route("/api/files/download", get(handlers::files::download_files))
        .route("/api/jobs/status", get(handlers::scrape::get_job_status))
        .route("/api/scrape", post(handlers::scrape::trigger_scrape))
        .layer(GovernorLayer::new(governor_conf))
        .layer(cors)
        .layer(security_headers)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
