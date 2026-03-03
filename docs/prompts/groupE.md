# Phase 11 Group E — Diagnose & Fix Presence + Server Integration Tests

You are implementing Phase 11 Group E for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- server/src/ws.rs
- server/src/room.rs
- server/tests/ws_auth_test.rs (new)
- server/tests/awareness_test.rs (new)
- server/Cargo.toml (only `[dev-dependencies]` section)
- src/collab/yjsProvider.ts
- src/collab/awareness.ts

## Background

Phase 10 Group B moved the OAuth token from URL query params to a first-message WebSocket auth
pattern. After Phase 10, presence/highlighting is broken — users don't see each other's cursors
or cell selections.

### What we know so far

1. **Server-side fix already applied (may be incomplete)**: `wait_for_auth()` in ws.rs has been
   updated to buffer binary messages into an `AuthResult` struct and replay them after
   `join_room()`. This was intended to prevent awareness messages from being dropped during
   the auth handshake. But presence is STILL broken, so there may be additional issues.

2. **y-websocket sends binary before auth**: When y-websocket connects, it immediately sends
   SyncStep1 + awareness binary messages BEFORE the `status: 'connected'` event fires (which is
   where the auth JSON is sent). The server buffers these and replays them after auth + join.

3. **Client-side awareness setup**: In GanttContext.tsx, `setLocalAwareness()` is called
   synchronously after `connectCollab()`, before the WebSocket has actually connected. The
   y-protocols awareness library should encode the full local state on the next awareness update
   (which happens when the WebSocket connects), but this timing needs verification.

4. **room.rs awareness handling**: `handle_awareness_message()` stores the raw message in
   `room.last_awareness` (only the most recent one) and broadcasts to other clients.
   `handle_join()` sends `last_awareness` to new joiners. This means only the LAST awareness
   message is preserved — if multiple clients send awareness, only the latest one's state is
   sent to new joiners. This might be an issue.

### Possible root causes to investigate

- **Buffered message replay timing**: In ws.rs, the replay happens BEFORE `send_task` is spawned
  (line 219). The replayed messages go through `room_manager.send_message()` which sends
  `RoomCommand::IncomingMessage` to the room task. The room processes these and may send responses
  back through the client's mpsc channel. Since `send_task` hasn't started yet, responses queue
  in the channel — they should still be delivered once the task starts. Verify this is working.

- **Auth message arriving too late**: If y-websocket re-sends SyncStep1 after the `status` event
  fires (after auth), the buffered pre-auth messages might be redundant. But if y-websocket does
  NOT re-send, then buffering is the only path for initial sync. Check y-websocket source
  behavior.

- **Awareness not re-sent after auth**: After auth succeeds and the server joins the client to the
  room, does the client ever re-send its awareness state? If the only awareness update was the
  pre-auth one (now replayed), does the room properly store and relay it? Or does the client
  need to re-trigger awareness after auth is confirmed?

- **Client-side: awareness listener setup order**: In GanttContext.tsx, `aw.on('change', ...)`
  is registered after `connectCollab()`. If awareness changes fire before this listener is
  registered, the React state won't update. Check if remote awareness changes are being received
  but not dispatched.

- **`last_awareness` stores only one message**: If multiple clients connect, `last_awareness`
  only holds the latest message. y-protocols awareness messages encode a list of client states.
  A single message typically contains only the sender's state. So a new joiner would only see
  the most recent client's state, not all clients. Consider storing per-client awareness or
  merging.

## Tasks — execute in order:

### E1: Verify the existing ws.rs fix compiles
- Run `cd server && cargo check` to confirm AuthResult changes compile
- Run `cd server && cargo test` to confirm existing tests pass
- If there are compilation errors, fix them

### E2: Diagnose the full presence flow end-to-end
Add strategic `tracing::info!` log lines to trace the awareness flow:
1. In `wait_for_auth()`: log the number and size of buffered binary messages
2. In `handle_websocket()` replay loop: log each replayed message's type tag
3. In `handle_awareness_message()`: log client_id and data length
4. In `handle_join()`: log whether last_awareness is Some/None and its length

Deploy/test locally with two browser tabs. Read the server logs to determine:
- Are awareness messages actually arriving from the client?
- Are they being buffered during auth or arriving after auth?
- Is `last_awareness` populated when the second client joins?
- Is the second client receiving awareness data?

Document your findings in a code comment at the top of ws.rs.

### E3: Fix the root cause(s)
Based on E2 findings, apply the necessary fixes. Likely candidates:

**If awareness is never sent by the client after auth:**
- In `yjsProvider.ts`: after the auth message is sent and connection is confirmed, force an
  awareness re-announcement: `provider.awareness.setLocalState(provider.awareness.getLocalState())`
  This triggers the awareness protocol to re-broadcast the local state.

**If awareness messages arrive but aren't stored/relayed correctly:**
- In `room.rs`: fix `last_awareness` to store ALL client states, not just the latest message.
  Consider storing a `HashMap<ClientId, Vec<u8>>` for per-client awareness, or re-encoding a
  merged awareness message when sending to new joiners.

**If the replay timing is wrong:**
- In `ws.rs`: move the replay to AFTER `send_task` is spawned, or ensure the mpsc channel
  properly queues responses.

**If `setLocalAwareness` runs before WS is connected and the state is never re-sent:**
- In `yjsProvider.ts` or `GanttContext.tsx`: move `setLocalAwareness()` into the
  `status: 'connected'` callback so it runs after the WebSocket is established.
- Or: add a separate awareness re-announce in the `status: 'connected'` handler.

### E4: Add integration test for auth flow with pre-auth binary messages
Create `server/tests/ws_auth_test.rs`:
- Start an axum test server using the app's router (reference server/src/main.rs for setup)
- Use `tokio-tungstenite` as a WebSocket test client
- Test case: **"binary messages sent before auth are buffered and replayed"**
  1. Connect to `/ws/test-room`
  2. Send a binary message (e.g., a fake SyncStep1) BEFORE sending the auth JSON
  3. Send `{"type":"auth","token":"test-token"}`
  4. Verify the binary message was processed (check server logs or response messages)
  Note: You may need a `#[cfg(test)]` bypass for Google token validation, or a test-only
  auth mode that accepts any token.
- Test case: **"auth timeout after 5 seconds"**
  1. Connect and send no messages
  2. Verify connection is closed within ~5 seconds
- Test case: **"empty token is rejected"**
  1. Connect and send `{"type":"auth","token":""}`
  2. Verify error response

Add `tokio-tungstenite` and `futures-util` to `[dev-dependencies]` in server/Cargo.toml.

### E5: Add integration test for awareness relay
Create `server/tests/awareness_test.rs`:
- Test case: **"awareness from client A is received by client B"**
  1. Connect two test clients to the same room (both authenticate)
  2. Client A sends an awareness binary message (msg_type=1 + payload)
  3. Verify Client B receives the awareness message
- Test case: **"late joiner receives awareness state"**
  1. Client A connects, authenticates, and sends awareness
  2. Client B connects and authenticates
  3. Verify Client B receives A's awareness as part of the join handshake
- Test case: **"presence works with the auth-then-awareness flow"**
  1. Client A: connect → send binary (awareness) → send auth → verify auth accepted
  2. Client B: connect → send auth → verify auth accepted
  3. Verify Client B receives Client A's awareness data

### E6: Commit and verify
- Run `cd server && cargo test` — all tests (existing + new) must pass
- Run `npx tsc --noEmit` — TypeScript changes compile
- Commit with descriptive message: "fix: diagnose and resolve presence regression, add server integration tests"
