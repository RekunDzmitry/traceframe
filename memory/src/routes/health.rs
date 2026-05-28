use axum::{extract::State, http::StatusCode, Json};

use crate::models::HealthResponse;
use crate::AppState;

/// Liveness check — no auth required.
///
/// Pings the database if a pool is configured and reports connectivity
/// via `db_ok`. A failed ping does not change the overall 200 status.
pub async fn handler(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let db_ok = if let Some(ref pool) = state.db {
        sqlx::query("SELECT 1")
            .fetch_one(pool)
            .await
            .is_ok()
    } else {
        false
    };

    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".into(),
            service: "traceframe-memory".into(),
            version: state.service_version.clone(),
            db_ok,
        }),
    )
}
