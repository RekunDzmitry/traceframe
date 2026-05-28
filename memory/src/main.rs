//! TraceFrame memory service.
//!
//! Provides semantic context retrieval and source ingestion for the
//! TraceFrame observability platform.
//!
//! ## Architecture
//!
//! - `/memory/context` — semantic search over session summaries (pgvector).
//!   Embeds the query via the ingest service's ONNX pipeline, then runs
//!   `embedding <=>` distance ranking on the `memories` table.
//! - `/memory/ingest` — stub (validates fields, returns success).
//! - `/healthz` — liveness check with optional DB ping.

mod auth;
mod config;
mod db;
mod embed;
mod error;
mod models;
mod routes;

use std::sync::Arc;

use axum::Router;
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Shared application state accessible from all route handlers.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool. `None` when DB is unreachable.
    pub db: Option<sqlx::PgPool>,

    /// Embedder for semantic search queries.
    /// `None` when `INGEST_SERVICE_URL` is not configured (stub mode).
    pub embedder: Option<Arc<dyn embed::Embedder + Send + Sync>>,

    /// Bearer token required for authenticated endpoints.
    pub api_key: String,

    /// Service version string (from `CARGO_PKG_VERSION`).
    pub service_version: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Logging ─────────────────────────────────────────────────────────
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,traceframe_memory=debug")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // ── Configuration ───────────────────────────────────────────────────
    let cfg = config::Config::from_env();

    // ── Database ────────────────────────────────────────────────────────
    let db_pool = match db::create_pool(&cfg.database_url).await {
        Ok(pool) => {
            tracing::info!("connected to PostgreSQL");
            Some(pool)
        }
        Err(e) => {
            tracing::warn!("database unavailable — running without DB: {e}");
            None
        }
    };

    // ── Embedder ────────────────────────────────────────────────────────
    let embedder = embed::create_embedder(cfg.ingest_service_url.clone(), &cfg.api_key);

    // ── Shared state ────────────────────────────────────────────────────
    let state = AppState {
        db: db_pool,
        embedder,
        api_key: cfg.api_key,
        service_version: env!("CARGO_PKG_VERSION").into(),
    };

    // ── Router ──────────────────────────────────────────────────────────
    // Health endpoint — no auth, no rate limiting.
    let health = Router::new()
        .route("/healthz", axum::routing::get(routes::health::handler));

    // API routes — auth required, rate-limited.
    let mut api = Router::new()
        .route(
            "/memory/context",
            axum::routing::post(routes::context::handler),
        )
        .route(
            "/memory/ingest",
            axum::routing::post(routes::ingest::handler),
        );

    // Rate limiting (optional, controlled by RATE_LIMIT_RPS).
    if cfg.rate_limit_rps > 0 {
        let governor_conf = std::sync::Arc::new(
            tower_governor::governor::GovernorConfigBuilder::default()
                .key_extractor(tower_governor::key_extractor::GlobalKeyExtractor)
                .per_second(cfg.rate_limit_rps)
                .burst_size(cfg.rate_limit_burst as u32)
                .finish()
                .expect("governor config build should not fail"),
        );
        tracing::info!(
            "rate limiting enabled: {} rps, burst {}",
            cfg.rate_limit_rps,
            cfg.rate_limit_burst
        );
        api = api.layer(tower_governor::GovernorLayer {
            config: governor_conf,
        });
    } else {
        tracing::info!("rate limiting disabled (RATE_LIMIT_RPS=0)");
    }

    let app = health
        .merge(api)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .layer(RequestBodyLimitLayer::new(100 * 1024 * 1024))
        .with_state(state);

    // ── Listen ──────────────────────────────────────────────────────────
    let addr = format!("0.0.0.0:{}", cfg.port);
    tracing::info!(
        "traceframe-memory v{} starting on {addr}",
        env!("CARGO_PKG_VERSION")
    );

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
