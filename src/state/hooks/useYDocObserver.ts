import { useEffect } from 'react';
import * as Y from 'yjs';
import type { TaskStore } from '../../store/TaskStore';
import type { CriticalPathScope } from '../../types';
import { setupObserver } from '../../collab/observer';

export function useYDocObserver(
  doc: Y.Doc,
  taskStore: TaskStore,
  criticalPathScope: CriticalPathScope,
  getDraggedTaskId: () => string | null
): void {
  useEffect(() => {
    const cleanup = setupObserver(doc, taskStore, { criticalPathScope }, getDraggedTaskId);
    return cleanup;
  }, [doc, taskStore, criticalPathScope, getDraggedTaskId]);
}
