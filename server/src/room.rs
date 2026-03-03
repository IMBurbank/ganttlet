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
    /// Per-client awareness state stored as raw bytes. When a new client joins,
    /// all stored awareness messages are sent so the joiner sees every client's
    /// presence, not just the last one who sent an update.
    awareness_states: HashMap<ClientId, Vec<u8>>,
}

impl Room {
    fn new() -> Self {
        Room {
            doc: Doc::new(),
            clients: HashMap::new(),
            awareness_states: HashMap::new(),
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

    // Step 3: Send ALL stored awareness states so the new joiner sees every
    // connected client's presence, not just the most recent one.
    let awareness_count = room.awareness_states.len();
    info!(
        room_id = %room_id,
        client_id = client_id,
        awareness_states = awareness_count,
        "Sending stored awareness states to new joiner"
    );
    for (other_id, awareness_data) in &room.awareness_states {
        info!(
            room_id = %room_id,
            client_id = client_id,
            from_client = other_id,
            data_len = awareness_data.len(),
            "Sending awareness state to new joiner"
        );
        let _ = sender.send(awareness_data.clone());
    }

    room.clients
        .insert(client_id, ConnectedClient { info, sender });
}

/// Handle a client leaving the room.
fn handle_leave(room_id: &str, room: &mut Room, client_id: ClientId) {
    if let Some(client) = room.clients.remove(&client_id) {
        room.awareness_states.remove(&client_id);
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

    // Yjs WebSocket protocol: first field = varuint message type tag
    let Some((msg_tag, tag_size)) = read_varuint(data) else {
        return;
    };
    let msg_tag = msg_tag as u8;
    let payload = &data[tag_size..];

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

    // Read varuint sync sub-type tag
    let Some((sync_tag_val, tag_size)) = read_varuint(payload) else {
        return;
    };
    let sync_tag = sync_tag_val as u8;
    let sync_payload = &payload[tag_size..];

    match sync_tag {
        sync_type::STEP1 => {
            // Client sent their state vector wrapped as varUint8Array.
            // Read the length-prefixed byte array to get the raw state vector.
            let Some((sv_bytes, _consumed)) = read_var_uint8_array(sync_payload) else {
                warn!(
                    room_id = %room_id,
                    client_id = client_id,
                    "Failed to read varUint8Array for SyncStep1"
                );
                return;
            };
            match StateVector::decode_v1(sv_bytes) {
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
            // Client sent a document update wrapped as varUint8Array.
            if client_role != DriveRole::Writer {
                warn!(
                    room_id = %room_id,
                    client_id = client_id,
                    "Reader attempted to send update, ignoring"
                );
                return;
            }

            let Some((update_bytes, _consumed)) = read_var_uint8_array(sync_payload) else {
                warn!(
                    room_id = %room_id,
                    client_id = client_id,
                    "Failed to read varUint8Array for sync update"
                );
                return;
            };

            match Update::decode_v1(update_bytes) {
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

                    // Broadcast the raw update bytes to all other clients
                    if let Some(msg) = encode_sync_update(update_bytes) {
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
/// Awareness messages are stored per-client and merged for late joiners.
/// Each message is also relayed verbatim to all other connected clients.
fn handle_awareness_message(room: &mut Room, client_id: ClientId, data: &[u8]) {
    info!(
        client_id = client_id,
        data_len = data.len(),
        num_clients = room.clients.len(),
        "Handling awareness message"
    );
    room.awareness_states.insert(client_id, data.to_vec());
    broadcast_to_others(&room.clients, client_id, data);
}

// ---------------------------------------------------------------------------
// lib0 varuint helpers — match the encoding used by y-websocket / y-protocols
// ---------------------------------------------------------------------------

/// Read a lib0 variable-length unsigned integer from a byte slice.
/// Returns (value, bytes_consumed) or None if the buffer is too short.
fn read_varuint(data: &[u8]) -> Option<(usize, usize)> {
    let mut value: usize = 0;
    let mut shift = 0;
    for (i, &byte) in data.iter().enumerate() {
        value |= ((byte & 0x7F) as usize) << shift;
        if byte < 0x80 {
            return Some((value, i + 1));
        }
        shift += 7;
        if shift > 35 {
            return None; // overflow protection
        }
    }
    None // incomplete varuint
}

/// Read a lib0 varUint8Array: [varuint length] [length bytes].
/// Returns the byte-array payload and total bytes consumed, or None.
fn read_var_uint8_array(data: &[u8]) -> Option<(&[u8], usize)> {
    let (len, prefix_size) = read_varuint(data)?;
    let end = prefix_size + len;
    if data.len() < end {
        return None;
    }
    Some((&data[prefix_size..end], end))
}

/// Write a lib0 variable-length unsigned integer into a buffer.
fn write_varuint(buf: &mut Vec<u8>, mut value: usize) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value > 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

/// Write a lib0 varUint8Array: [varuint length] [bytes].
fn write_var_uint8_array(buf: &mut Vec<u8>, data: &[u8]) {
    write_varuint(buf, data.len());
    buf.extend_from_slice(data);
}

// ---------------------------------------------------------------------------
// Encoding helpers — construct the Yjs binary wire format with lib0 encoding
// ---------------------------------------------------------------------------

/// Encode a SyncStep1 message: [varuint SYNC] [varuint STEP1] [varUint8Array state_vector].
fn encode_sync_step1(sv: &StateVector) -> Option<Vec<u8>> {
    let sv_bytes = sv.encode_v1();
    let mut buf = Vec::with_capacity(2 + 5 + sv_bytes.len());
    write_varuint(&mut buf, msg_type::SYNC as usize);
    write_varuint(&mut buf, sync_type::STEP1 as usize);
    write_var_uint8_array(&mut buf, &sv_bytes);
    Some(buf)
}

/// Encode a SyncStep2 message: [varuint SYNC] [varuint STEP2] [varUint8Array update].
fn encode_sync_step2(update: &[u8]) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(2 + 5 + update.len());
    write_varuint(&mut buf, msg_type::SYNC as usize);
    write_varuint(&mut buf, sync_type::STEP2 as usize);
    write_var_uint8_array(&mut buf, update);
    Some(buf)
}

/// Encode a sync Update message: [varuint SYNC] [varuint UPDATE] [varUint8Array update].
fn encode_sync_update(update: &[u8]) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(2 + 5 + update.len());
    write_varuint(&mut buf, msg_type::SYNC as usize);
    write_varuint(&mut buf, sync_type::UPDATE as usize);
    write_var_uint8_array(&mut buf, update);
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
