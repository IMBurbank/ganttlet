use std::env;

/// Server configuration loaded from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Bind address for the server (default: "0.0.0.0")
    pub host: String,
    /// Port to listen on (default: 4000)
    pub port: u16,
    /// Allowed CORS origins (default: ["http://localhost:5173"])
    pub allowed_origins: Vec<String>,
}

impl Config {
    /// Load configuration from environment variables.
    ///
    /// Environment variables:
    /// - `RELAY_HOST` — bind address (default: "0.0.0.0")
    /// - `RELAY_PORT` — port number (checked first)
    /// - `PORT` — port number fallback (Cloud Run sets this automatically)
    /// - Falls back to 4000 if neither is set
    /// - `RELAY_ALLOWED_ORIGINS` — comma-separated CORS origins
    ///   (default: "http://localhost:5173")
    pub fn from_env() -> Self {
        let host = env::var("RELAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

        // Priority: RELAY_PORT > PORT (Cloud Run) > 4000
        let port = env::var("RELAY_PORT")
            .or_else(|_| env::var("PORT"))
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(4000);

        let mut allowed_origins: Vec<String> = env::var("RELAY_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if allowed_origins.iter().any(|o| o == "*") {
            tracing::error!("RELAY_ALLOWED_ORIGINS contained '*' — wildcard origins are not allowed, filtering out");
            allowed_origins.retain(|o| o != "*");
        }

        if allowed_origins.is_empty() {
            tracing::warn!("RELAY_ALLOWED_ORIGINS is empty — defaulting to http://localhost:5173 (local dev only)");
            allowed_origins = vec!["http://localhost:5173".to_string()];
        }

        Config {
            host,
            port,
            allowed_origins,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Env-var tests must run serially to avoid races.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clear_env() {
        env::remove_var("RELAY_HOST");
        env::remove_var("RELAY_PORT");
        env::remove_var("PORT");
        env::remove_var("RELAY_ALLOWED_ORIGINS");
    }

    #[test]
    fn test_default_config() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();

        let config = Config::from_env();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 4000);
        assert_eq!(config.allowed_origins, vec!["http://localhost:5173"]);
    }

    #[test]
    fn test_port_fallback_to_port_env() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("PORT", "8080");

        let config = Config::from_env();
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn test_relay_port_takes_priority_over_port() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("RELAY_PORT", "4000");
        env::set_var("PORT", "8080");

        let config = Config::from_env();
        assert_eq!(config.port, 4000);
    }

    #[test]
    fn test_empty_origins_defaults_to_localhost() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("RELAY_ALLOWED_ORIGINS", "");

        let config = Config::from_env();
        assert_eq!(config.allowed_origins, vec!["http://localhost:5173"]);
    }

    #[test]
    fn test_wildcard_origin_is_filtered_out_falls_back_to_default() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("RELAY_ALLOWED_ORIGINS", "*");

        let config = Config::from_env();
        assert_eq!(config.allowed_origins, vec!["http://localhost:5173"]);
    }

    #[test]
    fn test_wildcard_mixed_with_valid_keeps_only_valid() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("RELAY_ALLOWED_ORIGINS", "*,http://example.com");

        let config = Config::from_env();
        assert_eq!(config.allowed_origins, vec!["http://example.com"]);
    }

    #[test]
    fn test_multiple_valid_origins_parsed_correctly() {
        let _lock = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("RELAY_ALLOWED_ORIGINS", "http://a.com,http://b.com");

        let config = Config::from_env();
        assert_eq!(
            config.allowed_origins,
            vec!["http://a.com", "http://b.com"]
        );
    }
}
