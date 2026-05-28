use axum::{extract::State, http::HeaderMap, Json};
use std::time::Instant;

use sqlx::Row;

use crate::auth;
use crate::error::AppError;
use crate::models::{ContextRequest, ContextResponse};
use crate::AppState;

/// Semantic context retrieval via pgvector search on the `memories` table.
///
/// Flow:
/// 1. Validates the Bearer token.
/// 2. Embeds the query via the configured embedder (delegates to ingest service).
/// 3. Queries `memories` with `embedding <=>` cosine distance ranking.
/// 4. Returns ranked results with scores.
///
/// Falls back to stub mode when either the embedder or database is unavailable.
pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ContextRequest>,
) -> Result<Json<ContextResponse>, AppError> {
    auth::verify_api_key(&headers, &state.api_key)?;

    let start = Instant::now();

    // ── Embed the query ─────────────────────────────────────────────────
    let embedding = match &state.embedder {
        Some(embedder) => match embedder.embed(&body.query).await {
            Ok(vec) => vec,
            Err(e) => {
                tracing::warn!("embedding failed, falling back to stub: {e}");
                return Ok(stub_response(&body, start));
            }
        },
        None => {
            return Ok(stub_response(&body, start));
        }
    };

    // ── Query the database ──────────────────────────────────────────────
    let db = match &state.db {
        Some(pool) => pool,
        None => return Ok(stub_response(&body, start)),
    };

    // Format the embedding as a pgvector literal: "[0.1,0.2,...]"
    let vec_literal = format!(
        "[{}]",
        embedding
            .iter()
            .map(|f| f.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let rows = sqlx::query(
        r#"
        SELECT m.id,
               m.repo_tag,
               m.kind,
               m.summary,
               m.created_at,
               m.session_id,
               m.trace_id,
               m.meta,
               (m.embedding <=> $1::vector) AS distance
          FROM memories m
         WHERE m.embedding IS NOT NULL
           AND ($2::text IS NULL OR m.repo_tag = $2)
         ORDER BY m.embedding <=> $1::vector
         LIMIT $3
        "#,
    )
    .bind(&vec_literal)
    .bind(&body.repo_tag)
    .bind(body.max_results as i64)
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("pgvector search failed: {e}");
        AppError::Internal(anyhow::anyhow!("database search failed: {e}"))
    })?;

    // ── Map results ─────────────────────────────────────────────────────
    let results = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let repo_tag: String = row.get("repo_tag");
            let kind: String = row.get("kind");
            let summary: String = row.get("summary");
            let created_at: Option<chrono::DateTime<chrono::Utc>> = row.get("created_at");
            let session_id: Option<String> = row.get("session_id");
            let trace_id: Option<String> = row.get("trace_id");
            let meta: serde_json::Value = row.get("meta");
            let distance: f64 = row.get("distance");

            // Convert cosine distance to similarity score (0.0–1.0).
            // pgvector <=> returns cosine distance: 0 = identical, 2 = opposite.
            let score = 1.0 / (1.0 + distance);

            crate::models::ContextResult {
                id,
                repo_tag,
                kind,
                summary,
                score: ((score * 100.0) as f64).round() / 100.0, // round to 2 decimal places
                created_at: created_at.map(|dt: chrono::DateTime<chrono::Utc>| dt.to_rfc3339()),
                session_id,
                trace_id,
                meta,
            }
        })
        .collect();

    Ok(Json(ContextResponse {
        query: body.query,
        results,
        took_ms: start.elapsed().as_millis() as u64,
        mode: "live".into(),
    }))
}

/// Fallback stub response — returned when the embedder or database
/// is unavailable.
fn stub_response(
    body: &ContextRequest,
    start: Instant,
) -> Json<ContextResponse> {
    let results = vec![crate::models::ContextResult {
        id: 0,
        repo_tag: body.repo_tag.clone().unwrap_or_default(),
        kind: "stub".into(),
        summary: format!(
            "Memory service stub: context retrieval not yet available. \
             Your query was: '{}'",
            body.query
        ),
        score: 0.0,
        created_at: None,
        session_id: None,
        trace_id: None,
        meta: serde_json::json!({
            "max_results": body.max_results,
        }),
    }];

    Json(ContextResponse {
        query: body.query.clone(),
        results,
        took_ms: start.elapsed().as_millis() as u64,
        mode: "stub".into(),
    })
}
