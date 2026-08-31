pub mod config;
pub mod db;
pub mod handlers;
pub mod job_manager;
pub mod models;
pub mod security;
pub mod state;

use axum::http::{HeaderValue, Method};
use axum::routing::{get, post};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

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

    Router::new()
        .route("/health", get(handlers::health::health_check))
        .route("/healthz", get(handlers::health::healthz))
        .route("/", get(handlers::health::read_root))
        .route("/api/years", get(handlers::data::get_years))
        .route("/api/config", get(handlers::data::get_config))
        .route("/api/data", get(handlers::data::get_data))
        .route("/api/geojson", get(handlers::geojson::get_geojson))
        .route("/api/files", get(handlers::files::list_files))
        .route("/api/files/download", get(handlers::files::download_files))
        .route("/api/jobs/status", get(handlers::scrape::get_job_status))
        .route("/api/scrape", post(handlers::scrape::trigger_scrape))
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
