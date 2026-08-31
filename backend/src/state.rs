use std::sync::Arc;
use serde_json::Value;

use crate::config::AppConfig;
use crate::db::DbPool;
use crate::job_manager::JobManager;

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub db_pool: DbPool,
    pub job_manager: JobManager,
    pub geojson_cache: Arc<Value>,
}
