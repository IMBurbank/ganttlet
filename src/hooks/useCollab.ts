import { useContext } from 'react';
import { CollabContext } from '../state/TaskStoreProvider';

export function useCollab() {
  return useContext(CollabContext);
}
