import { useCallback, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';
import type { ConflictRecord } from '../../types';

function ConflictRow({
  conflict,
  onResolve,
}: {
  conflict: ConflictRecord;
  onResolve: (taskId: string, field: string, value: unknown) => void;
}) {
  return (
    <tr>
      <td
        style={{
          padding: '8px',
          borderBottom: '1px solid #e0e0e0',
          fontFamily: 'monospace',
          fontSize: '13px',
        }}
      >
        {conflict.taskId.slice(0, 8)}
      </td>
      <td style={{ padding: '8px', borderBottom: '1px solid #e0e0e0' }}>{conflict.field}</td>
      <td style={{ padding: '8px', borderBottom: '1px solid #e0e0e0' }}>
        <button
          onClick={() => onResolve(conflict.taskId, conflict.field, conflict.localValue)}
          style={{
            padding: '4px 8px',
            background: '#e3f2fd',
            border: '1px solid #90caf9',
            borderRadius: '4px',
            cursor: 'pointer',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`Keep local: ${String(conflict.localValue)}`}
        >
          {String(conflict.localValue) || '(empty)'}
        </button>
      </td>
      <td style={{ padding: '8px', borderBottom: '1px solid #e0e0e0' }}>
        <button
          onClick={() => onResolve(conflict.taskId, conflict.field, conflict.remoteValue)}
          style={{
            padding: '4px 8px',
            background: '#fce4ec',
            border: '1px solid #ef9a9a',
            borderRadius: '4px',
            cursor: 'pointer',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`Accept external: ${String(conflict.remoteValue)}`}
        >
          {String(conflict.remoteValue) || '(empty)'}
        </button>
      </td>
    </tr>
  );
}

export default function ConflictResolutionModal() {
  const conflicts = useUIStore((s) => s.pendingConflicts);
  const uiStore = useContext(UIStoreContext)!;

  const close = useCallback(() => {
    uiStore.setState({ pendingConflicts: null });
  }, [uiStore]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  const handleResolve = useCallback(
    (taskId: string, field: string, value: unknown) => {
      if (!conflicts) return;
      // Remove resolved conflict from list
      const remaining = conflicts.filter((c) => !(c.taskId === taskId && c.field === field));

      // Dispatch a field update mutation via custom event
      // TaskStoreProvider listens for this to apply to Y.Doc
      window.dispatchEvent(
        new CustomEvent('ganttlet:conflict-resolve', {
          detail: { taskId, field, value },
        })
      );

      if (remaining.length === 0) {
        uiStore.setState({ pendingConflicts: null });
      } else {
        uiStore.setState({ pendingConflicts: remaining });
      }
    },
    [conflicts, uiStore]
  );

  const handleKeepAllLocal = useCallback(() => {
    if (!conflicts) return;
    for (const c of conflicts) {
      window.dispatchEvent(
        new CustomEvent('ganttlet:conflict-resolve', {
          detail: { taskId: c.taskId, field: c.field, value: c.localValue },
        })
      );
    }
    uiStore.setState({ pendingConflicts: null });
  }, [conflicts, uiStore]);

  const handleAcceptAllExternal = useCallback(() => {
    if (!conflicts) return;
    for (const c of conflicts) {
      window.dispatchEvent(
        new CustomEvent('ganttlet:conflict-resolve', {
          detail: { taskId: c.taskId, field: c.field, value: c.remoteValue },
        })
      );
    }
    uiStore.setState({ pendingConflicts: null });
  }, [conflicts, uiStore]);

  if (!conflicts || conflicts.length === 0) return null;

  return createPortal(
    <div
      data-testid="conflict-resolution-modal"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '700px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Sync Conflicts</h2>
        <p style={{ margin: '0 0 16px 0', color: '#666', fontSize: '14px' }}>
          Some tasks were edited both locally and in Google Sheets. Choose which version to keep for
          each field.
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={handleKeepAllLocal}
            style={{
              padding: '6px 12px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Keep all mine
          </button>
          <button
            onClick={handleAcceptAllExternal}
            style={{
              padding: '6px 12px',
              background: '#c62828',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Accept all external
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px',
                  borderBottom: '2px solid #ccc',
                  fontSize: '13px',
                }}
              >
                Task
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px',
                  borderBottom: '2px solid #ccc',
                  fontSize: '13px',
                }}
              >
                Field
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px',
                  borderBottom: '2px solid #ccc',
                  fontSize: '13px',
                }}
              >
                Local
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px',
                  borderBottom: '2px solid #ccc',
                  fontSize: '13px',
                }}
              >
                External
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <ConflictRow key={`${c.taskId}-${c.field}`} conflict={c} onResolve={handleResolve} />
            ))}
          </tbody>
        </table>
      </div>
    </div>,
    document.body
  );
}
