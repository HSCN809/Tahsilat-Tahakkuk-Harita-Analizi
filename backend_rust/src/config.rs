use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub scrape_token: String,
    pub backup_dir: String,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub geojson_path: PathBuf,
    pub scraper_script_path: PathBuf,
    pub python_bin: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(8080);

        let allowed_origins_raw = env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| {
            "http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173,http://localhost:8080".to_string()
        });
        let allowed_origins: Vec<String> = allowed_origins_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let scrape_token = env::var("SCRAPE_TOKEN").unwrap_or_default().trim().to_string();
        let backup_dir = env::var("BACKUP_DIR").unwrap_or_default().trim().to_string();
        let python_bin = env::var("PYTHON_BIN").unwrap_or_else(|_| "python".to_string());

        // Proje kok dizinini ve veriler dizinini tespit et
        let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let candidates = [
            current_dir.join("veriler"),
            current_dir.parent().map(|p| p.join("veriler")).unwrap_or_default(),
            PathBuf::from("veriler"),
            PathBuf::from("../veriler"),
        ];

        let mut data_dir = PathBuf::from("veriler");
        for candidate in candidates {
            if candidate.exists() {
                data_dir = candidate;
                break;
            }
        }

        let db_path = env::var("DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("tahsilat_tahakkuk.db"));

        // tr.json arama
        let geojson_candidates = [
            current_dir.join("tr.json"),
            current_dir.join("Tahsilat Tahakkuk Harita Analizi").join("tr.json"),
            current_dir.parent().map(|p| p.join("Tahsilat Tahakkuk Harita Analizi").join("tr.json")).unwrap_or_default(),
            data_dir.join("tr.json"),
        ];

        let mut geojson_path = current_dir.join("tr.json");
        for candidate in geojson_candidates {
            if candidate.exists() {
                geojson_path = candidate;
                break;
            }
        }

        // Scraper script yolu
        let scraper_candidates = [
            current_dir.join("Tahsilat Tahakkuk Harita Analizi").join("Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py"),
            current_dir.parent().map(|p| p.join("Tahsilat Tahakkuk Harita Analizi").join("Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py")).unwrap_or_default(),
        ];

        let mut scraper_script_path = current_dir.join("Tahsilat Tahakkuk Harita Analizi").join("Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py");
        for candidate in scraper_candidates {
            if candidate.exists() {
                scraper_script_path = candidate;
                break;
            }
        }

        Self {
            host,
            port,
            allowed_origins,
            scrape_token,
            backup_dir,
            data_dir,
            db_path,
            geojson_path,
            scraper_script_path,
            python_bin,
        }
    }
}
