use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::models::{JobInfo, JobStatusResponse};

#[derive(Clone)]
pub struct JobManager {
    current: Arc<Mutex<Option<JobInfo>>>,
    counter: Arc<AtomicU64>,
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            current: Arc::new(Mutex::new(None)),
            counter: Arc::new(AtomicU64::new(0)),
        }
    }

    fn now_secs() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0)
    }

    fn next_id(&self) -> String {
        let count = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("job-{}-{}", ts, count)
    }

    pub async fn get_status(&self) -> JobStatusResponse {
        let lock = self.current.lock().await;
        match &*lock {
            Some(job) => JobStatusResponse {
                running: job.status == "running",
                last_job: Some(job.clone()),
            },
            None => JobStatusResponse {
                running: false,
                last_job: None,
            },
        }
    }

    pub async fn is_running(&self) -> bool {
        let lock = self.current.lock().await;
        lock.as_ref().map(|j| j.status == "running").unwrap_or(false)
    }

    pub async fn submit<F, Fut>(&self, year_input: String, runner: F) -> (bool, Option<JobInfo>)
    where
        F: FnOnce(String) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<Option<String>, String>> + Send + 'static,
    {
        let mut lock = self.current.lock().await;
        if let Some(ref current_job) = *lock {
            if current_job.status == "running" {
                return (false, Some(current_job.clone()));
            }
        }

        let job_id = self.next_id();
        let started_at = Self::now_secs();

        let initial_job = JobInfo {
            job_id: job_id.clone(),
            year_input: year_input.clone(),
            started_at,
            finished_at: None,
            status: "running".to_string(),
            error: None,
            backup_created: None,
        };

        *lock = Some(initial_job.clone());
        drop(lock);

        let current_clone = Arc::clone(&self.current);
        let year_input_clone = year_input.clone();

        tokio::spawn(async move {
            info!("Scraper arka plan işi başlatıldı: {} ({})", job_id, year_input_clone);
            let result = runner(year_input_clone).await;
            let finished_at = Self::now_secs();

            let mut lock = current_clone.lock().await;
            if let Some(ref mut job) = *lock {
                if job.job_id == job_id {
                    job.finished_at = Some(finished_at);
                    match result {
                        Ok(backup_path) => {
                            job.status = "succeeded".to_string();
                            job.backup_created = backup_path;
                            info!("Scraper işi başarıyla tamamlandı: {}", job_id);
                        }
                        Err(err_msg) => {
                            job.status = "failed".to_string();
                            job.error = Some(err_msg.clone());
                            error!("Scraper işi başarısız oldu: {} | Hata: {}", job_id, err_msg);
                        }
                    }
                }
            }
        });

        (true, Some(initial_job))
    }
}
