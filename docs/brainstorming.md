# Brainstorming

Ideas under consideration but not committed to. Revisit as needed.

---

## Rewrite relay server from Rust to Go

**Status**: Exploring, not committed

**Motivation**: Simplify the server-side stack to a single language (Go, matching the frontend static file server), reduce dependency surface for Google security review, and improve onboarding for contributors more familiar with Go than Rust.

**Current relay server**: ~1,100 lines of Rust across 5 modules (room.rs, ws.rs, auth.rs, main.rs, config.rs). Uses axum, tokio, yrs (Yjs CRDT), hyper-rustls for Google API auth calls. Stateless WebSocket relay — no database, no persistent storage.

### Performance

No meaningful difference for this workload. Messages are small Yjs binary updates (<1KB), throughput is network-bound, and Go's goroutine-per-connection model is a simpler concurrency story than tokio tasks with mpsc channels. Rust's advantage is memory footprint per connection — relevant at tens of thousands of concurrent rooms, not at current scale.

### Maintainability

Go has an edge here. The relay is straightforward message routing that doesn't benefit from Rust's ownership model. Go's stdlib covers HTTP, WebSocket (via nhooyr.io/websocket or gorilla/websocket), and TLS natively. Would go from 14 Rust crates to 2-3 Go dependencies. One server-side language instead of two simplifies hiring, onboarding, and code review.

### Security posture

Go is the internal lingua franca at Google — path of least resistance through a security review. Both languages produce static binaries and avoid C dependencies. Go's stdlib TLS is maintained by the Go team (one trust boundary) vs Rust's rustls (separate project). Practically similar attack surface.

### Scalability

Identical story. The relay is stateless with in-memory rooms. Horizontal scaling = more Cloud Run instances with session affinity (already configured). Both languages handle thousands of concurrent WebSocket connections without tuning.

### Key risk: yrs (Yjs CRDT library)

The Rust server uses yrs 0.21 (official Rust port of Yjs) for document state, state vectors, update encoding/decoding, and conflict resolution. No equivalent Go library exists with y-websocket compatibility.

Two options:

1. **Pure relay** — Don't decode Yjs messages server-side, just forward raw bytes between clients. Simpler but changes the sync model: new clients must sync from peers rather than the server, adding latency on join.

2. **Partial protocol implementation** — Hand-implement the subset of Yjs protocol the server uses (~100-150 lines of lib0 varuint encoding plus SyncStep1, SyncStep2, Update, and Awareness message handling). Preserves current behavior but needs careful testing against the Yjs spec.

Option 2 is recommended if pursuing this — the protocol surface the server uses is narrow and well-documented.

### Estimated effort

3-5 days for a competent Go developer. ~900-1200 lines of Go (similar LOC). Primary risk is CRDT protocol correctness — needs thorough testing against the existing Yjs client.

### Decision criteria

Lean toward Go if:
- Google internal deployment is the primary target
- Team is more Go-fluent than Rust-fluent
- Minimizing unique dependencies matters more than raw performance

Stay with Rust if:
- Planning to add server-side document persistence or processing
- Need yrs for features beyond simple relay (e.g., server-side conflict resolution, snapshots)
- Comfortable maintaining two server-side languages
