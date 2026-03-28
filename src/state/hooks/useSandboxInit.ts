import { useEffect } from 'react';
import * as Y from 'yjs';
import type { Task } from '../../types';
import { initializeYDoc } from '../../collab/initialization';

export function useSandboxInit(
  doc: Y.Doc,
  dataSource?: 'sandbox' | 'sheet' | 'loading' | 'empty',
  demoTasks?: Task[]
): void {
  useEffect(() => {
    if (dataSource === 'sandbox' && demoTasks && demoTasks.length > 0) {
      initializeYDoc(doc, demoTasks);
    }
  }, [doc, dataSource, demoTasks]);
}
