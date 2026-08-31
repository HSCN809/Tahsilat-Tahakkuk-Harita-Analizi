use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use axum::extract::{Query, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Json;
use tracing::info;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::models::{DownloadQuery, FileItem, FilesQuery, FilesResponse};
use crate::security::{is_safe_filename, validate_year, AppError, MAX_DOWNLOAD_FILES};
use crate::state::AppState;

fn get_raw_dir(data_dir: &Path, year: i64) -> PathBuf {
    // 1. Olası ana klasör isimleri
    let folder_templates = [
        format!("Tahsilat Tahakkuk Excel Dosyaları/İllere Göre Tahsilat Tahakkuk {}", year),
        format!("İllere Göre Tahsilat Tahakkuk (Yıllara Göre)/İllere Göre Tahsilat Tahakkuk {}", year),
        format!("İllere Göre Tahsilat Tahakkuk {}", year),
    ];

    for tmpl in folder_templates {
        let p = data_dir.join(&tmpl).join("raw_xls");
        if p.is_dir() {
            return p;
        }
    }

    // Fallback: data_dir/raw_xls
    data_dir.join("raw_xls")
}

fn list_raw_files_from_dir(raw_dir: &Path) -> Result<Vec<FileItem>, AppError> {
    if !raw_dir.is_dir() {
        return Err(AppError::NotFound("Ham veri klasörü bulunamadı.".to_string()));
    }

    let mut files = Vec::new();
    let entries = std::fs::read_dir(raw_dir)
        .map_err(|e| AppError::Internal(format!("Dizin okunamadı: {}", e)))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                if fname.to_lowercase().ends_with(".xls") {
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let stem = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(fname)
                        .to_string();

                    files.push(FileItem {
                        id: stem,
                        name: fname.to_string(),
                        size,
                    });
                }
            }
        }
    }

    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

pub async fn list_files(
    State(state): State<AppState>,
    Query(query): Query<FilesQuery>,
) -> Result<Json<FilesResponse>, AppError> {
    validate_year(query.year)?;
    let raw_dir = get_raw_dir(&state.config.data_dir, query.year);
    let files = list_raw_files_from_dir(&raw_dir)?;

    Ok(Json(FilesResponse {
        year: query.year,
        files,
    }))
}

pub async fn download_files(
    State(state): State<AppState>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, AppError> {
    validate_year(query.year)?;
    let raw_dir = get_raw_dir(&state.config.data_dir, query.year);
    let available_files = list_raw_files_from_dir(&raw_dir)?;

    let is_all = query.all.unwrap_or(false);
    let selected: Vec<FileItem> = if is_all {
        available_files
    } else {
        let requested_raw = query.files.unwrap_or_default();
        let requested: Vec<&str> = requested_raw
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        if requested.is_empty() {
            return Err(AppError::BadRequest("İndirilecek dosya seçilmedi.".to_string()));
        }

        let map: HashMap<&str, &FileItem> = available_files.iter().map(|f| (f.id.as_str(), f)).collect();

        let mut sel = Vec::new();
        for r in requested {
            if let Some(item) = map.get(r) {
                sel.push((*item).clone());
            } else {
                return Err(AppError::BadRequest(format!("Geçersiz dosya seçimi: {}", r)));
            }
        }
        sel
    };

    if selected.is_empty() {
        return Err(AppError::NotFound(format!(
            "{} yılı için indirilebilir ham dosya bulunamadı.",
            query.year
        )));
    }

    if selected.len() > MAX_DOWNLOAD_FILES {
        return Err(AppError::BadRequest(format!(
            "Tek seferde en fazla {} dosya indirilebilir.",
            MAX_DOWNLOAD_FILES
        )));
    }

    // ZIP arşivini bellekte oluştur
    let mut zip_buffer = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut zip_buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for file_item in &selected {
            if !is_safe_filename(&file_item.name) {
                continue;
            }

            let file_path = raw_dir.join(&file_item.name);
            if let Ok(mut f) = File::open(&file_path) {
                let _ = zip.start_file(&file_item.name, options);
                let mut content = Vec::new();
                if f.read_to_end(&mut content).is_ok() {
                    let _ = zip.write_all(&content);
                }
            }
        }

        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP arşivi oluşturulamadı: {}", e)))?;
    }

    let zip_bytes = zip_buffer.into_inner();
    let zip_name = format!("tahsilat-tahakkuk-{}-ham-veri.zip", query.year);

    info!(
        "Ham veri indirildi: yıl={} dosya_sayısı={}",
        query.year,
        selected.len()
    );

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/zip".parse().unwrap());
    headers.insert(
        CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", zip_name)
            .parse()
            .unwrap(),
    );

    Ok((headers, zip_bytes).into_response())
}
