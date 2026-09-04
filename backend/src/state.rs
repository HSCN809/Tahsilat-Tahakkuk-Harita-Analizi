use std::sync::Arc;
use std::time::Duration;
use bytes::Bytes;
use moka::future::Cache;

use crate::config::AppConfig;
use crate::db::DbPool;
use crate::job_manager::JobManager;
use crate::models::{ConfigResponse, DataResponse};

#[derive(Clone)]
pub struct AppCache {
    pub years: Cache<(), Vec<i64>>,
    pub config: Cache<i64, ConfigResponse>,
    pub data: Cache<(i64, String, Option<String>), DataResponse>,
}

impl AppCache {
    pub fn new() -> Self {
        Self {
            years: Cache::builder()
                .time_to_live(Duration::from_secs(600))
                .max_capacity(10)
                .build(),
            config: Cache::builder()
                .time_to_live(Duration::from_secs(600))
                .max_capacity(100)
                .build(),
            data: Cache::builder()
                .time_to_live(Duration::from_secs(600))
                .max_capacity(5000)
                .build(),
        }
    }

    pub async fn invalidate_all(&self) {
        self.years.invalidate_all();
        self.config.invalidate_all();
        self.data.invalidate_all();
    }
}

impl Default for AppCache {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub db_pool: DbPool,
    pub job_manager: JobManager,
    pub geojson_cache: Arc<Bytes>,
    pub cache: AppCache,
}
