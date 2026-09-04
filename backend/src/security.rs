use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use regex::Regex;
use serde_json::json;
use subtle::ConstantTimeEq;
use std::sync::LazyLock;

pub const MIN_YEAR: i64 = 2000;
pub const MAX_YEAR: i64 = 2100;
pub const MAX_DOWNLOAD_FILES: usize = 200;

static YEAR_INPUT_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(hepsi|\d{4}(-\d{4})?(,\d{4}(-\d{4})?)*)$").unwrap()
});

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    NotFound(String),
    Conflict(String),
    ServiceUnavailable(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            AppError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(json!({
            "detail": message
        }));

        (status, body).into_response()
    }
}

pub fn validate_year(year: i64) -> Result<(), AppError> {
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return Err(AppError::BadRequest(format!(
            "Geçersiz yıl: {}. Yıl {}-{} aralığında olmalı.",
            year, MIN_YEAR, MAX_YEAR
        )));
    }
    Ok(())
}

pub fn validate_year_input(year_input: &str) -> Result<(), AppError> {
    let trimmed = year_input.trim();
    if trimmed.is_empty() || !YEAR_INPUT_REGEX.is_match(trimmed) {
        return Err(AppError::BadRequest(
            "Geçersiz yıl formatı. Örnekler: 2024, 2024-2025, 2024-2025,2023, hepsi".to_string(),
        ));
    }
    Ok(())
}

pub fn verify_scrape_token(
    auth_header: Option<&str>,
    configured_token: &str,
) -> Result<(), AppError> {
    let configured_token = configured_token.trim();
    if configured_token.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "Sunucu yapılandırması eksik: SCRAPE_TOKEN tanımlı değil.".to_string(),
        ));
    }

    let header_val = match auth_header {
        Some(h) if !h.trim().is_empty() => h.trim(),
        _ => return Err(AppError::Unauthorized("Yetkilendirme başlığı eksik.".to_string())),
    };

    let mut parts = header_val.splitn(2, ' ');
    let scheme = parts.next().unwrap_or("");
    let token = parts.next().unwrap_or("");

    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return Err(AppError::Unauthorized(
            "Yalnızca Bearer şeması desteklenir.".to_string(),
        ));
    }

    // Sabit zamanlı (Constant-time) karşılaştırma — Zamanlama saldırılarına karşı koruma
    let token_bytes = token.as_bytes();
    let expected_bytes = configured_token.as_bytes();

    if token_bytes.ct_eq(expected_bytes).into() {
        Ok(())
    } else {
        Err(AppError::Unauthorized("Geçersiz token.".to_string()))
    }
}

pub fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("..")
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

use std::net::{IpAddr, SocketAddr};
use tower_governor::errors::GovernorError;
use tower_governor::key_extractor::KeyExtractor;

fn parse_ip_str(raw: &str) -> Option<IpAddr> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 1. Doğrudan IP adresi (IPv4 veya IPv6: örn. "203.0.113.50" veya "2001:db8::1")
    if let Ok(ip) = trimmed.parse::<IpAddr>() {
        return Some(ip);
    }
    // 2. Port içeren adresler (örn. "203.0.113.50:8080" veya "[2001:db8::1]:8080")
    if let Ok(socket_addr) = trimmed.parse::<SocketAddr>() {
        return Some(socket_addr.ip());
    }
    None
}

#[derive(Clone, Copy, Default)]
pub struct SmartPeerIpExtractor;

impl KeyExtractor for SmartPeerIpExtractor {
    type Key = IpAddr;

    fn extract<B>(&self, req: &axum::http::Request<B>) -> Result<Self::Key, GovernorError> {
        // 1. X-Real-IP (Ters proxy / Nginx tarafından doğrulanmış ve ayarlanmış tekil gerçek istemci IP'si)
        for val in req.headers().get_all("x-real-ip").iter().rev() {
            if let Ok(real_ip_str) = val.to_str() {
                if let Some(ip) = parse_ip_str(real_ip_str) {
                    return Ok(ip);
                }
            }
        }

        // 2. X-Forwarded-For (İstemcinin sahte ilk IP enjekte etmesini önlemek için son eklenen güvenilir proxy IP'si)
        for val in req.headers().get_all("x-forwarded-for").iter().rev() {
            if let Ok(forwarded_str) = val.to_str() {
                if let Some(ip) = forwarded_str.rsplit(',').find_map(parse_ip_str) {
                    return Ok(ip);
                }
            }
        }

        // 3. ConnectInfo extension
        if let Some(connect_info) = req.extensions().get::<axum::extract::ConnectInfo<std::net::SocketAddr>>() {
            return Ok(connect_info.0.ip());
        }

        // 4. Fallback (yerel test veya başlık yoksa 127.0.0.1)
        Ok(IpAddr::from([127, 0, 0, 1]))
    }
}
