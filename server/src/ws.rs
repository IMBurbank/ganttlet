use crate::auth::{self, AuthError, DriveRole};
use crate::room::{ClientInfo, RoomManager};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// JSON payload for the auth message sent by the client.
#[derive(serde::Deserialize)]
struct AuthMessage {
    #[serde(rename = "type")]
    msg_type: String,
    token: String,
}

/// Shared application state passed to all handlers.
pub struct AppState {
    pub room_manager: RoomManager,
}

/// Handler for `GET /ws/:room_id`.
///
/// Upgrades to a WebSocket connection unconditionally. Authentication is
/// performed inside the WebSocket via a first-message auth pattern: the client
/// must send a JSON `{"type":"auth","token":"..."}` text message within 5
/// seconds of connecting.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let room_id_clone = room_id.clone();
    ws.on_upgrade(move |socket| handle_websocket(socket, room_id_clone, state))
        .into_response()
}

/// Wait for the first text message on the WebSocket and parse it as an auth message.
///
/// Skips any binary messages (Yjs messages that arrive before auth).
/// Returns the token string on success.
async fn wait_for_auth(
    ws_receiver: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
) -> Result<String, &'static str> {
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                let auth_msg: AuthMessage = serde_json::from_str(&text)
                    .map_err(|_| "Invalid auth message format")?;
                if auth_msg.msg_type != "auth" {
                    return Err("Expected auth message type");
                }
                if auth_msg.token.is_empty() {
                    return Err("Empty token");
                }
                return Ok(auth_msg.token);
            }
            Ok(Message::Binary(_)) => {
                // Skip binary messages (Yjs messages arriving before auth)
                continue;
            }
            Ok(Message::Close(_)) => {
                return Err("Connection closed before auth");
            }
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                continue;
            }
            Err(_) => {
                return Err("WebSocket error before auth");
            }
        }
    }
    Err("Connection ended before auth")
}

/// Handle a single WebSocket connection.
///
/// Waits for an auth message, validates the token and Drive permissions,
/// then joins the room and runs the send/receive loops.
async fn handle_websocket(socket: WebSocket, room_id: String, state: Arc<AppState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Wait for auth message with a 5-second timeout
    let auth_result = tokio::time::timeout(
        Duration::from_secs(5),
        wait_for_auth(&mut ws_receiver),
    )
    .await;

    let token = match auth_result {
        Ok(Ok(token)) => token,
        Ok(Err(reason)) => {
            warn!(room_id = %room_id, reason = reason, "Auth message rejected");
            let _ = ws_sender
                .send(Message::Text(
                    r#"{"type":"error","message":"Authentication failed"}"#.into(),
                ))
                .await;
            return;
        }
        Err(_) => {
            warn!(room_id = %room_id, "Auth timeout — no auth message within 5 seconds");
            let _ = ws_sender
                .send(Message::Text(
                    r#"{"type":"error","message":"Auth timeout"}"#.into(),
                ))
                .await;
            return;
        }
    };

    // Validate the token with Google
    let user_info = match auth::validate_token(&token).await {
        Ok(info) => info,
        Err(e) => {
            warn!(room_id = %room_id, error = %e, "Auth validation failed");
            let _ = ws_sender
                .send(Message::Text(
                    r#"{"type":"error","message":"Authentication failed"}"#.into(),
                ))
                .await;
            return;
        }
    };

    // Check Drive permissions for the room (sheet)
    let role = match auth::check_drive_permission(&token, &room_id).await {
        Ok(role) => role,
        Err(AuthError::NoAccess(msg)) => {
            warn!(
                room_id = %room_id,
                user = %user_info.email,
                error = %msg,
                "Drive permission denied"
            );
            let _ = ws_sender
                .send(Message::Text(
                    r#"{"type":"error","message":"Access denied"}"#.into(),
                ))
                .await;
            return;
        }
        Err(e) => {
            error!(
                room_id = %room_id,
                user = %user_info.email,
                error = %e,
                "Drive permission check failed"
            );
            let _ = ws_sender
                .send(Message::Text(
                    r#"{"type":"error","message":"Authentication failed"}"#.into(),
                ))
                .await;
            return;
        }
    };

    info!(
        room_id = %room_id,
        user = %user_info.email,
        role = ?role,
        "WebSocket auth succeeded"
    );

    // Auth passed — join the room and start message forwarding
    let client_id = state.room_manager.next_client_id();

    // Channel for room -> client messages
    let (room_tx, mut room_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let client_info = ClientInfo {
        user: user_info.clone(),
        role,
    };

    state
        .room_manager
        .join_room(&room_id, client_id, client_info, room_tx);

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
                // Yjs protocol uses binary messages only; ignore text after auth
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
