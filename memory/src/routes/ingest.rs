use axum::{
    extract::{Multipart, State},
    http::HeaderMap,
    Json,
};
use std::time::Instant;

use crate::auth;
use crate::error::AppError;
use crate::models::{IngestResponse, SourceType};
use crate::AppState;

/// Stub handler for `POST /memory/ingest`.
///
/// Accepts a multipart form with `repo_tag`, `source_type`, and `source`
/// fields. Validates the fields and returns a success response.
///
/// Multipart fields:
///   - `repo_tag`    (text): identifier for the source repository
///   - `source_type` (text): `"zip"` or `"github_url"`
///   - `source`      (text or file): URL string or uploaded zip file
///
/// In Phase 2/3, this will:
///   - Download the GitHub repo tarball (for `github_url`)
///   - Unzip and walk files (for both `zip` and `github_url`)
///   - Chunk, embed, and store in `memory_chunks`
pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<IngestResponse>, AppError> {
    auth::verify_api_key(&headers, &state.api_key)?;

    let start = Instant::now();

    let mut repo_tag: Option<String> = None;
    let mut source_type: Option<SourceType> = None;
    let mut _source_value: Option<String> = None;

    // Parse the multipart form fields.
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(format!("failed to read multipart field: {e}"))
    })? {
        let name = field
            .name()
            .unwrap_or("")
            .to_string();

        match name.as_str() {
            "repo_tag" => {
                repo_tag = Some(field.text().await.map_err(|e| {
                    AppError::BadRequest(format!("invalid repo_tag: {e}"))
                })?);
            }
            "source_type" => {
                let raw = field.text().await.map_err(|e| {
                    AppError::BadRequest(format!("invalid source_type: {e}"))
                })?;
                source_type = Some(serde_json::from_str::<SourceType>(
                    &format!("\"{raw}\""),
                )
                .map_err(|_| {
                    AppError::BadRequest(
                        "source_type must be 'zip' or 'github_url'".into(),
                    )
                })?);
            }
            "source" => {
                // In the stub, just capture the text value.
                // In Phase 2/3, this will be a URL string (for github_url)
                // or a binary file stream (for zip).
                _source_value = Some(field.text().await.map_err(|e| {
                    AppError::BadRequest(format!("invalid source: {e}"))
                })?);
            }
            _ => {
                // Ignore unknown fields.
            }
        }
    }

    // Validate required fields.
    let repo_tag = repo_tag.ok_or_else(|| {
        AppError::BadRequest("missing required field: repo_tag".into())
    })?;

    let source_type = source_type.ok_or_else(|| {
        AppError::BadRequest("missing required field: source_type".into())
    })?;

    if _source_value.is_none() {
        return Err(AppError::BadRequest(
            "missing required field: source".into(),
        ));
    }

    // ── Stub: no actual processing ──────────────────────────────────────
    // In Phase 2/3, this will call the ingestion pipeline and return
    // the actual number of files processed.

    Ok(Json(IngestResponse {
        status: "ok".into(),
        repo_tag,
        source_type: match source_type {
            SourceType::Zip => "zip".into(),
            SourceType::GithubUrl => "github_url".into(),
        },
        files_processed: 0,
        message: "Stub: ingestion pipeline not yet implemented. Source accepted.".into(),
        took_ms: start.elapsed().as_millis() as u64,
    }))
}
