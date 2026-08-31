use std::fs::File;
use std::io::Read;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use backend::config::AppConfig;
use backend::create_app;
use backend::db::init_pool;
use backend::job_manager::JobManager;
use backend::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Loki dostu yapılandırılmış loglama
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,backend=debug".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = AppConfig::from_env();
    info!("Tahsilat-Tahakkuk Backend başlatılıyor...");
    info!("Yapılandırma: DB Yolu={:?}, Port={}", config.db_path, config.port);

    // Veritabanı havuzunu başlat
    let db_pool = init_pool(&config.db_path)
        .map_err(|e| format!("Veritabanı başlatma hatası: {:?}", e))?;

    // tr.json harita dosyasını başlangıçta bir kez belleğe yükle
    let geojson_val = if config.geojson_path.exists() {
        let mut f = File::open(&config.geojson_path)?;
        let mut content = String::new();
        f.read_to_string(&mut content)?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        info!("GeoJSON dosyası ({:?}) bulunamadı, boş nesne ile başlatıldı.", config.geojson_path);
        serde_json::json!({})
    };

    let job_manager = JobManager::new();

    let state = AppState {
        config: config.clone(),
        db_pool,
        job_manager,
        geojson_cache: Arc::new(geojson_val),
    };

    let app = create_app(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("Sunucu dinlemede: http://{}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
