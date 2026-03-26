import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { CollabUser } from '../types';
import { setLocalAwareness, getCollabUsers } from './awareness';
import { getProvider } from './yjsProvider';

interface AwarenessState {
  awareness: Awareness | null;
  collabUsers: CollabUser[];
  isCollabConnected: boolean;
}

export const AwarenessContext = createContext<AwarenessState>({
  awareness: null,
  collabUsers: [],
  isCollabConnected: false,
});

export function useAwareness() {
  return useContext(AwarenessContext);
}

interface AwarenessProviderProps {
  children: React.ReactNode;
  roomId?: string;
  userName?: string;
  userEmail?: string;
}

export function AwarenessProvider({
  children,
  roomId,
  userName,
  userEmail,
}: AwarenessProviderProps) {
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [collabUsers, setCollabUsers] = useState<CollabUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!roomId) {
      setAwareness(null);
      setCollabUsers([]);
      setIsConnected(false);
      return;
    }

    // Poll for provider readiness (connectCollab is called by TaskStoreProvider)
    const checkProvider = () => {
      const provider = getProvider();
      if (provider) {
        setAwareness(provider.awareness);
        setIsConnected(provider.wsconnected);

        // Set local identity
        if (userName && userEmail) {
          setLocalAwareness(provider.awareness, { name: userName, email: userEmail });
        }

        // Subscribe to awareness changes
        const onChange = () => {
          setCollabUsers(getCollabUsers(provider.awareness));
        };
        provider.awareness.on('change', onChange);

        // Subscribe to connection status
        const onStatus = ({ status }: { status: string }) => {
          setIsConnected(status === 'connected');
        };
        provider.on('status', onStatus);

        // Initial read
        onChange();

        return () => {
          provider.awareness.off('change', onChange);
          provider.off('status', onStatus);
        };
      }
      return undefined;
    };

    // Try immediately, then retry after a short delay (connectCollab may not have run yet)
    let cleanup = checkProvider();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!cleanup) {
      retryTimer = setTimeout(() => {
        cleanup = checkProvider();
      }, 500);
    }

    return () => {
      cleanup?.();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [roomId, userName, userEmail]);

  const value = useMemo(
    () => ({
      awareness,
      collabUsers,
      isCollabConnected: isConnected,
    }),
    [awareness, collabUsers, isConnected]
  );

  return <AwarenessContext.Provider value={value}>{children}</AwarenessContext.Provider>;
}
