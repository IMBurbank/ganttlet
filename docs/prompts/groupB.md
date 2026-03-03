# Phase 10 Group B (Stage 1) — Token Auth Flow

You are implementing Phase 10 Group B (Stage 1) for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- server/src/ws.rs
- src/collab/yjsProvider.ts

## Background

The OAuth access token is currently passed as a URL query parameter (`?token=<value>`) on the WebSocket connection. Query parameters appear in server logs, browser history, HTTP Referer headers, and proxy caches. We need to move the token to a WebSocket message sent after the connection upgrades.

The y-websocket library's `params` option appends to the URL as query parameters — there's no built-in way to send an Authorization header. So we use a first-message auth pattern: upgrade the connection without auth, then the client sends the token as the first text message, and the server validates before processing any Yjs binary messages.

## Tasks — execute in order:

### B1: Client — send token as WebSocket message (yjsProvider.ts)

1. Remove `params: { token: accessToken }` from the WebsocketProvider constructor options (line 29).

2. After creating the provider, listen for connection status and send the auth message:
   ```typescript
   provider.on('status', ({ status }: { status: string }) => {
     if (status === 'connected' && provider?.ws) {
       provider.ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
     }
   });
   ```

3. The y-websocket `WebsocketProvider` has a `ws` property that is the underlying WebSocket. When `status === 'connected'`, the socket is ready to send.

4. The provider auto-reconnects on disconnect. The `status` event fires on each reconnection, so the auth message is re-sent automatically.

### B2: Server — validate token from first message (ws.rs)

1. Remove `Query(params): Query<WsParams>` from `ws_handler()` signature. Remove the `WsParams` struct entirely.

2. Change `ws_handler()` to accept the upgrade without pre-auth:
   ```rust
   pub async fn ws_handler(
       ws: WebSocketUpgrade,
       Path(room_id): Path<String>,
       State(state): State<Arc<AppState>>,
   ) -> Response {
       let room_id_clone = room_id.clone();
       ws.on_upgrade(move |socket| {
           handle_websocket(socket, room_id_clone, state)
       })
       .into_response()
   }
   ```

3. Rewrite `handle_websocket()` to read the first message as auth before joining the room:

   a. Split the socket into sender/receiver.

   b. Wait for the first text message with a 5-second timeout. Parse it as JSON `{ "type": "auth", "token": "..." }`. Add a helper function `wait_for_auth()` that reads from the receiver stream until it gets a text message:
      - If `Message::Text` → parse JSON, extract token
      - If `Message::Binary` → skip (Yjs messages arriving before auth)
      - If `Message::Close` or error → return error

   c. If timeout expires or auth fails, send a text error message and return:
      ```rust
      let _ = ws_sender.send(Message::Text(
          r#"{"type":"error","message":"Authentication failed"}"#.into()
      )).await;
      ```

   d. If auth succeeds, proceed with the existing flow: validate token via `auth::validate_token()`, check Drive permissions via `auth::check_drive_permission()`, join room, spawn send/receive tasks.

4. Use `tokio::time::timeout` for the 5-second auth deadline:
   ```rust
   use std::time::Duration;
   let auth_result = tokio::time::timeout(
       Duration::from_secs(5),
       wait_for_auth(&mut ws_receiver),
   ).await;
   ```

5. Add `serde_json` to the imports if not already present (it's already in Cargo.toml).

### B3: Clean up error responses

After auth validation, send only generic error messages to the client — no Google API details:
- Auth failure: `{"type":"error","message":"Authentication failed"}`
- Permission denied: `{"type":"error","message":"Access denied"}`
- Timeout: `{"type":"error","message":"Auth timeout"}`
- Keep detailed error info in server-side `warn!`/`error!` logs only.

## Interface Notes

- The `room_id` still comes from the URL path (`/ws/:room_id`) — that doesn't change.
- The server currently ignores text messages after the initial handshake (line 161). After this change, only the FIRST text message is treated as auth; subsequent text messages remain ignored.
- All Yjs protocol messages are binary and continue to work exactly as before.

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test && cd server && cargo test
```
All must pass. Commit your changes with descriptive messages.
