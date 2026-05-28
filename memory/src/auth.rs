use axum::http::HeaderMap;

use crate::error::AuthError;

/// Validates the `Authorization: Bearer <token>` header against the configured API key.
///
/// This matches the auth pattern used by the existing `ingest` service
/// (simple string comparison, no JWTs or scopes).
pub fn verify_api_key(headers: &HeaderMap, api_key: &str) -> Result<(), AuthError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(AuthError::Missing)?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or(AuthError::Malformed)?;

    if token != api_key {
        return Err(AuthError::Invalid);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(bearer: &str) -> HeaderMap {
        let mut m = HeaderMap::new();
        m.insert("authorization", HeaderValue::from_str(bearer).unwrap());
        m
    }

    #[test]
    fn valid_token() {
        assert!(verify_api_key(&headers("Bearer secret123"), "secret123").is_ok());
    }

    #[test]
    fn missing_header() {
        let m = HeaderMap::new();
        assert!(matches!(
            verify_api_key(&m, "secret"),
            Err(AuthError::Missing)
        ));
    }

    #[test]
    fn malformed_no_bearer() {
        assert!(matches!(
            verify_api_key(&headers("secret123"), "secret123"),
            Err(AuthError::Malformed)
        ));
    }

    #[test]
    fn wrong_token() {
        assert!(matches!(
            verify_api_key(&headers("Bearer wrong"), "secret"),
            Err(AuthError::Invalid)
        ));
    }
}
