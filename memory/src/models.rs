use serde::{Deserialize, Serialize};

// ─── Context retrieval ─────────────────────────────────────────────────────

/// Request body for `POST /memory/context`.
#[derive(Debug, Deserialize)]
pub struct ContextRequest {
    /// The natural language query to search for.
    pub query: String,

    /// Optional repo scope filter. When provided, only memories tagged
    /// with this `repo_tag` are considered.
    #[serde(default)]
    pub repo_tag: Option<String>,

    /// Maximum number of results to return (default: 5).
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_max_results() -> usize {
    5
}

/// A single ranked result from context retrieval.
#[derive(Debug, Serialize)]
pub struct ContextResult {
    pub id: i64,
    pub repo_tag: String,
    pub kind: String,
    pub summary: String,
    /// Semantic similarity score (0.0–1.0, higher = better).
    pub score: f64,
    pub created_at: Option<String>,
    pub session_id: Option<String>,
    pub trace_id: Option<String>,
    pub meta: serde_json::Value,
}

/// Response body for `POST /memory/context`.
#[derive(Debug, Serialize)]
pub struct ContextResponse {
    pub query: String,
    pub results: Vec<ContextResult>,
    pub took_ms: u64,
    /// Whether results came from the database or a stub fallback.
    pub mode: String,
}

// ─── Ingestion ──────────────────────────────────────────────────────────────

/// Supported source types for ingestion.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Zip,
    GithubUrl,
}

/// Response body for `POST /memory/ingest`.
#[derive(Debug, Serialize)]
pub struct IngestResponse {
    pub status: String,
    pub repo_tag: String,
    pub source_type: String,
    pub files_processed: usize,
    pub message: String,
    pub took_ms: u64,
}

// ─── Health ─────────────────────────────────────────────────────────────────

/// Response body for `GET /healthz`.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    /// Whether the database connection is healthy.
    pub db_ok: bool,
}
