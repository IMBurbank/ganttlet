import { createContext, useContext } from 'react';
import type { MutateAction } from '../types';

export const MutateContext = createContext<((action: MutateAction) => void) | null>(null);

export function useMutate(): (action: MutateAction) => void {
  const mutate = useContext(MutateContext);
  if (!mutate) throw new Error('useMutate must be used within TaskStoreProvider');
  return mutate;
}
