import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { CollabUser } from '../../types';
import { connectCollab, disconnectCollab, getProvider } from '../../collab/yjsProvider';
import { setLocalAwareness, getCollabUsers } from '../../collab/awareness';

interface UseCollabConnectionResult {
  awareness: Awareness | null;
  collabUsers: CollabUser[];
  isCollabConnected: boolean;
}

export function useCollabConnection(
  doc: Y.Doc,
  roomId?: string,
  accessToken?: string,
  userName?: string,
  userEmail?: string
): UseCollabConnectionResult {
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [collabUsers, setCollabUsers] = useState<CollabUser[]>([]);
  const [isCollabConnected, setIsCollabConnected] = useState(false);

  useEffect(() => {
    if (!roomId || !accessToken) {
      setAwareness(null);
      setCollabUsers([]);
      setIsCollabConnected(false);
      return;
    }

    const { awareness: aw } = connectCollab(roomId, accessToken, doc);
    setAwareness(aw);

    // Set local identity
    if (userName && userEmail) {
      setLocalAwareness(aw, { name: userName, email: userEmail });
    }

    // Subscribe to awareness changes
    const onChange = () => {
      setCollabUsers(getCollabUsers(aw));
    };
    aw.on('change', onChange);
    onChange(); // initial read

    // Subscribe to connection status
    const onStatus = ({ status }: { status: string }) => {
      setIsCollabConnected(status === 'connected');
    };
    const prov = getProvider();
    if (prov) {
      prov.on('status', onStatus);
      setIsCollabConnected(prov.wsconnected);
    }

    return () => {
      aw.off('change', onChange);
      if (prov) prov.off('status', onStatus);
      disconnectCollab();
      setAwareness(null);
    };
  }, [roomId, accessToken, doc, userName, userEmail]);

  return {
    awareness,
    collabUsers,
    isCollabConnected,
  };
}
