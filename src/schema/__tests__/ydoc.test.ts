import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yMapToTask, taskToYMap, initSchema, TASK_FIELDS } from '../ydoc';
import type { Task } from '../../types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    startDate: '2025-01-06',
    endDate: '2025-01-10',
    duration: 5,
    owner: 'Alice',
    workStream: 'Engineering',
    project: 'Alpha',
    functionalArea: 'Backend',
    done: false,
    description: 'A test task',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: ['child-1', 'child-2'],
    dependencies: [{ fromId: 'dep-1', toId: 'task-1', type: 'FS', lag: 0 }],
    notes: 'Some notes',
    okrs: ['OKR-1'],
    constraintType: 'ASAP',
    constraintDate: '2025-01-06',
    ...overrides,
  };
}

/**
 * Helper: insert a task into a Y.Doc via taskToYMap and return the Y.Map
 * that is now attached to the doc (so .get()/.has() work).
 */
function insertTask(task: Task): Y.Map<unknown> {
  const doc = new Y.Doc();
  const tasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = taskToYMap(task);
  tasks.set(task.id, ymap);
  return tasks.get(task.id)!;
}

/**
 * Helper: create a Y.Map with raw key/value pairs inside a Y.Doc.
 */
function createRawYMap(entries: [string, unknown][]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const container = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = new Y.Map<unknown>();
  container.set('raw', ymap);
  const attached = container.get('raw')!;
  doc.transact(() => {
    for (const [k, v] of entries) {
      attached.set(k, v);
    }
  });
  return attached;
}

describe('yMapToTask', () => {
  it('returns correct Task from a fully-populated Y.Map', () => {
    const task = makeTask();
    const ymap = insertTask(task);
    const result = yMapToTask(ymap);

    expect(result.id).toBe('task-1');
    expect(result.name).toBe('Test Task');
    expect(result.startDate).toBe('2025-01-06');
    expect(result.endDate).toBe('2025-01-10');
    expect(result.owner).toBe('Alice');
    expect(result.workStream).toBe('Engineering');
    expect(result.project).toBe('Alpha');
    expect(result.functionalArea).toBe('Backend');
    expect(result.done).toBe(false);
    expect(result.description).toBe('A test task');
    expect(result.isMilestone).toBe(false);
    expect(result.isSummary).toBe(false);
    expect(result.parentId).toBe(null);
    expect(result.childIds).toEqual(['child-1', 'child-2']);
    expect(result.dependencies).toEqual([{ fromId: 'dep-1', toId: 'task-1', type: 'FS', lag: 0 }]);
    expect(result.notes).toBe('Some notes');
    expect(result.okrs).toEqual(['OKR-1']);
    expect(result.constraintType).toBe('ASAP');
    expect(result.constraintDate).toBe('2025-01-06');
  });

  it('computes duration from startDate/endDate', () => {
    const task = makeTask({ startDate: '2025-01-06', endDate: '2025-01-10' });
    const ymap = insertTask(task);
    const result = yMapToTask(ymap);
    // Mon-Fri = 5 business days
    expect(result.duration).toBe(5);
  });

  it('handles missing optional fields (constraintType, constraintDate default to undefined)', () => {
    const task = makeTask({ constraintType: undefined, constraintDate: undefined });
    const ymap = insertTask(task);
    const result = yMapToTask(ymap);
    expect(result.constraintType).toBeUndefined();
    expect(result.constraintDate).toBeUndefined();
  });

  it('handles malformed JSON in childIds (falls back to [])', () => {
    const ymap = createRawYMap([
      ['id', 'task-1'],
      ['name', 'Test'],
      ['startDate', '2025-01-06'],
      ['endDate', '2025-01-10'],
      ['childIds', '{not valid json'],
      ['dependencies', '[]'],
      ['okrs', '[]'],
    ]);
    const result = yMapToTask(ymap);
    expect(result.childIds).toEqual([]);
  });

  it('handles malformed JSON in dependencies (falls back to [])', () => {
    const ymap = createRawYMap([
      ['id', 'task-1'],
      ['name', 'Test'],
      ['startDate', '2025-01-06'],
      ['endDate', '2025-01-10'],
      ['childIds', '[]'],
      ['dependencies', 'not json'],
      ['okrs', '[]'],
    ]);
    const result = yMapToTask(ymap);
    expect(result.dependencies).toEqual([]);
  });

  it('handles malformed JSON in okrs (falls back to [])', () => {
    const ymap = createRawYMap([
      ['id', 'task-1'],
      ['name', 'Test'],
      ['startDate', '2025-01-06'],
      ['endDate', '2025-01-10'],
      ['childIds', '[]'],
      ['dependencies', '[]'],
      ['okrs', '{bad'],
    ]);
    const result = yMapToTask(ymap);
    expect(result.okrs).toEqual([]);
  });

  it('handles completely empty Y.Map (all defaults)', () => {
    const ymap = createRawYMap([]);
    const result = yMapToTask(ymap);
    expect(result.id).toBe('');
    expect(result.name).toBe('');
    expect(result.startDate).toBe('');
    expect(result.endDate).toBe('');
    expect(result.duration).toBe(0);
    expect(result.owner).toBe('');
    expect(result.workStream).toBe('');
    expect(result.project).toBe('');
    expect(result.functionalArea).toBe('');
    expect(result.done).toBe(false);
    expect(result.description).toBe('');
    expect(result.isMilestone).toBe(false);
    expect(result.isSummary).toBe(false);
    expect(result.parentId).toBe(null);
    expect(result.childIds).toEqual([]);
    expect(result.dependencies).toEqual([]);
    expect(result.notes).toBe('');
    expect(result.okrs).toEqual([]);
    expect(result.constraintType).toBeUndefined();
    expect(result.constraintDate).toBeUndefined();
  });

  it('does NOT include isExpanded or isHidden on returned object', () => {
    const task = makeTask();
    const ymap = insertTask(task);
    const result = yMapToTask(ymap);
    expect('isExpanded' in result).toBe(false);
    expect('isHidden' in result).toBe(false);
  });
});

describe('taskToYMap', () => {
  it('writes exactly the 19 TASK_FIELDS', () => {
    const task = makeTask();
    const ymap = insertTask(task);

    // All 19 fields should be present
    for (const field of TASK_FIELDS) {
      expect(ymap.has(field)).toBe(true);
    }

    // Should have exactly 19 keys (constraintType + constraintDate are set since task has them)
    const keys = Array.from(ymap.keys());
    expect(keys.length).toBe(19);
  });

  it('does NOT write duration', () => {
    const task = makeTask();
    const ymap = insertTask(task);
    expect(ymap.has('duration')).toBe(false);
  });

  it('JSON.stringifies childIds, dependencies, okrs', () => {
    const task = makeTask({
      childIds: ['a', 'b'],
      dependencies: [{ fromId: 'x', toId: 'y', type: 'FS', lag: 1 }],
      okrs: ['O1', 'O2'],
    });
    const ymap = insertTask(task);
    expect(ymap.get('childIds')).toBe(JSON.stringify(['a', 'b']));
    expect(ymap.get('dependencies')).toBe(
      JSON.stringify([{ fromId: 'x', toId: 'y', type: 'FS', lag: 1 }])
    );
    expect(ymap.get('okrs')).toBe(JSON.stringify(['O1', 'O2']));
  });

  it('handles null/undefined optional fields', () => {
    const task = makeTask({ constraintType: undefined, constraintDate: undefined });
    const ymap = insertTask(task);
    // When undefined, constraintType/constraintDate are NOT set on the map
    expect(ymap.has('constraintType')).toBe(false);
    expect(ymap.has('constraintDate')).toBe(false);
  });
});

describe('initSchema', () => {
  it('creates tasks map, taskOrder array, meta map', () => {
    const doc = new Y.Doc();
    const { tasks, taskOrder, meta } = initSchema(doc);
    expect(tasks).toBeInstanceOf(Y.Map);
    expect(taskOrder).toBeInstanceOf(Y.Array);
    expect(meta).toBeInstanceOf(Y.Map);
  });

  it('sets schemaVersion: 1', () => {
    const doc = new Y.Doc();
    const { meta } = initSchema(doc);
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('returns correct references (same as doc.getMap/getArray)', () => {
    const doc = new Y.Doc();
    const { tasks, taskOrder, meta } = initSchema(doc);
    expect(tasks).toBe(doc.getMap('tasks'));
    expect(taskOrder).toBe(doc.getArray('taskOrder'));
    expect(meta).toBe(doc.getMap('meta'));
  });

  it('does not overwrite schemaVersion if already set', () => {
    const doc = new Y.Doc();
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 42);
    initSchema(doc);
    expect(meta.get('schemaVersion')).toBe(42);
  });
});
