use crate::auth::{DriveRole, UserInfo};
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

/// Unique identifier for a connected client within a room.
pub type ClientId = u64;

/// Information about a connected client.
#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub user: UserInfo,
    pub role: DriveRole,
}

/// A connected client's channel and metadata.
struct ConnectedClient {
    info: ClientInfo,
    sender: mpsc::UnboundedSender<Vec<u8>>,
}

/// Yjs/Yrs binary protocol message type tags.
/// These match the standard y-websocket protocol.
mod msg_type {
    pub const SYNC: u8 = 0;
    pub const AWARENESS: u8 = 1;
}

/// Yjs sync sub-message type tags.
mod sync_type {
    pub const STEP1: u8 = 0; // Client sends state vector
    pub const STEP2: u8 = 1; // Server sends diff (update)
    pub const UPDATE: u8 = 2; // Incremental update
}

/// A single collaboration room containing a Y-Doc and connected clients.
///
/// Uses manual protocol handling (rather than the yrs Awareness type) to
/// avoid potential Send/Sync complications. The Doc itself is Send+Sync.
struct Room {
    doc: Doc,
    clients: HashMap<ClientId, ConnectedClient>,
    /// Last awareness message received, stored as raw bytes for relay to
    /// newly joining clients.
    last_awareness: Option<Vec<u8>>,
}

impl Room {
    fn new() -> Self {
        Room {
            doc: Doc::new(),
            clients: HashMap::new(),
            last_awareness: None,
        }
    }
}

/// Commands sent to a room's dedicated task via an mpsc channel.
enum RoomCommand {
    /// A new client wants to join the room.
    Join {
        client_id: ClientId,
        info: ClientInfo,
        sender: mpsc::UnboundedSender<Vec<u8>>,
    },
    /// A client is leaving the room.
    Leave { client_id: ClientId },
    /// A client sent a binary message.
    IncomingMessage { client_id: ClientId, data: Vec<u8> },
}

/// Handle to a running room task, holding the command channel sender.
struct RoomHandle {
    cmd_tx: mpsc::UnboundedSender<RoomCommand>,
}

/// Manages all active rooms. Thread-safe and designed to be shared
/// via `Arc<RoomManager>` across axum handlers.
pub struct RoomManager {
    rooms: Arc<DashMap<String, RoomHandle>>,
    next_client_id: std::sync::atomic::AtomicU64,
}

impl RoomManager {
    pub fn new() -> Self {
        RoomManager {
            rooms: Arc::new(DashMap::new()),
            next_client_id: std::sync::atomic::AtomicU64::new(1),
        }
    }

    /// Generate a globally unique client ID.
    pub fn next_client_id(&self) -> ClientId {
        self.next_client_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// Join a room (creating it on demand if it does not exist).
    ///
    /// The caller provides a channel sender through which the room task will
    /// push messages destined for this client's WebSocket.
    pub fn join_room(
        &self,
        room_id: &str,
        client_id: ClientId,
        info: ClientInfo,
        sender: mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let cmd_tx = self.get_or_create_room(room_id);
        let _ = cmd_tx.send(RoomCommand::Join {
            client_id,
            info,
            sender,
        });
    }

    /// Forward a binary message from a client to its room for processing.
    pub fn send_message(&self, room_id: &str, client_id: ClientId, data: Vec<u8>) {
        if let Some(handle) = self.rooms.get(room_id) {
            let _ = handle.cmd_tx.send(RoomCommand::IncomingMessage {
                client_id,
                data,
            });
        }
    }

    /// Remove a client from a room. If the room becomes empty, it shuts down.
    pub fn leave_room(&self, room_id: &str, client_id: ClientId) {
        if let Some(handle) = self.rooms.get(room_id) {
            let _ = handle.cmd_tx.send(RoomCommand::Leave { client_id });
        }
    }

    /// Get the command sender for an existing room, or create a new one.
    fn get_or_create_room(&self, room_id: &str) -> mpsc::UnboundedSender<RoomCommand> {
        // Fast path: room already exists
        if let Some(handle) = self.rooms.get(room_id) {
            return handle.cmd_tx.clone();
        }

        // Slow path: create new room with a dedicated task
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let room_id_owned = room_id.to_string();
        let rooms_ref = self.rooms.clone();

        // Spawn a dedicated tokio task for this room.
        // The room task owns the Doc and all client state. It processes
        // commands sequentially from the channel, so no locking is needed.
        // Doc is Send+Sync, and all other types in the future are Send,
        // so tokio::spawn works here.
        tokio::spawn(async move {
            run_room_loop(&room_id_owned, cmd_rx).await;
            // Clean up the room entry when the task ends
            rooms_ref.remove(&room_id_owned);
            info!(room_id = %room_id_owned, "Room cleaned up");
        });

        self.rooms.insert(
            room_id.to_string(),
            RoomHandle {
                cmd_tx: cmd_tx.clone(),
            },
        );

        cmd_tx
    }
}

/// Main event loop for a room's dedicated task.
///
/// Processes commands sequentially: joins, leaves, and incoming messages.
/// When the last client leaves, the loop exits and the room is cleaned up.
async fn run_room_loop(
    room_id: &str,
    mut cmd_rx: mpsc::UnboundedReceiver<RoomCommand>,
) {
    let mut room = Room::new();

    info!(room_id = %room_id, "Room created");

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            RoomCommand::Join {
                client_id,
                info,
                sender,
            } => {
                handle_join(room_id, &mut room, client_id, info, sender);
            }
            RoomCommand::Leave { client_id } => {
                handle_leave(room_id, &mut room, client_id);
                if room.clients.is_empty() {
                    info!(room_id = %room_id, "Room is empty, shutting down");
                    break;
                }
            }
            RoomCommand::IncomingMessage { client_id, data } => {
                handle_incoming_message(room_id, &mut room, client_id, &data);
            }
        }
    }
}

/// Handle a new client joining the room.
///
/// Sends the current document state and awareness to the new client so it
/// can synchronise immediately.
fn handle_join(
    room_id: &str,
    room: &mut Room,
    client_id: ClientId,
    info: ClientInfo,
    sender: mpsc::UnboundedSender<Vec<u8>>,
) {
    info!(
        room_id = %room_id,
        client_id = client_id,
        user = %info.user.email,
        role = ?info.role,
        "Client joining room"
    );

    // Step 1: Send SyncStep1 (our state vector) so the client knows what
    // updates to send us.
    let sv = room.doc.transact().state_vector();
    if let Some(msg) = encode_sync_step1(&sv) {
        let _ = sender.send(msg);
    }

    // Step 2: Send SyncStep2 with the full document state so the client
    // gets caught up immediately.
    let update = room.doc.transact().encode_state_as_update_v1(&StateVector::default());
    if !update.is_empty() {
        if let Some(msg) = encode_sync_step2(&update) {
            let _ = sender.send(msg);
        }
    }

    // Step 3: Send the latest awareness state if we have one.
    if let Some(ref awareness_data) = room.last_awareness {
        let _ = sender.send(awareness_data.clone());
    }

    room.clients
        .insert(client_id, ConnectedClient { info, sender });
}

/// Handle a client leaving the room.
fn handle_leave(room_id: &str, room: &mut Room, client_id: ClientId) {
    if let Some(client) = room.clients.remove(&client_id) {
        info!(
            room_id = %room_id,
            client_id = client_id,
            user = %client.info.user.email,
            "Client left room"
        );
    }
}

/// Handle an incoming binary message from a client.
///
/// Dispatches to the appropriate handler based on the Yjs message type tag.
fn handle_incoming_message(
    room_id: &str,
    room: &mut Room,
    client_id: ClientId,
    data: &[u8],
) {
    if data.is_empty() {
        return;
    }

    let client_role = room
        .clients
        .get(&client_id)
        .map(|c| c.info.role)
        .unwrap_or(DriveRole::Reader);

    // Yjs WebSocket protocol: first byte = message type tag
    let msg_tag = data[0];
    let payload = &data[1..];

    match msg_tag {
        msg_type::SYNC => {
            handle_sync_message(room_id, room, client_id, client_role, payload);
        }
        msg_type::AWARENESS => {
            // Awareness messages are relayed verbatim to all other clients
            handle_awareness_message(room, client_id, data);
        }
        _ => {
            debug!(
                room_id = %room_id,
                client_id = client_id,
                msg_tag = msg_tag,
                "Unknown message type, ignoring"
            );
        }
    }
}

/// Handle a sync protocol message (SyncStep1, SyncStep2, or Update).
fn handle_sync_message(
    room_id: &str,
    room: &mut Room,
    client_id: ClientId,
    client_role: DriveRole,
    payload: &[u8],
) {
    if payload.is_empty() {
        return;
    }

    let sync_tag = payload[0];
    let sync_data = &payload[1..];

    match sync_tag {
        sync_type::STEP1 => {
            // Client sent their state vector. We respond with the updates
            // they are missing (encoded as SyncStep2).
            match StateVector::decode_v1(sync_data) {
                Ok(remote_sv) => {
                    let update = room.doc.transact().encode_state_as_update_v1(&remote_sv);
                    if let Some(msg) = encode_sync_step2(&update) {
                        if let Some(client) = room.clients.get(&client_id) {
                            let _ = client.sender.send(msg);
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        room_id = %room_id,
                        client_id = client_id,
                        error = %e,
                        "Failed to decode SyncStep1 state vector"
                    );
                }
            }
        }
        sync_type::STEP2 | sync_type::UPDATE => {
            // Client sent a document update. Only writers may modify the doc.
            if client_role != DriveRole::Writer {
                warn!(
                    room_id = %room_id,
                    client_id = client_id,
                    "Reader attempted to send update, ignoring"
                );
                return;
            }

            match Update::decode_v1(sync_data) {
                Ok(update) => {
                    // Apply the update to the room's Y-Doc
                    let mut txn = room.doc.transact_mut();
                    if let Err(e) = txn.apply_update(update) {
                        warn!(
                            room_id = %room_id,
                            client_id = client_id,
                            error = %e,
                            "Failed to apply update to doc"
                        );
                        return;
                    }
                    drop(txn);

                    // Broadcast the update to all other clients
                    if let Some(msg) = encode_sync_update(sync_data) {
                        broadcast_to_others(&room.clients, client_id, &msg);
                    }
                }
                Err(e) => {
                    warn!(
                        room_id = %room_id,
                        client_id = client_id,
                        error = %e,
                        "Failed to decode update"
                    );
                }
            }
        }
        _ => {
            debug!(
                room_id = %room_id,
                client_id = client_id,
                sync_tag = sync_tag,
                "Unknown sync sub-message type"
            );
        }
    }
}

/// Handle an awareness message.
///
/// Awareness messages are stored (most recent only) for new clients and
/// relayed verbatim to all other connected clients.
fn handle_awareness_message(room: &mut Room, client_id: ClientId, data: &[u8]) {
    room.last_awareness = Some(data.to_vec());
    broadcast_to_others(&room.clients, client_id, data);
}

// ---------------------------------------------------------------------------
// Encoding helpers — manually construct the simple Yjs binary wire format
// ---------------------------------------------------------------------------

/// Encode a SyncStep1 message: [SYNC tag] [STEP1 tag] [state vector bytes].
fn encode_sync_step1(sv: &StateVector) -> Option<Vec<u8>> {
    let sv_bytes = sv.encode_v1();
    let mut buf = Vec::with_capacity(2 + sv_bytes.len());
    buf.push(msg_type::SYNC);
    buf.push(sync_type::STEP1);
    buf.extend_from_slice(&sv_bytes);
    Some(buf)
}

/// Encode a SyncStep2 message: [SYNC tag] [STEP2 tag] [update bytes].
fn encode_sync_step2(update: &[u8]) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(2 + update.len());
    buf.push(msg_type::SYNC);
    buf.push(sync_type::STEP2);
    buf.extend_from_slice(update);
    Some(buf)
}

/// Encode a sync Update message: [SYNC tag] [UPDATE tag] [update bytes].
fn encode_sync_update(update: &[u8]) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(2 + update.len());
    buf.push(msg_type::SYNC);
    buf.push(sync_type::UPDATE);
    buf.extend_from_slice(update);
    Some(buf)
}

/// Send a binary message to every connected client except the specified one.
fn broadcast_to_others(
    clients: &HashMap<ClientId, ConnectedClient>,
    exclude_id: ClientId,
    data: &[u8],
) {
    for (id, client) in clients.iter() {
        if *id != exclude_id {
            if client.sender.send(data.to_vec()).is_err() {
                debug!(client_id = id, "Failed to send to client (likely disconnected)");
            }
        }
    }
}
