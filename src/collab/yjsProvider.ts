import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL || 'ws://localhost:4000';

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
  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected' && provider?.ws) {
      provider.ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
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
