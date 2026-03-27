import type { Awareness } from 'y-protocols/awareness';
import type { CollabUser } from '../types';
import { CURRENT_MAJOR, CURRENT_MINOR } from '../schema/ydoc';

const PRESENCE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#8b5cf6', // violet
];

function pickColor(clientId: number): string {
  return PRESENCE_COLORS[clientId % PRESENCE_COLORS.length];
}

/**
 * Set the local user's identity in the awareness protocol.
 */
export function setLocalAwareness(
  awareness: Awareness,
  user: { name: string; email: string }
): void {
  const clientId = awareness.clientID;
  awareness.setLocalStateField('user', {
    name: user.name,
    email: user.email,
    color: pickColor(clientId),
    viewingTaskId: null,
    viewingCellColumn: null,
  });
  // Broadcast schema version for peer version awareness.
  // Peers monitor this to detect version mismatches.
  awareness.setLocalStateField('schemaMajor', CURRENT_MAJOR);
  awareness.setLocalStateField('schemaMinor', CURRENT_MINOR);
}

/**
 * Update which task and cell the local user is currently viewing.
 */
export function updateViewingTask(
  awareness: Awareness,
  taskId: string | null,
  cellColumn: string | null
): void {
  const current = awareness.getLocalState();
  if (!current?.user) return;

  awareness.setLocalStateField('user', {
    ...current.user,
    viewingTaskId: taskId,
    viewingCellColumn: cellColumn,
  });
}

/**
 * Broadcast drag intent to other users via awareness.
 * Pass null to clear (on mouseup).
 */
export function setDragIntent(
  awareness: Awareness,
  dragging: { taskId: string; startDate: string; endDate: string } | null
): void {
  const current = awareness.getLocalState();
  if (!current?.user) return;

  awareness.setLocalStateField('user', {
    ...current.user,
    dragging,
  });
}

/**
 * Get all connected collaboration users, excluding the local client.
 */
export function getCollabUsers(awareness: Awareness): CollabUser[] {
  const localClientId = awareness.clientID;
  const users: CollabUser[] = [];

  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localClientId) return;
    if (!state.user) return;

    users.push({
      clientId,
      name: state.user.name ?? 'Anonymous',
      email: state.user.email ?? '',
      color: state.user.color ?? pickColor(clientId),
      viewingTaskId: state.user.viewingTaskId ?? null,
      viewingCellColumn: state.user.viewingCellColumn ?? null,
      dragging: state.user.dragging ?? null,
    });
  });

  return users;
}
