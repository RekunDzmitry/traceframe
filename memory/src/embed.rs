//! Embedder abstraction for semantic search.
//!
//! The `Embedder` trait provides a uniform interface for generating
//! 384-dimensional text embeddings. Two implementations are planned:
//!
//! - `RemoteEmbedder` (current): delegates to the ingest service's
//!   local ONNX pipeline via HTTP. No ML dependencies in Rust.
//! - `LocalEmbedder` (future): runs the ONNX model directly via `ort`.

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

// ─── Error ─────────────────────────────────────────────────────────────────

/// Errors that can occur during embedding generation.
#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    #[error("embedding service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("embedding service returned unexpected response: {0}")]
    BadResponse(String),

    #[error("embedding service error: {0}")]
    ApiError(String),
}

impl From<reqwest::Error> for EmbedError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() {
            EmbedError::ServiceUnavailable(e.to_string())
        } else {
            EmbedError::BadResponse(e.to_string())
        }
    }
}

// ─── Trait ─────────────────────────────────────────────────────────────────

/// Generates 384-dimensional normalized text embeddings.
#[async_trait]
pub trait Embedder: Send + Sync {
    /// Embed a single text query.
    ///
    /// Returns a 384-element `Vec<f32>` or an `EmbedError` if the
    /// embedding service is unreachable or returns an error.
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError>;
}

// ─── Remote embedder (delegates to ingest service) ─────────────────────────

/// JSON response from `POST /ingest/embed`.
#[derive(Debug, Deserialize)]
struct IngestEmbedResponse {
    embedding: Vec<f32>,
}

/// Embeds text by calling the ingest service's local ONNX pipeline over HTTP.
///
/// The ingest service runs `@huggingface/transformers` with
/// `Xenova/all-MiniLM-L6-v2` (384-dim). This embedder POSTs to
/// `{ingest_url}/ingest/embed` with a JSON body `{"text":"..."}`.
#[derive(Clone)]
pub struct RemoteEmbedder {
    client: Client,
    ingest_url: String,
    api_key: String,
}

impl RemoteEmbedder {
    /// Create a new remote embedder.
    ///
    /// `ingest_url` should be the base URL of the ingest service
    /// (e.g. `http://localhost:4000` or `http://ingest:4000` in Docker).
    /// `api_key` is the shared `TRACEFRAME_API_KEY` for auth.
    pub fn new(ingest_url: String, api_key: String) -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest Client::build should not fail");
        Self {
            client,
            ingest_url: ingest_url.trim_end_matches('/').to_string(),
            api_key,
        }
    }
}

#[async_trait]
impl Embedder for RemoteEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let url = format!("{}/ingest/embed", self.ingest_url);

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&serde_json::json!({ "text": text }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(EmbedError::ApiError(format!(
                "ingest returned {status}: {body}"
            )));
        }

        let data: IngestEmbedResponse = resp.json().await.map_err(|e| {
            EmbedError::BadResponse(format!("failed to parse embed response: {e}"))
        })?;

        Ok(data.embedding)
    }
}

// ─── Noop embedder (stub mode) ─────────────────────────────────────────────

/// A no-operation embedder that always returns an error.
/// Used when `INGEST_SERVICE_URL` is not configured.
#[derive(Clone)]
pub struct NoopEmbedder;

#[async_trait]
impl Embedder for NoopEmbedder {
    async fn embed(&self, _text: &str) -> Result<Vec<f32>, EmbedError> {
        Err(EmbedError::ServiceUnavailable(
            "no embedder configured (set INGEST_SERVICE_URL)".into(),
        ))
    }
}

// ─── Factory ───────────────────────────────────────────────────────────────

/// Create an embedder from configuration.
///
/// Returns `None` when `INGEST_SERVICE_URL` is empty or not set,
/// signalling that the context handler should fall back to stub mode.
pub fn create_embedder(ingest_url: Option<String>, api_key: &str) -> Option<Arc<dyn Embedder + Send + Sync>> {
    match ingest_url {
        Some(url) if !url.is_empty() => Some(Arc::new(RemoteEmbedder::new(url, api_key.to_string()))),
        _ => {
            tracing::warn!("INGEST_SERVICE_URL not set — context search limited to stub mode");
            None
        }
    }
}
