import { useEffect, useRef } from 'react';
import { useCollaborationStore } from '../stores';

/**
 * Simulates multi-user collaboration by periodically moving
 * non-"you" cursors and occasionally changing their selected task.
 */
export function useCollaborationSim() {
  const updateUserCursor = useCollaborationStore((s) => s.updateUserCursor);
  const updateUserSelection = useCollaborationStore((s) => s.updateUserSelection);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const taskIds: (string | null)[] = [
      'task-1-1-3', 'task-1-1-4', 'task-1-2-4', 'task-1-2-5',
      'task-1-3-3', 'task-2-1-2', 'task-2-1-3', 'task-2-2-2',
      null,
    ];

    intervalRef.current = setInterval(() => {
      const otherUsers = useCollaborationStore.getState().users.filter((u) => !u.isYou);

      for (const user of otherUsers) {
        // Random cursor drift
        const newX = user.cursorX + (Math.random() - 0.5) * 60;
        const newY = user.cursorY + (Math.random() - 0.5) * 40;
        updateUserCursor(
          user.id,
          Math.max(50, Math.min(1200, newX)),
          Math.max(30, Math.min(800, newY))
        );

        // Occasionally change selected task
        if (Math.random() < 0.1) {
          const taskId = taskIds[Math.floor(Math.random() * taskIds.length)];
          updateUserSelection(user.id, taskId);
        }
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateUserCursor, updateUserSelection]);
}
