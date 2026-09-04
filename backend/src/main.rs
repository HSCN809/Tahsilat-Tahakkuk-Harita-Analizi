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

    // tr.json harita dosyasını başlangıçta bir kez ham bayt olarak belleğe yükle
    let geojson_bytes = if config.geojson_path.exists() {
        match std::fs::read(&config.geojson_path) {
            Ok(raw) => bytes::Bytes::from(raw),
            Err(e) => {
                info!("GeoJSON dosyası okunamadı: {:?}, boş nesne ile başlatıldı.", e);
                bytes::Bytes::from_static(b"{}")
            }
        }
    } else {
        info!("GeoJSON dosyası ({:?}) bulunamadı, boş nesne ile başlatıldı.", config.geojson_path);
        bytes::Bytes::from_static(b"{}")
    };

    let job_manager = JobManager::new();

    let state = AppState {
        config: config.clone(),
        db_pool,
        job_manager,
        geojson_cache: Arc::new(geojson_bytes),
        cache: backend::state::AppCache::new(),
    };

    let app = create_app(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("Sunucu dinlemede: http://{}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;

    Ok(())
}
