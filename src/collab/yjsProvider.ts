import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';

// Normalize localhost to 127.0.0.1 for WebSocket connections — headless Chromium
// in Docker may not resolve 'localhost' for WS, causing silent connection failures.
const rawCollabUrl =
  window.__ganttlet_config?.collabUrl || import.meta.env.VITE_COLLAB_URL || 'ws://localhost:4000';
const COLLAB_URL = rawCollabUrl.replace('://localhost:', '://127.0.0.1:');

let doc: Y.Doc | null = null;
let provider: WebsocketProvider | null = null;

export interface CollabConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
}

/**
 * Connect to the collaboration server for a given room.
 * The room ID is typically a Google Sheet ID.
 * The access token is sent as a WebSocket message after connection.
 *
 * Schema: The Y.Doc uses Y.Map<Y.Map<unknown>>('tasks') (not Y.Array).
 * See src/schema/ydoc.ts initSchema() for the full structure.
 */
export function connectCollab(roomId: string, accessToken: string): CollabConnection {
  disconnectCollab();

  doc = new Y.Doc();

  const wsUrl = `${COLLAB_URL}/ws`;

  provider = new WebsocketProvider(wsUrl, roomId, doc, {
    connect: true,
  });

  // Send auth token as the first WebSocket message after each connection.
  // The status event fires on every (re)connection, so auth is re-sent automatically.
  // After sending auth, re-announce local awareness state so the server has it
  // post-auth (the pre-auth awareness was buffered and replayed, but it may only
  // contain the default state — this ensures the full user identity is broadcast).
  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected' && provider?.ws) {
      provider.ws.send(JSON.stringify({ type: 'auth', token: accessToken }));

      // Re-announce awareness after a short delay to ensure auth is processed first.
      // setLocalState triggers the awareness protocol to encode and send the full
      // local state over the WebSocket, so the server and other clients receive it.
      setTimeout(() => {
        if (provider?.awareness) {
          const currentState = provider.awareness.getLocalState();
          if (currentState) {
            provider.awareness.setLocalState(currentState);
          }
        }
      }, 100);
    }
  });

  return {
    doc,
    provider,
    awareness: provider.awareness,
  };
}

/**
 * Disconnect from the collaboration server and clean up resources.
 */
export function disconnectCollab(): void {
  if (provider) {
    provider.disconnect();
    provider.destroy();
    provider = null;
  }
  if (doc) {
    doc.destroy();
    doc = null;
  }
}

/**
 * Get the current Yjs document, or null if not connected.
 */
export function getDoc(): Y.Doc | null {
  return doc;
}

/**
 * Get the current WebSocket provider, or null if not connected.
 */
export function getProvider(): WebsocketProvider | null {
  return provider;
}
