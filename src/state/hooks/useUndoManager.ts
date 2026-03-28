import { useEffect, useRef, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import { TRACKED_ORIGINS } from '../../collab/origins';

interface UseUndoManagerResult {
  undoManagerRef: RefObject<Y.UndoManager | null>;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoManager(doc: Y.Doc): UseUndoManagerResult {
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [undoState, setUndoState] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  // Y.UndoManager: scoped to 'local' origin, captureTimeout 500ms
  useEffect(() => {
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const um = new Y.UndoManager(ytasks, {
      trackedOrigins: TRACKED_ORIGINS,
      captureTimeout: 500,
    });
    undoManagerRef.current = um;

    const updateState = () => {
      setUndoState({ canUndo: um.canUndo(), canRedo: um.canRedo() });
    };
    um.on('stack-item-added', updateState);
    um.on('stack-item-popped', updateState);
    um.on('stack-cleared', updateState);

    return () => {
      um.destroy();
      undoManagerRef.current = null;
    };
  }, [doc]);

  // Listen for undo/redo events from UIStoreProvider keyboard handler
  useEffect(() => {
    const handleUndo = () => {
      if (undoManagerRef.current?.canUndo()) {
        undoManagerRef.current.undo();
      }
    };
    const handleRedo = () => {
      if (undoManagerRef.current?.canRedo()) {
        undoManagerRef.current.redo();
      }
    };
    window.addEventListener('ganttlet:undo', handleUndo);
    window.addEventListener('ganttlet:redo', handleRedo);
    return () => {
      window.removeEventListener('ganttlet:undo', handleUndo);
      window.removeEventListener('ganttlet:redo', handleRedo);
    };
  }, []);

  return { undoManagerRef, ...undoState };
}
