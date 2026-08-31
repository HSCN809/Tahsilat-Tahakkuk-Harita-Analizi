use axum::extract::State;
use axum::Json;
use serde_json::Value;

use crate::security::AppError;
use crate::state::AppState;

pub async fn get_geojson(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    Ok(Json((*state.geojson_cache).clone()))
}
