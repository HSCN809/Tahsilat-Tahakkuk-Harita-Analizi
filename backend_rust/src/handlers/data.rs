use axum::extract::{Query, State};
use axum::Json;

use crate::db;
use crate::models::{ConfigQuery, ConfigResponse, DataQuery, DataResponse, YearsResponse};
use crate::security::{validate_year, AppError};
use crate::state::AppState;

pub async fn get_years(
    State(state): State<AppState>,
) -> Result<Json<YearsResponse>, AppError> {
    let conn = state
        .db_pool
        .get()
        .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;

    let years = db::get_years(&conn)?;
    Ok(Json(YearsResponse { years }))
}

pub async fn get_config(
    State(state): State<AppState>,
    Query(query): Query<ConfigQuery>,
) -> Result<Json<ConfigResponse>, AppError> {
    validate_year(query.year)?;

    let conn = state
        .db_pool
        .get()
        .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;

    let config = db::get_config(&conn, query.year)?;
    Ok(Json(config))
}

pub async fn get_data(
    State(state): State<AppState>,
    Query(query): Query<DataQuery>,
) -> Result<Json<DataResponse>, AppError> {
    validate_year(query.year)?;

    let conn = state
        .db_pool
        .get()
        .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;

    let response = db::get_data(
        &conn,
        query.year,
        &query.category,
        query.month.as_deref(),
    )?;

    Ok(Json(response))
}
