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

/// Connect a WebSocket test client and authenticate it.
/// Returns the split (sink, stream) after authentication.
/// Drains the initial sync messages (SyncStep1 + SyncStep2) from the server.
async fn connect_and_auth(
    addr: &str,
    room: &str,
    token: &str,
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
    let (mut tx, mut rx) = ws_stream.split();

    // Send auth
    tx.send(Message::Text(
        format!(r#"{{"type":"auth","token":"{}"}}"#, token).into(),
    ))
    .await
    .unwrap();

    // Drain initial sync messages (SyncStep1 + SyncStep2 from handle_join).
    // We expect at least one binary message; drain all that arrive quickly.
    drain_sync_messages(&mut rx).await;

    (tx, rx)
}

/// Drain initial sync messages that arrive within a short timeout.
async fn drain_sync_messages(
    rx: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
) {
    loop {
        match tokio::time::timeout(std::time::Duration::from_millis(300), rx.next()).await {
            Ok(Some(Ok(Message::Binary(data)))) => {
                // Check if this is a SYNC message (tag=0). If so, skip it.
                // If it's AWARENESS (tag=1), also skip during drain.
                let _tag = data.first().copied().unwrap_or(255);
                continue;
            }
            _ => break,
        }
    }
}

/// Build a minimal awareness message.
/// Yjs awareness wire format: [1 (AWARENESS)] [payload...]
/// The payload is the encoded awareness update. For testing, we use a
/// recognizable pattern that the server will relay as-is.
fn build_awareness_message(payload: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(1 + payload.len());
    msg.push(1); // AWARENESS message type
    msg.extend_from_slice(payload);
    msg
}

#[tokio::test]
async fn awareness_from_client_a_is_received_by_client_b() {
    let addr = start_test_server().await;
    let room = "test-awareness-relay";

    // Client A connects and authenticates
    let (mut tx_a, _rx_a) = connect_and_auth(&addr, room, "user-a").await;

    // Client B connects and authenticates
    let (_tx_b, mut rx_b) = connect_and_auth(&addr, room, "user-b").await;

    // Small delay to ensure both clients are fully joined
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Client A sends an awareness message
    let awareness_payload = b"client-a-awareness-data";
    let awareness_msg = build_awareness_message(awareness_payload);
    tx_a.send(Message::Binary(awareness_msg.into()))
        .await
        .unwrap();

    // Client B should receive the awareness message
    let msg = tokio::time::timeout(std::time::Duration::from_secs(3), rx_b.next())
        .await
        .expect("Client B should receive awareness within 3s")
        .expect("Stream should not end")
        .expect("Should not be an error");

    match msg {
        Message::Binary(data) => {
            assert!(!data.is_empty(), "Awareness message should not be empty");
            assert_eq!(data[0], 1, "First byte should be AWARENESS (1)");
            assert_eq!(
                &data[1..],
                awareness_payload,
                "Awareness payload should match what Client A sent"
            );
        }
        other => panic!("Expected binary awareness message, got: {:?}", other),
    }
}

#[tokio::test]
async fn late_joiner_receives_awareness_state() {
    let addr = start_test_server().await;
    let room = "test-awareness-late-join";

    // Client A connects and authenticates
    let (mut tx_a, _rx_a) = connect_and_auth(&addr, room, "user-a").await;

    // Client A sends an awareness message
    let awareness_payload = b"client-a-presence";
    let awareness_msg = build_awareness_message(awareness_payload);
    tx_a.send(Message::Binary(awareness_msg.into()))
        .await
        .unwrap();

    // Give the server time to process and store the awareness
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Client B connects and authenticates (late joiner)
    let url = format!("ws://{}/ws/{}", addr, room);
    let (ws_stream, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut tx_b, mut rx_b) = ws_stream.split();

    // Send auth for Client B
    tx_b.send(Message::Text(
        r#"{"type":"auth","token":"user-b"}"#.into(),
    ))
    .await
    .unwrap();

    // Client B should receive messages: SyncStep1, SyncStep2, and awareness from A.
    // Collect all messages received within a short window.
    let mut received_awareness = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);

    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(std::time::Duration::from_millis(500), rx_b.next()).await {
            Ok(Some(Ok(Message::Binary(data)))) => {
                if !data.is_empty() && data[0] == 1 {
                    // This is an awareness message
                    assert_eq!(
                        &data[1..],
                        awareness_payload,
                        "Late joiner should receive Client A's awareness data"
                    );
                    received_awareness = true;
                    break;
                }
            }
            _ => break,
        }
    }

    assert!(
        received_awareness,
        "Late joiner should have received awareness from Client A"
    );
}

#[tokio::test]
async fn presence_works_with_auth_then_awareness_flow() {
    let addr = start_test_server().await;
    let room = "test-awareness-full-flow";

    // Client A: connect → send binary (awareness) BEFORE auth → send auth
    let url = format!("ws://{}/ws/{}", addr, room);
    let (ws_stream_a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut tx_a, mut rx_a) = ws_stream_a.split();

    // Client A sends awareness BEFORE auth (simulates y-websocket behavior)
    let awareness_payload_a = b"client-a-pre-auth-awareness";
    let awareness_msg_a = build_awareness_message(awareness_payload_a);
    tx_a.send(Message::Binary(awareness_msg_a.into()))
        .await
        .unwrap();

    // Client A sends auth
    tx_a.send(Message::Text(
        r#"{"type":"auth","token":"user-a"}"#.into(),
    ))
    .await
    .unwrap();

    // Drain Client A's initial sync messages
    drain_sync_messages(&mut rx_a).await;

    // Small delay to let the server process A's buffered awareness
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Client B: connect → send auth → verify auth accepted
    let (ws_stream_b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut tx_b, mut rx_b) = ws_stream_b.split();

    tx_b.send(Message::Text(
        r#"{"type":"auth","token":"user-b"}"#.into(),
    ))
    .await
    .unwrap();

    // Client B should receive Client A's awareness data (from the pre-auth buffer replay).
    // Collect all messages and check for awareness.
    let mut received_awareness = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);

    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(std::time::Duration::from_millis(500), rx_b.next()).await {
            Ok(Some(Ok(Message::Binary(data)))) => {
                if !data.is_empty() && data[0] == 1 {
                    assert_eq!(
                        &data[1..],
                        awareness_payload_a,
                        "Client B should receive Client A's pre-auth awareness data"
                    );
                    received_awareness = true;
                    break;
                }
            }
            _ => break,
        }
    }

    assert!(
        received_awareness,
        "Client B should have received Client A's awareness data (buffered pre-auth)"
    );
}
