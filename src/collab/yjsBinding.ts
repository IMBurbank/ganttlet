import * as Y from 'yjs';
import type { Dispatch } from 'react';
import type { Task, Dependency } from '../types';
import type { GanttAction } from '../state/actions';
import { cascadeDependents } from '../utils/schedulerWasm';
import { taskDuration } from '../utils/dateUtils';

/**
 * T1.3: Per-doc local update tracking. WeakSet so docs are GC'd when destroyed.
 * Yjs transactions are synchronous — try/finally guarantees cleanup.
 */
const localUpdateDocs = new WeakSet<Y.Doc>();

function withLocalUpdate<T>(doc: Y.Doc, fn: () => T): T {
  localUpdateDocs.add(doc);
  try {
    return fn();
  } finally {
    localUpdateDocs.delete(doc);
  }
}

function taskToYMap(task: Task): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  ymap.set('id', task.id);
  ymap.set('name', task.name);
  ymap.set('startDate', task.startDate);
  ymap.set('endDate', task.endDate);
  ymap.set('duration', task.duration);
  ymap.set('owner', task.owner);
  ymap.set('workStream', task.workStream);
  ymap.set('project', task.project);
  ymap.set('functionalArea', task.functionalArea);
  ymap.set('done', task.done);
  ymap.set('description', task.description);
  ymap.set('isMilestone', task.isMilestone);
  ymap.set('isSummary', task.isSummary);
  ymap.set('parentId', task.parentId);
  ymap.set('childIds', JSON.stringify(task.childIds));
  ymap.set('dependencies', JSON.stringify(task.dependencies));
  ymap.set('isExpanded', task.isExpanded);
  ymap.set('isHidden', task.isHidden);
  ymap.set('notes', task.notes);
  ymap.set('okrs', JSON.stringify(task.okrs));
  if (task.constraintType) ymap.set('constraintType', task.constraintType);
  if (task.constraintDate) ymap.set('constraintDate', task.constraintDate);
  return ymap;
}

function yMapToTask(ymap: Y.Map<unknown>): Task {
  let childIds: string[] = [];
  let dependencies: Dependency[] = [];
  let okrs: string[] = [];

  try {
    const childIdsRaw = ymap.get('childIds');
    if (typeof childIdsRaw === 'string') childIds = JSON.parse(childIdsRaw);
  } catch {
    /* default to empty */
  }

  try {
    const depsRaw = ymap.get('dependencies');
    if (typeof depsRaw === 'string') dependencies = JSON.parse(depsRaw);
  } catch {
    /* default to empty */
  }

  try {
    const okrsRaw = ymap.get('okrs');
    if (typeof okrsRaw === 'string') okrs = JSON.parse(okrsRaw);
  } catch {
    /* default to empty */
  }

  return {
    id: (ymap.get('id') as string) ?? '',
    name: (ymap.get('name') as string) ?? '',
    startDate: (ymap.get('startDate') as string) ?? '',
    endDate: (ymap.get('endDate') as string) ?? '',
    duration: (ymap.get('duration') as number) ?? 0,
    owner: (ymap.get('owner') as string) ?? '',
    workStream: (ymap.get('workStream') as string) ?? '',
    project: (ymap.get('project') as string) ?? '',
    functionalArea: (ymap.get('functionalArea') as string) ?? '',
    done: (ymap.get('done') as boolean) ?? false,
    description: (ymap.get('description') as string) ?? '',
    isMilestone: (ymap.get('isMilestone') as boolean) ?? false,
    isSummary: (ymap.get('isSummary') as boolean) ?? false,
    parentId: (ymap.get('parentId') as string | null) ?? null,
    childIds,
    dependencies,
    isExpanded: (ymap.get('isExpanded') as boolean) ?? false,
    isHidden: (ymap.get('isHidden') as boolean) ?? false,
    notes: (ymap.get('notes') as string) ?? '',
    okrs,
    constraintType: (ymap.get('constraintType') as Task['constraintType']) ?? undefined,
    constraintDate: (ymap.get('constraintDate') as string) ?? undefined,
  };
}

function readTasksFromYjs(doc: Y.Doc): Task[] {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');
  const tasks: Task[] = [];
  for (let i = 0; i < yarray.length; i++) {
    const ymap = yarray.get(i);
    if (ymap instanceof Y.Map) {
      tasks.push(yMapToTask(ymap));
    }
  }
  return tasks;
}

/**
 * Bind the Yjs document to the React dispatch so that remote changes
 * automatically update React state via SET_TASKS.
 * Returns a cleanup function.
 */
export function bindYjsToDispatch(doc: Y.Doc, dispatch: Dispatch<GanttAction>): () => void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  const observer = () => {
    if (localUpdateDocs.has(doc)) return;
    const tasks = readTasksFromYjs(doc);
    dispatch({ type: 'SET_TASKS', tasks, source: 'yjs' });
  };

  yarray.observeDeep(observer);
  return () => yarray.unobserveDeep(observer);
}

/**
 * Hydrate an empty Yjs document from Sheets data on initialization.
 * Only writes if the Yjs array is empty to avoid overwriting existing data.
 */
export function hydrateYjsFromTasks(doc: Y.Doc, tasks: Task[]): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');
  if (yarray.length > 0) return; // Already has data, don't overwrite
  applyTasksToYjs(doc, tasks);
}

/**
 * Load an initial set of tasks into the Yjs document.
 */
export function applyTasksToYjs(doc: Y.Doc, tasks: Task[]): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  withLocalUpdate(doc, () => {
    doc.transact(() => {
      yarray.delete(0, yarray.length);
      for (const task of tasks) {
        yarray.push([taskToYMap(task)]);
      }
    });
  });
}

/**
 * Apply a local action to the Yjs document so it gets broadcast to
 * other clients.
 */
export function applyActionToYjs(doc: Y.Doc, action: GanttAction): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  switch (action.type) {
    case 'MOVE_TASK': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('startDate', action.newStartDate);
            ymap.set('endDate', action.newEndDate);
          }
        });
      });
      break;
    }

    case 'RESIZE_TASK': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('endDate', action.newEndDate);
            const duration = taskDuration(ymap.get('startDate') as string, action.newEndDate);
            ymap.set('duration', duration);
          }
        });
      });
      break;
    }

    case 'UPDATE_TASK_FIELD': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set(action.field, action.value);

            // Sync duration when date fields change (Bug 14 fix)
            if (action.field === 'startDate' || action.field === 'endDate') {
              const start = (
                action.field === 'startDate' ? action.value : ymap.get('startDate')
              ) as string;
              const end = (
                action.field === 'endDate' ? action.value : ymap.get('endDate')
              ) as string;
              ymap.set('duration', taskDuration(start, end));
            }
          }
        });
      });
      break;
    }

    case 'SET_CONSTRAINT': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('constraintType', action.constraintType);
            if (action.constraintDate) {
              ymap.set('constraintDate', action.constraintDate);
            } else {
              ymap.delete('constraintDate');
            }
          }
        });
      });
      break;
    }

    case 'TOGGLE_EXPAND': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            const current = ymap.get('isExpanded') as boolean;
            ymap.set('isExpanded', !current);
          }
        });
      });
      break;
    }

    case 'HIDE_TASK': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('isHidden', true);
          }
        });
      });
      break;
    }

    case 'SHOW_ALL_TASKS': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          for (let i = 0; i < yarray.length; i++) {
            const ymap = yarray.get(i) as Y.Map<unknown>;
            ymap.set('isHidden', false);
          }
        });
      });
      break;
    }

    case 'CASCADE_DEPENDENTS': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const currentTasks = readTasksFromYjs(doc);
          const updated = cascadeDependents(currentTasks, action.taskId, action.daysDelta);
          for (const task of updated) {
            const idx = findTaskIndex(yarray, task.id);
            if (idx !== -1) {
              const orig = currentTasks.find((t) => t.id === task.id);
              if (orig && (orig.startDate !== task.startDate || orig.endDate !== task.endDate)) {
                const ymap = yarray.get(idx) as Y.Map<unknown>;
                ymap.set('startDate', task.startDate);
                ymap.set('endDate', task.endDate);
              }
            }
          }
        });
      });
      break;
    }

    case 'COMPLETE_DRAG': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('startDate', action.newStartDate);
            ymap.set('endDate', action.newEndDate);
            ymap.set('duration', taskDuration(action.newStartDate, action.newEndDate));
          }
          // Also cascade dependents in the CRDT
          if (action.daysDelta !== 0) {
            const currentTasks = readTasksFromYjs(doc);
            const updated = cascadeDependents(currentTasks, action.taskId, action.daysDelta);
            for (const task of updated) {
              const ci = findTaskIndex(yarray, task.id);
              if (ci !== -1) {
                const orig = currentTasks.find((t) => t.id === task.id);
                if (orig && (orig.startDate !== task.startDate || orig.endDate !== task.endDate)) {
                  const cmap = yarray.get(ci) as Y.Map<unknown>;
                  cmap.set('startDate', task.startDate);
                  cmap.set('endDate', task.endDate);
                  cmap.set('duration', taskDuration(task.startDate, task.endDate));
                }
              }
            }
          }
        });
      });
      break;
    }

    case 'ADD_DEPENDENCY': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            const depsRaw = ymap.get('dependencies') as string;
            let deps: Dependency[] = [];
            if (depsRaw)
              try {
                deps = JSON.parse(depsRaw);
              } catch {
                /* empty */
              }
            deps.push(action.dependency);
            ymap.set('dependencies', JSON.stringify(deps));
          }
        });
      });
      break;
    }

    // Note: fromId uniquely identifies a dep within a task's array since toId == taskId
    case 'UPDATE_DEPENDENCY': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            const depsRaw = ymap.get('dependencies') as string;
            let deps: Dependency[] = [];
            if (depsRaw)
              try {
                deps = JSON.parse(depsRaw);
              } catch {
                /* empty */
              }
            deps = deps.map((d) =>
              d.fromId === action.fromId ? { ...d, type: action.newType, lag: action.newLag } : d
            );
            ymap.set('dependencies', JSON.stringify(deps));
          }
        });
      });
      break;
    }

    case 'REMOVE_DEPENDENCY': {
      withLocalUpdate(doc, () => {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            const depsRaw = ymap.get('dependencies') as string;
            let deps: Dependency[] = [];
            if (depsRaw)
              try {
                deps = JSON.parse(depsRaw);
              } catch {
                /* empty */
              }
            deps = deps.filter((d) => d.fromId !== action.fromId);
            ymap.set('dependencies', JSON.stringify(deps));
          }
        });
      });
      break;
    }

    case 'REPARENT_TASK': {
      // Reparent replaces multiple tasks — handled via full sync in GanttContext
      break;
    }

    default:
      break;
  }
}

function findTaskIndex(yarray: Y.Array<Y.Map<unknown>>, taskId: string): number {
  for (let i = 0; i < yarray.length; i++) {
    const ymap = yarray.get(i);
    if (ymap instanceof Y.Map && ymap.get('id') === taskId) {
      return i;
    }
  }
  return -1;
}
