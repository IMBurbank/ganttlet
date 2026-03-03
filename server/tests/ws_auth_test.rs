use axum::{routing::get, Router};
use futures_util::{SinkExt, StreamExt};
use ganttlet_relay::room::RoomManager;
use ganttlet_relay::ws::{ws_handler, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

/// Start a test server with GANTTLET_TEST_AUTH=1 and return its address.
async fn start_test_server() -> String {
    std::env::set_var("GANTTLET_TEST_AUTH", "1");

    let state = Arc::new(AppState {
        room_manager: RoomManager::new(),
    });

    let app = Router::new()
        .route("/ws/{room_id}", get(ws_handler))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("127.0.0.1:{}", addr.port())
}

/// Connect a WebSocket test client to the given address and room.
async fn connect_ws(
    addr: &str,
    room: &str,
) -> (
    futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
) {
    let url = format!("ws://{}/ws/{}", addr, room);
    let (ws_stream, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    ws_stream.split()
}

#[tokio::test]
async fn binary_messages_before_auth_are_buffered_and_replayed() {
    let addr = start_test_server().await;
    let (mut tx, mut rx) = connect_ws(&addr, "test-room-buffer").await;

    // Send a binary message BEFORE auth (simulates y-websocket SyncStep1).
    // SyncStep1 format: [0 (SYNC)] [0 (STEP1)] [varuint len] [state_vector_bytes]
    // Minimal valid SyncStep1: msg_type=0, sync_type=0, empty state vector (len=1, byte=0)
    let fake_sync_step1: Vec<u8> = vec![0, 0, 1, 0];
    tx.send(Message::Binary(fake_sync_step1.into())).await.unwrap();

    // Now send auth
    tx.send(Message::Text(
        r#"{"type":"auth","token":"test-token"}"#.into(),
    ))
    .await
    .unwrap();

    // After auth, the server should:
    // 1. Replay the buffered SyncStep1 (which triggers a SyncStep2 response)
    // 2. Send the room's SyncStep1 to us (from handle_join)
    // 3. Send the room's SyncStep2 to us (from handle_join)
    // We should receive at least one binary message (the server's SyncStep1/Step2).
    let msg = tokio::time::timeout(std::time::Duration::from_secs(3), rx.next())
        .await
        .expect("Should receive a message within 3s")
        .expect("Stream should not end")
        .expect("Should not be an error");

    assert!(
        msg.is_binary(),
        "Expected binary message from server, got: {:?}",
        msg
    );
}

#[tokio::test]
async fn auth_timeout_closes_connection() {
    let addr = start_test_server().await;
    let (_tx, mut rx) = connect_ws(&addr, "test-room-timeout").await;

    // Don't send any messages — wait for the 5-second timeout
    let start = std::time::Instant::now();

    // The server should close the connection or send an error within ~5 seconds
    let result = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        while let Some(msg) = rx.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if text.contains("Auth timeout") {
                        return true;
                    }
                }
                Ok(Message::Close(_)) => return true,
                Err(_) => return true,
                _ => continue,
            }
        }
        true // stream ended
    })
    .await
    .expect("Should complete within 8 seconds");

    let elapsed = start.elapsed();
    assert!(result, "Connection should close on auth timeout");
    assert!(
        elapsed >= std::time::Duration::from_secs(4),
        "Timeout should take at least 4 seconds, took {:?}",
        elapsed
    );
    assert!(
        elapsed <= std::time::Duration::from_secs(7),
        "Timeout should complete within 7 seconds, took {:?}",
        elapsed
    );
}

#[tokio::test]
async fn empty_token_is_rejected() {
    let addr = start_test_server().await;
    let (mut tx, mut rx) = connect_ws(&addr, "test-room-empty-token").await;

    // Send auth with empty token
    tx.send(Message::Text(
        r#"{"type":"auth","token":""}"#.into(),
    ))
    .await
    .unwrap();

    // Server should send an error and close
    let msg = tokio::time::timeout(std::time::Duration::from_secs(3), rx.next())
        .await
        .expect("Should receive a message within 3s")
        .expect("Stream should not end")
        .expect("Should not be an error");

    match msg {
        Message::Text(text) => {
            assert!(
                text.contains("error") || text.contains("Authentication failed"),
                "Expected error message, got: {}",
                text
            );
        }
        Message::Close(_) => {
            // Also acceptable — server may just close
        }
        other => panic!("Expected text error or close, got: {:?}", other),
    }
}

#[tokio::test]
async fn valid_auth_succeeds_and_receives_sync() {
    let addr = start_test_server().await;
    let (mut tx, mut rx) = connect_ws(&addr, "test-room-auth-ok").await;

    // Send valid auth
    tx.send(Message::Text(
        r#"{"type":"auth","token":"valid-token"}"#.into(),
    ))
    .await
    .unwrap();

    // Should receive the server's SyncStep1 (state vector) as first binary message
    let msg = tokio::time::timeout(std::time::Duration::from_secs(3), rx.next())
        .await
        .expect("Should receive a message within 3s")
        .expect("Stream should not end")
        .expect("Should not be an error");

    assert!(
        msg.is_binary(),
        "Expected binary SyncStep1 from server, got: {:?}",
        msg
    );

    // Verify it's a SYNC message (first byte = 0)
    if let Message::Binary(data) = &msg {
        assert!(!data.is_empty(), "Binary message should not be empty");
        assert_eq!(data[0], 0, "First byte should be SYNC (0)");
    }
}
