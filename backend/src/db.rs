use std::path::Path;
use std::sync::LazyLock;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use regex::Regex;
use rusqlite::{params, Connection};

use crate::models::{CategoryItem, ConfigResponse, DataResponse, ProvinceRecord, SummaryData};
use crate::security::AppError;

pub type DbPool = Pool<SqliteConnectionManager>;

static RE_PREFIX_NUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\s*").unwrap());
static RE_SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

pub fn clean_category_text(text: &str) -> String {
    let stripped = RE_PREFIX_NUM.replace(text.trim(), "");
    let lower = stripped.to_lowercase();
    RE_SPACES.replace_all(&lower, " ").trim().to_string()
}

pub fn init_pool(db_path: &Path) -> Result<DbPool, AppError> {
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Şema, indeks ve journal modunu tek bir bağlantıyla bir kez başlat
    {
        let single_conn = Connection::open(db_path)
            .map_err(|e| AppError::Internal(format!("Veritabanı açılamadı: {}", e)))?;

        single_conn
            .execute_batch(
                "PRAGMA busy_timeout = 30000;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA mmap_size = 268435456;
                 PRAGMA cache_size = -64000;
                 PRAGMA temp_store = MEMORY;
                 CREATE TABLE IF NOT EXISTS tax_records (
                     year INTEGER NOT NULL,
                     month TEXT NOT NULL,
                     category_id TEXT NOT NULL,
                     category_clean TEXT NOT NULL,
                     province TEXT NOT NULL,
                     accrual REAL,
                     collection REAL,
                     ratio REAL,
                     PRIMARY KEY (year, month, category_clean, province)
                 );
                 CREATE INDEX IF NOT EXISTS idx_tax_lookup
                 ON tax_records(year, category_clean, month);
                 CREATE TABLE IF NOT EXISTS metadata_config (
                     year INTEGER PRIMARY KEY,
                     months_json TEXT NOT NULL,
                     categories_json TEXT NOT NULL
                 );",
            )
            .map_err(|e| AppError::Internal(format!("Veritabanı şema başlatma hatası: {}", e)))?;

        // Journal mode: WAL dene; ağ / Windows bind mount ortamında hata verirse TRUNCATE moduna geç
        let journal_mode = std::env::var("SQLITE_JOURNAL_MODE").unwrap_or_else(|_| "WAL".to_string());
        let _ = single_conn.execute_batch(&format!(
            "PRAGMA journal_mode = {};",
            journal_mode
        ));
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        c.execute_batch(
            "PRAGMA busy_timeout = 30000;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA mmap_size = 268435456;
             PRAGMA cache_size = -64000;
             PRAGMA temp_store = MEMORY;",
        )
    });

    Pool::builder()
        .max_size(16)
        .build(manager)
        .map_err(|e| AppError::Internal(format!("Veritabanı bağlantı havuzu açılamadı: {}", e)))
}

pub fn get_years(conn: &Connection) -> Result<Vec<i64>, AppError> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT year FROM metadata_config ORDER BY year ASC")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut years = Vec::new();
    for y in rows.flatten() {
        years.push(y);
    }

    if years.is_empty() {
        // Fallback: tax_records tablosunu kontrol et
        if let Ok(mut stmt_tax) = conn.prepare("SELECT DISTINCT year FROM tax_records ORDER BY year ASC") {
            if let Ok(rows_tax) = stmt_tax.query_map([], |row| row.get::<_, i64>(0)) {
                for r in rows_tax.flatten() {
                    years.push(r);
                }
            }
        }
    }

    Ok(years)
}

pub fn get_config(conn: &Connection, year: i64) -> Result<ConfigResponse, AppError> {
    let mut stmt = conn
        .prepare("SELECT months_json, categories_json FROM metadata_config WHERE year = ?")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut rows = stmt
        .query(params![year])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if let Some(row) = rows.next().map_err(|e| AppError::Internal(e.to_string()))? {
        let months_raw: String = row.get(0).unwrap_or_else(|_| "[]".to_string());
        let categories_raw: String = row.get(1).unwrap_or_else(|_| "[]".to_string());

        let months: Vec<String> = serde_json::from_str(&months_raw).unwrap_or_default();
        let categories: Vec<CategoryItem> =
            serde_json::from_str(&categories_raw).unwrap_or_default();

        Ok(ConfigResponse {
            year,
            months,
            categories,
        })
    } else {
        Err(AppError::NotFound(format!(
            "{} yılına ait veri veya yapılandırma bulunamadı.",
            year
        )))
    }
}

pub fn get_data(
    conn: &Connection,
    year: i64,
    category: &str,
    month: Option<&str>,
) -> Result<DataResponse, AppError> {
    let category_clean = clean_category_text(category);

    // Ay seçimi: Eğer ay belirtilmemişse veya "Yıl Geneli" ise o yılın son ayını veya mevcut ayı seç
    let target_month = match month {
        Some(m) if !m.trim().is_empty() && m.trim() != "Yıl Geneli" => m.trim().to_string(),
        _ => {
            // Yılın config'inden son ayı tespit et
            if let Ok(cfg) = get_config(conn, year) {
                cfg.months.last().cloned().unwrap_or_else(|| "Aralık".to_string())
            } else {
                "Aralık".to_string()
            }
        }
    };

    let mut stmt = conn
        .prepare(
            "SELECT province, accrual, collection, ratio
             FROM tax_records
             WHERE year = ? AND category_clean = ? AND month = ?
             ORDER BY province ASC",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let rows = stmt
        .query_map(params![year, category_clean, target_month], |row| {
            Ok(ProvinceRecord {
                province: row.get(0)?,
                accrual: row.get(1)?,
                collection: row.get(2)?,
                ratio: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut records = Vec::new();
    let mut total_accrual: f64 = 0.0;
    let mut total_collection: f64 = 0.0;

    for rec in rows.flatten() {
        if let Some(acc) = rec.accrual {
            if !acc.is_nan() {
                total_accrual += acc;
            }
        }
        if let Some(coll) = rec.collection {
            if !coll.is_nan() {
                total_collection += coll;
            }
        }
        records.push(rec);
    }

    let overall_ratio = if total_accrual > 0.0 {
        ((total_collection / total_accrual) * 100.0 * 100.0).round() / 100.0
    } else {
        0.0
    };

    Ok(DataResponse {
        year,
        category: category.to_string(),
        summary: SummaryData {
            total_accrual,
            total_collection,
            overall_ratio,
        },
        data: records,
    })
}
