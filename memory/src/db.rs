use sqlx::postgres::PgPoolOptions;

/// Creates a PostgreSQL connection pool.
///
/// Currently unused during the stub phase — the connection is established
/// but no queries are executed. In Phase 1, context and ingestion handlers
/// will use this pool for vector search and chunk storage.
pub async fn create_pool(database_url: &str) -> Result<sqlx::PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}
