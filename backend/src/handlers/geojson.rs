use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::HeaderMap;
use bytes::Bytes;

use crate::security::AppError;
use crate::state::AppState;

pub async fn get_geojson(
    State(state): State<AppState>,
) -> Result<(HeaderMap, Bytes), AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert(
        CACHE_CONTROL,
        "public, max-age=31536000, immutable".parse().unwrap(),
    );

    Ok((headers, (*state.geojson_cache).clone()))
}
