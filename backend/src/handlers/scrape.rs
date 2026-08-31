use std::process::Stdio;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::info;

use crate::models::{JobStatusResponse, ScrapeQuery, ScrapeTriggerResponse};
use crate::security::{validate_year_input, verify_scrape_token, AppError};
use crate::state::AppState;

pub async fn get_job_status(
    State(state): State<AppState>,
) -> Json<JobStatusResponse> {
    Json(state.job_manager.get_status().await)
}

pub async fn trigger_scrape(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ScrapeQuery>,
) -> Result<Json<ScrapeTriggerResponse>, AppError> {
    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    verify_scrape_token(auth_header, &state.config.scrape_token)?;
    validate_year_input(&query.year_input)?;

    let python_bin = state.config.python_bin.clone();
    let scraper_path = state.config.scraper_script_path.clone();
    let _db_path = state.config.db_path.clone();

    let (started, info) = state
        .job_manager
        .submit(query.year_input.clone(), move |year_input| async move {
            info!("Scraper süreci başlatılıyor: {} {:?}", scraper_path.display(), year_input);

            let mut child = Command::new(&python_bin)
                .arg(&scraper_path)
                .arg(&year_input)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Python scraper başlatılamadı: {}", e))?;

            if let Some(stdout) = child.stdout.take() {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    info!("[scraper] {}", line);
                }
            }

            let status = child
                .wait()
                .await
                .map_err(|e| format!("Scraper bekleme hatası: {}", e))?;

            if !status.success() {
                return Err(format!("Scraper hata kodu ile sonlandı: {:?}", status.code()));
            }

            info!("Scraper ve SQLite ETL aktarımı başarıyla tamamlandı.");
            Ok(None)
        })
        .await;

    if !started {
        return Err(AppError::Conflict(
            "Zaten çalışan bir scrape işi var. Lütfen mevcut işin bitmesini bekleyin.".to_string(),
        ));
    }

    let job_info = info.ok_or_else(|| AppError::Internal("İş bilgisi oluşturulamadı.".to_string()))?;

    Ok(Json(ScrapeTriggerResponse {
        status: "started".to_string(),
        job_id: job_info.job_id,
        message: format!(
            "Arka planda '{}' yılları için veri çekme işi başlatıldı.",
            query.year_input
        ),
    }))
}
