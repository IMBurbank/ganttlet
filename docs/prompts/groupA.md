# Phase 10 Group A (Stage 1) — CORS Hardening + Tooltip Bug Fix

You are implementing Phase 10 Group A (Stage 1) for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- server/src/main.rs
- server/src/config.rs
- src/components/shared/Tooltip.tsx

## Background

The relay server's CORS configuration currently defaults to `CorsLayer::permissive()` when `RELAY_ALLOWED_ORIGINS` is empty or contains `"*"`. This means production deploys can start wide open if the env var isn't set. We need to enforce a strict allowlist with no permissive fallback.

## Tasks — execute in order:

### A1: Validate CORS origins in config.rs

In `Config::from_env()`, after parsing `RELAY_ALLOWED_ORIGINS`:

1. Filter out any entry that is `"*"` — log an error if one was found:
   ```rust
   if origins.iter().any(|o| o == "*") {
       tracing::error!("RELAY_ALLOWED_ORIGINS contained '*' — wildcard origins are not allowed, filtering out");
       origins.retain(|o| o != "*");
   }
   ```

2. If the resulting list is empty, default to `vec!["http://localhost:5173".to_string()]` and log a warning:
   ```rust
   if origins.is_empty() {
       tracing::warn!("RELAY_ALLOWED_ORIGINS is empty — defaulting to http://localhost:5173 (local dev only)");
       origins = vec!["http://localhost:5173".to_string()];
   }
   ```

3. Update the existing unit tests and add new ones:
   - Test: empty env var defaults to `["http://localhost:5173"]`
   - Test: `"*"` is filtered out, falls back to default
   - Test: `"*,http://example.com"` keeps only `http://example.com`
   - Test: `"http://a.com,http://b.com"` parses both correctly

### A2: Remove permissive fallback in main.rs

In `build_cors_layer()`:

1. Remove the `if origins.is_empty() || origins.contains("*")` branch that returns `CorsLayer::permissive()`.

2. The function should always build a strict CORS layer from the origins list. Since `config.rs` now guarantees a non-empty list without wildcards, this is safe.

3. Keep the existing logic that parses origins into `HeaderValue` and builds the allowlist layer.

### A3: Fix Tooltip.tsx getBoundingClientRect crash

In `src/components/shared/Tooltip.tsx`, the `handleMouseEnter` function captures `e.currentTarget` inside a `setTimeout`. React nullifies `e.currentTarget` after the handler returns, so by the time the timeout fires it's `null`, causing: `TypeError: can't access property "getBoundingClientRect", v.currentTarget is null`.

**Fix:** Capture the rect synchronously before the setTimeout:

```typescript
// BEFORE (broken):
function handleMouseEnter(e: React.MouseEvent) {
  timeoutRef.current = setTimeout(() => {
    const target = e.currentTarget as Element;
    const rect = target.getBoundingClientRect();  // currentTarget is null here
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    setVisible(true);
  }, delay);
}

// AFTER (fixed):
function handleMouseEnter(e: React.MouseEvent) {
  const rect = (e.currentTarget as Element).getBoundingClientRect();  // capture NOW
  timeoutRef.current = setTimeout(() => {
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    setVisible(true);
  }, delay);
}
```

## Verification
After all tasks, run:
```bash
cd server && cargo test && npx tsc --noEmit
```
All must pass. Commit your changes with descriptive messages.
