use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;

/// Application-level errors mapped to HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("authentication failed: {0}")]
    Auth(#[from] AuthError),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("embedding failed: {0}")]
    Embed(#[from] crate::embed::EmbedError),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing Authorization header")]
    Missing,
    #[error("malformed Authorization header — expected 'Bearer <token>'")]
    Malformed,
    #[error("invalid API key")]
    Invalid,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, kind, message) = match self {
            AppError::Auth(e) => (StatusCode::UNAUTHORIZED, "unauthorized", e.to_string()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, "invalid_request", m),
            AppError::Embed(e) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "embedder_unavailable",
                e.to_string(),
            ),
            AppError::Internal(e) => {
                tracing::error!("{:#}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "internal server error".to_string(),
                )
            }
        };

        let body = json!({
            "error": kind,
            "message": message,
        });

        (status, Json(body)).into_response()
    }
}
