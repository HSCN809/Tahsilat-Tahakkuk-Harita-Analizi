use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootResponse {
    pub status: String,
    pub message: String,
    pub endpoints: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearsResponse {
    pub years: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryItem {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub year: i64,
    pub months: Vec<String>,
    pub categories: Vec<CategoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvinceRecord {
    pub province: String,
    pub accrual: Option<f64>,
    pub collection: Option<f64>,
    pub ratio: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryData {
    pub total_accrual: f64,
    pub total_collection: f64,
    pub overall_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataResponse {
    pub year: i64,
    pub category: String,
    pub summary: SummaryData,
    pub data: Vec<ProvinceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapResponse {
    pub years: Vec<i64>,
    pub config: Option<ConfigResponse>,
    pub data: Option<DataResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    pub id: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilesResponse {
    pub year: i64,
    pub files: Vec<FileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobInfo {
    pub job_id: String,
    pub year_input: String,
    pub started_at: f64,
    pub finished_at: Option<f64>,
    pub status: String, // "running" | "succeeded" | "failed"
    pub error: Option<String>,
    pub backup_created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatusResponse {
    pub running: bool,
    pub last_job: Option<JobInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapeTriggerResponse {
    pub status: String,
    pub job_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfigQuery {
    pub year: i64,
}

#[derive(Debug, Deserialize)]
pub struct DataQuery {
    pub year: i64,
    pub category: String,
    #[serde(default)]
    pub month: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FilesQuery {
    pub year: i64,
}

#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    pub year: i64,
    #[serde(default)]
    pub files: Option<String>,
    #[serde(default)]
    pub all: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ScrapeQuery {
    pub year_input: String,
}
