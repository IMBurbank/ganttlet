---
name: rust-wasm
description: "Use when building WASM, debugging wasm-pack, or modifying Rust→JS bindings in crates/scheduler/. Covers build commands, wasm-bindgen patterns, and debugging tips."
---

# Rust→WASM Guide

## Build Command
```bash
npm run build:wasm
```
This runs `wasm-pack build` in `crates/scheduler/` targeting the browser.

## wasm-pack Options
- Target: `--target web` (browser-native ES modules)
- Output: generates JS glue code + `.wasm` binary
- Profile: debug for dev, release for production

## wasm-bindgen Patterns
- Functions exposed to JS are annotated with `#[wasm_bindgen]`
- Complex types use `serde` serialization (JsValue ↔ Rust structs)
- `lib.rs` is the public API surface — all exports go through here
- Use `web_sys` and `js_sys` for browser API interop

## Generated Files Location
Output goes to `src/wasm/scheduler/`:
- `scheduler.js` — JS glue code
- `scheduler_bg.wasm` — compiled WASM binary
- `scheduler.d.ts` — TypeScript type definitions

## Debugging WASM Build Failures
- **Missing wasm-pack**: Install via `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`
- **Compilation errors**: Run `cargo check` in `crates/scheduler/` first for better error messages
- **Binding errors**: Check that `#[wasm_bindgen]` types are compatible (no lifetimes, no generics on exported fns)
- **Size issues**: Use `wasm-opt` or check for unnecessary dependencies in `Cargo.toml`

## How lib.rs Exports Work
- Each `#[wasm_bindgen]` pub function becomes a JS export
- Structs with `#[wasm_bindgen]` get a JS class wrapper
- Methods on `#[wasm_bindgen]` structs become class methods in JS
