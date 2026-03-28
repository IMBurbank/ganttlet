import * as Y from 'yjs';

/**
 * Transaction origin constants. Use these instead of raw strings
 * to ensure compile-time traceability and single-source-of-truth routing.
 */
export const ORIGIN = {
  /** User edits — undoable, triggers cascade + Sheets writeback */
  LOCAL: 'local',
  /** Sheets adapter injection — not undoable, no cascade */
  SHEETS: 'sheets',
  /** Initialization (sandbox, hydration) — not undoable */
  INIT: 'init',
} as const;

export type KnownOrigin = (typeof ORIGIN)[keyof typeof ORIGIN];

/**
 * Classify a Y.Doc transaction origin for routing decisions.
 * Single source of truth — all origin branching should call this.
 */
export function classifyOrigin(
  origin: unknown
): 'local' | 'sheets' | 'init' | 'undo' | 'remote' | 'unknown' {
  if (origin === ORIGIN.LOCAL) return 'local';
  if (origin === ORIGIN.SHEETS) return 'sheets';
  if (origin === ORIGIN.INIT) return 'init';
  if (origin instanceof Y.UndoManager) return 'undo';
  // WebSocket provider sets itself as origin — detect via 'ws' property
  if (origin != null && typeof origin === 'object' && 'ws' in (origin as Record<string, unknown>)) {
    return 'remote';
  }
  return 'unknown';
}

/**
 * Should this origin trigger a write-back to Google Sheets?
 * True for local user edits and undo/redo (both change user-visible state).
 */
export function triggersWriteback(origin: unknown): boolean {
  const kind = classifyOrigin(origin);
  return kind === 'local' || kind === 'undo';
}

/**
 * Should Y.UndoManager track this origin?
 * Only direct user edits ('local') are undoable.
 * Undo replay, sheets injection, and init are not.
 */
export function isUndoable(origin: unknown): boolean {
  return origin === ORIGIN.LOCAL;
}

/** Origins tracked by Y.UndoManager — pass to trackedOrigins config */
export const TRACKED_ORIGINS = new Set<unknown>([ORIGIN.LOCAL]);
