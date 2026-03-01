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
    /// - `RELAY_PORT` — port number (default: 4000)
    /// - `RELAY_ALLOWED_ORIGINS` — comma-separated CORS origins
    ///   (default: "http://localhost:5173")
    pub fn from_env() -> Self {
        let host = env::var("RELAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

        let port = env::var("RELAY_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(4000);

        let allowed_origins = env::var("RELAY_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

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

    #[test]
    fn test_default_config() {
        // Clear env vars to test defaults
        env::remove_var("RELAY_HOST");
        env::remove_var("RELAY_PORT");
        env::remove_var("RELAY_ALLOWED_ORIGINS");

        let config = Config::from_env();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 4000);
        assert_eq!(config.allowed_origins, vec!["http://localhost:5173"]);
    }
}
