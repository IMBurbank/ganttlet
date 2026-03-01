import * as Y from 'yjs';
import type { Dispatch } from 'react';
import type { Task, Dependency } from '../types';
import type { GanttAction } from '../state/actions';

/**
 * Flag to prevent echoing local changes back through the observer.
 */
let isLocalUpdate = false;

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
  return ymap;
}

function yMapToTask(ymap: Y.Map<unknown>): Task {
  let childIds: string[] = [];
  let dependencies: Dependency[] = [];
  let okrs: string[] = [];

  try {
    const childIdsRaw = ymap.get('childIds');
    if (typeof childIdsRaw === 'string') childIds = JSON.parse(childIdsRaw);
  } catch { /* default to empty */ }

  try {
    const depsRaw = ymap.get('dependencies');
    if (typeof depsRaw === 'string') dependencies = JSON.parse(depsRaw);
  } catch { /* default to empty */ }

  try {
    const okrsRaw = ymap.get('okrs');
    if (typeof okrsRaw === 'string') okrs = JSON.parse(okrsRaw);
  } catch { /* default to empty */ }

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
    if (isLocalUpdate) return;
    const tasks = readTasksFromYjs(doc);
    dispatch({ type: 'SET_TASKS', tasks });
  };

  yarray.observeDeep(observer);
  return () => yarray.unobserveDeep(observer);
}

/**
 * Load an initial set of tasks into the Yjs document.
 */
export function applyTasksToYjs(doc: Y.Doc, tasks: Task[]): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  isLocalUpdate = true;
  try {
    doc.transact(() => {
      yarray.delete(0, yarray.length);
      for (const task of tasks) {
        yarray.push([taskToYMap(task)]);
      }
    });
  } finally {
    isLocalUpdate = false;
  }
}

/**
 * Apply a local action to the Yjs document so it gets broadcast to
 * other clients.
 */
export function applyActionToYjs(doc: Y.Doc, action: GanttAction): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');

  switch (action.type) {
    case 'MOVE_TASK': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('startDate', action.newStartDate);
            ymap.set('endDate', action.newEndDate);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'RESIZE_TASK': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('endDate', action.newEndDate);
            ymap.set('duration', action.newDuration);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'UPDATE_TASK_FIELD': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set(action.field, action.value);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'TOGGLE_EXPAND': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            const current = ymap.get('isExpanded') as boolean;
            ymap.set('isExpanded', !current);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'HIDE_TASK': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          const idx = findTaskIndex(yarray, action.taskId);
          if (idx !== -1) {
            const ymap = yarray.get(idx) as Y.Map<unknown>;
            ymap.set('isHidden', true);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'SHOW_ALL_TASKS': {
      isLocalUpdate = true;
      try {
        doc.transact(() => {
          for (let i = 0; i < yarray.length; i++) {
            const ymap = yarray.get(i) as Y.Map<unknown>;
            ymap.set('isHidden', false);
          }
        });
      } finally {
        isLocalUpdate = false;
      }
      break;
    }

    case 'SET_TASKS': {
      applyTasksToYjs(doc, action.tasks);
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
