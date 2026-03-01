mod auth;
mod config;
mod room;
mod ws;

use axum::{routing::get, Router};
use config::Config;
use room::RoomManager;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::info;
use ws::AppState;

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env();

    info!(
        host = %config.host,
        port = config.port,
        origins = ?config.allowed_origins,
        "Starting Ganttlet relay server"
    );

    // Build CORS layer from configured origins
    let cors = build_cors_layer(&config.allowed_origins);

    // Shared application state
    let state = Arc::new(AppState {
        room_manager: RoomManager::new(),
    });

    // Build the router
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/ws/{room_id}", get(ws::ws_handler))
        .layer(cors)
        .with_state(state);

    // Bind and serve
    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    info!(addr = %addr, "Relay server listening");

    // Serve with graceful shutdown on Ctrl+C
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");

    info!("Relay server shut down");
}

/// Health check endpoint. Returns 200 "ok".
async fn health_handler() -> &'static str {
    "ok"
}

/// Build a CORS layer from the list of allowed origins.
fn build_cors_layer(origins: &[String]) -> CorsLayer {
    if origins.is_empty() || origins.iter().any(|o| o == "*") {
        CorsLayer::permissive()
    } else {
        let parsed: Vec<_> = origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new().allow_origin(AllowOrigin::list(parsed))
    }
}

/// Wait for a shutdown signal (Ctrl+C or SIGTERM).
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("Received Ctrl+C, shutting down"),
        _ = terminate => info!("Received SIGTERM, shutting down"),
    }
}
