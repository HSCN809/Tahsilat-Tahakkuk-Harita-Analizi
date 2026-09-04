use axum::extract::{Query, State};
use axum::Json;

use crate::db;
use crate::models::{BootstrapResponse, ConfigQuery, ConfigResponse, DataQuery, DataResponse, YearsResponse};
use crate::security::{validate_year, AppError};
use crate::state::AppState;

pub async fn get_years(
    State(state): State<AppState>,
) -> Result<Json<YearsResponse>, AppError> {
    if let Some(years) = state.cache.years.get(&()).await {
        return Ok(Json(YearsResponse { years }));
    }

    let pool = state.db_pool.clone();
    let years = tokio::task::spawn_blocking(move || -> Result<Vec<i64>, AppError> {
        let conn = pool
            .get()
            .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
        db::get_years(&conn)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

    state.cache.years.insert((), years.clone()).await;
    Ok(Json(YearsResponse { years }))
}

pub async fn get_config(
    State(state): State<AppState>,
    Query(query): Query<ConfigQuery>,
) -> Result<Json<ConfigResponse>, AppError> {
    validate_year(query.year)?;

    if let Some(config) = state.cache.config.get(&query.year).await {
        return Ok(Json(config));
    }

    let pool = state.db_pool.clone();
    let year = query.year;
    let config = tokio::task::spawn_blocking(move || -> Result<ConfigResponse, AppError> {
        let conn = pool
            .get()
            .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
        db::get_config(&conn, year)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

    state.cache.config.insert(query.year, config.clone()).await;
    Ok(Json(config))
}

pub async fn get_data(
    State(state): State<AppState>,
    Query(query): Query<DataQuery>,
) -> Result<Json<DataResponse>, AppError> {
    validate_year(query.year)?;

    let cache_key = (query.year, query.category.clone(), query.month.clone());
    if let Some(response) = state.cache.data.get(&cache_key).await {
        return Ok(Json(response));
    }

    let pool = state.db_pool.clone();
    let year = query.year;
    let category = query.category.clone();
    let month = query.month.clone();

    let response = tokio::task::spawn_blocking(move || -> Result<DataResponse, AppError> {
        let conn = pool
            .get()
            .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
        db::get_data(&conn, year, &category, month.as_deref())
    })
    .await
    .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

    state.cache.data.insert(cache_key, response.clone()).await;
    Ok(Json(response))
}

pub async fn get_bootstrap(
    State(state): State<AppState>,
) -> Result<Json<BootstrapResponse>, AppError> {
    // 1. Yılları al (varsa cache, yoksa DB)
    let years = if let Some(years) = state.cache.years.get(&()).await {
        years
    } else {
        let pool = state.db_pool.clone();
        let years = tokio::task::spawn_blocking(move || -> Result<Vec<i64>, AppError> {
            let conn = pool
                .get()
                .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
            db::get_years(&conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

        state.cache.years.insert((), years.clone()).await;
        years
    };

    if years.is_empty() {
        return Ok(Json(BootstrapResponse {
            years,
            config: None,
            data: None,
        }));
    }

    let latest_year = *years.last().unwrap();

    // 2. En güncel yılın config'ini al (varsa cache, yoksa DB)
    let config = if let Some(config) = state.cache.config.get(&latest_year).await {
        config
    } else {
        let pool = state.db_pool.clone();
        let config = tokio::task::spawn_blocking(move || -> Result<ConfigResponse, AppError> {
            let conn = pool
                .get()
                .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
            db::get_config(&conn, latest_year)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

        state.cache.config.insert(latest_year, config.clone()).await;
        config
    };

    // 3. İlk varsayılan kategori ve son ayı belirle
    let default_category = config.categories.first().map(|c| c.id.clone());
    let default_month = config.months.last().cloned();

    let data = if let (Some(category), Some(month)) = (default_category, default_month) {
        let cache_key = (latest_year, category.clone(), Some(month.clone()));
        let data = if let Some(data) = state.cache.data.get(&cache_key).await {
            data
        } else {
            let pool = state.db_pool.clone();
            let cat = category.clone();
            let m = month.clone();
            let data = tokio::task::spawn_blocking(move || -> Result<DataResponse, AppError> {
                let conn = pool
                    .get()
                    .map_err(|e| AppError::Internal(format!("Veritabanı bağlantısı alınamadı: {}", e)))?;
                db::get_data(&conn, latest_year, &cat, Some(&m))
            })
            .await
            .map_err(|e| AppError::Internal(format!("Tokio spawn_blocking hatası: {}", e)))??;

            state.cache.data.insert(cache_key, data.clone()).await;
            data
        };
        Some(data)
    } else {
        None
    };

    Ok(Json(BootstrapResponse {
        years,
        config: Some(config),
        data,
    }))
}
