use crate::auth::{self, AuthError, DriveRole};
use crate::room::{ClientInfo, RoomManager};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// Query parameters for the WebSocket endpoint.
#[derive(Deserialize)]
pub struct WsParams {
    /// Google OAuth2 access token.
    pub token: String,
}

/// Shared application state passed to all handlers.
pub struct AppState {
    pub room_manager: RoomManager,
}

/// Handler for `GET /ws/:room_id?token=<access_token>`.
///
/// Validates the user's Google access token, checks their Drive permissions
/// for the sheet (room), and upgrades to a WebSocket connection if authorized.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<String>,
    Query(params): Query<WsParams>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let token = params.token.clone();
    let room_id_clone = room_id.clone();

    // Validate token and check permissions before upgrading.
    let user_info = match auth::validate_token(&token).await {
        Ok(info) => info,
        Err(e) => {
            warn!(room_id = %room_id, error = %e, "Auth validation failed");
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                format!("Authentication failed: {}", e),
            )
                .into_response();
        }
    };

    let role = match auth::check_drive_permission(&token, &room_id).await {
        Ok(role) => role,
        Err(AuthError::NoAccess(msg)) => {
            warn!(
                room_id = %room_id,
                user = %user_info.email,
                error = %msg,
                "Drive permission denied"
            );
            return (
                axum::http::StatusCode::FORBIDDEN,
                format!("Access denied: {}", msg),
            )
                .into_response();
        }
        Err(e) => {
            error!(
                room_id = %room_id,
                user = %user_info.email,
                error = %e,
                "Drive permission check failed"
            );
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Permission check failed: {}", e),
            )
                .into_response();
        }
    };

    info!(
        room_id = %room_id_clone,
        user = %user_info.email,
        role = ?role,
        "WebSocket upgrade authorized"
    );

    // Upgrade the connection to WebSocket
    ws.on_upgrade(move |socket| {
        handle_websocket(socket, room_id_clone, user_info, role, state)
    })
    .into_response()
}

/// Handle a single WebSocket connection after auth has been verified.
///
/// Joins the room, then runs two concurrent loops:
/// 1. Forward messages from the client's WebSocket to the room
/// 2. Forward messages from the room to the client's WebSocket
async fn handle_websocket(
    socket: WebSocket,
    room_id: String,
    user_info: auth::UserInfo,
    role: DriveRole,
    state: Arc<AppState>,
) {
    let client_id = state.room_manager.next_client_id();
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Channel for room -> client messages
    let (room_tx, mut room_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let client_info = ClientInfo {
        user: user_info.clone(),
        role,
    };

    // Join the room
    state.room_manager.join_room(
        &room_id,
        client_id,
        client_info,
        room_tx,
    );

    info!(
        room_id = %room_id,
        client_id = client_id,
        user = %user_info.email,
        "WebSocket connection established"
    );

    // Task 1: Forward messages from room -> WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(data) = room_rx.recv().await {
            if ws_sender.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Task 2: Forward messages from WebSocket -> room (runs in current task)
    let room_id_recv = room_id.clone();
    let room_manager = &state.room_manager;

    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Binary(data)) => {
                room_manager.send_message(&room_id_recv, client_id, data.to_vec());
            }
            Ok(Message::Close(_)) => {
                info!(
                    room_id = %room_id_recv,
                    client_id = client_id,
                    "Client sent close frame"
                );
                break;
            }
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                // axum handles ping/pong automatically
            }
            Ok(Message::Text(_)) => {
                // Yjs protocol uses binary messages only; ignore text
                warn!(
                    room_id = %room_id_recv,
                    client_id = client_id,
                    "Received unexpected text message, ignoring"
                );
            }
            Err(e) => {
                warn!(
                    room_id = %room_id_recv,
                    client_id = client_id,
                    error = %e,
                    "WebSocket error"
                );
                break;
            }
        }
    }

    // Client disconnected: leave the room and stop the send task
    state.room_manager.leave_room(&room_id, client_id);
    send_task.abort();

    info!(
        room_id = %room_id,
        client_id = client_id,
        user = %user_info.email,
        "WebSocket connection closed"
    );
}
