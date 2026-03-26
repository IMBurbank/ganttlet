import * as Y from 'yjs';
import type { Task, Dependency } from '../types';
import { taskDuration } from '../utils/dateUtils';

/**
 * The 19 collaborative fields stored in each task's Y.Map.
 * Excludes: duration (computed from startDate/endDate).
 */
export const TASK_FIELDS: string[] = [
  'id',
  'name',
  'startDate',
  'endDate',
  'owner',
  'workStream',
  'project',
  'functionalArea',
  'done',
  'description',
  'isMilestone',
  'isSummary',
  'parentId',
  'childIds',
  'dependencies',
  'notes',
  'okrs',
  'constraintType',
  'constraintDate',
];

/**
 * Initialize a fresh Y.Doc with the correct top-level structure.
 */
export function initSchema(doc: Y.Doc): {
  tasks: Y.Map<Y.Map<unknown>>;
  taskOrder: Y.Array<string>;
  meta: Y.Map<unknown>;
} {
  const tasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');
  const meta = doc.getMap('meta') as Y.Map<unknown>;
  if (!meta.has('schemaVersion')) {
    // Check for legacy Y.Array-based data (pre-Y.Map schema)
    try {
      const legacyArray = doc.getArray('legacyTasks');
      if (legacyArray.length > 0) {
        console.warn(
          `[ydoc] Detected ${legacyArray.length} items in legacy Y.Array('legacyTasks'). ` +
            'Migration from Y.Array to Y.Map schema is not yet implemented. Data may need manual migration.'
        );
      }
    } catch {
      // No legacy data — this is expected for fresh docs
    }
    meta.set('schemaVersion', 1);
  }
  return { tasks, taskOrder, meta };
}

/**
 * Convert a Task object to a Y.Map for insertion into the Y.Doc.
 * Writes all 19 TASK_FIELDS. Does NOT write duration (computed).
 * Arrays (childIds, dependencies, okrs) are JSON-stringified.
 */
export function taskToYMap(task: Task): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  ymap.set('id', task.id);
  ymap.set('name', task.name);
  ymap.set('startDate', task.startDate);
  ymap.set('endDate', task.endDate);
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
  ymap.set('notes', task.notes);
  ymap.set('okrs', JSON.stringify(task.okrs));
  if (task.constraintType != null) {
    ymap.set('constraintType', task.constraintType);
  }
  if (task.constraintDate != null) {
    ymap.set('constraintDate', task.constraintDate);
  }
  return ymap;
}

/**
 * Convert a Y.Map back to a Task object.
 * Computes duration from startDate/endDate via taskDuration().
 * Parses childIds, dependencies, okrs from JSON strings with fallback to [].
 */
export function yMapToTask(ymap: Y.Map<unknown>): Task {
  let childIds: string[] = [];
  let dependencies: Dependency[] = [];
  let okrs: string[] = [];

  try {
    const raw = ymap.get('childIds');
    if (typeof raw === 'string') childIds = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  try {
    const raw = ymap.get('dependencies');
    if (typeof raw === 'string') dependencies = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  try {
    const raw = ymap.get('okrs');
    if (typeof raw === 'string') okrs = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  const startDate = (ymap.get('startDate') as string) ?? '';
  const endDate = (ymap.get('endDate') as string) ?? '';
  const duration = startDate && endDate ? taskDuration(startDate, endDate) : 0;

  return {
    id: (ymap.get('id') as string) ?? '',
    name: (ymap.get('name') as string) ?? '',
    startDate,
    endDate,
    duration,
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
    notes: (ymap.get('notes') as string) ?? '',
    okrs,
    constraintType: (ymap.get('constraintType') as Task['constraintType']) ?? undefined,
    constraintDate: (ymap.get('constraintDate') as string) ?? undefined,
  };
}
