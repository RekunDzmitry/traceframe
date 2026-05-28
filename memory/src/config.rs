use std::env;

/// Application configuration parsed from environment variables.
#[derive(Clone, Debug)]
pub struct Config {
    /// Port to bind the HTTP server on.
    pub port: u16,

    /// Bearer token required for all non-healthz endpoints.
    /// Reads `TRACEFRAME_API_KEY` — same env var used by the ingest service.
    pub api_key: String,

    /// PostgreSQL connection string. Optional during stub phase.
    pub database_url: String,

    /// Base URL of the ingest service for embedding delegation.
    /// When empty or unset, context search falls back to stub mode.
    /// Example: `http://localhost:4000` or `http://ingest:4000` (Docker).
    pub ingest_service_url: Option<String>,

    /// Rate limiting: maximum requests per second (global).
    /// Set to 0 to disable rate limiting entirely.
    pub rate_limit_rps: u64,

    /// Rate limiting: burst size (requests allowed before throttling).
    pub rate_limit_burst: u64,
}

impl Config {
    /// Load configuration from environment variables.
    ///
    /// Panics if `TRACEFRAME_API_KEY` is not set (auth is mandatory).
    /// All other values have sensible defaults.
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv(); // silently ignore missing .env

        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(4001);

        let api_key = env::var("TRACEFRAME_API_KEY").unwrap_or_else(|_| {
            eprintln!("FATAL: TRACEFRAME_API_KEY environment variable is required");
            std::process::exit(1);
        });

        let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
            let host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "localhost".into());
            let port = env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".into());
            let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "traceframe".into());
            let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "traceframe".into());
            let db = env::var("POSTGRES_DB").unwrap_or_else(|_| "traceframe".into());
            format!("postgres://{user}:{pass}@{host}:{port}/{db}")
        });

        let ingest_service_url = env::var("INGEST_SERVICE_URL")
            .ok()
            .filter(|v| !v.is_empty());

        let rate_limit_rps = env::var("RATE_LIMIT_RPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);

        let rate_limit_burst = env::var("RATE_LIMIT_BURST")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(200);

        Config {
            port,
            api_key,
            database_url,
            ingest_service_url,
            rate_limit_rps,
            rate_limit_burst,
        }
    }
}
