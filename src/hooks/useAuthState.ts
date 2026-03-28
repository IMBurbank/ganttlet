import { useSyncExternalStore } from 'react';
import {
  getAuthState,
  setAuthChangeCallback,
  removeAuthChangeCallback,
  type AuthState,
} from '../sheets/oauth';

let currentState = getAuthState();

function subscribe(callback: () => void): () => void {
  const handler = (state: AuthState) => {
    currentState = state;
    callback();
  };
  setAuthChangeCallback(handler);
  return () => removeAuthChangeCallback(handler);
}

function getSnapshot(): AuthState {
  return currentState;
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
