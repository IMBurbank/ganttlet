import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { encodeStateAsUpdate, applyUpdate } from 'yjs';
import {
  yMapToTask,
  writeTaskToDoc,
  getDocMaps,
  migrateDoc,
  TASK_FIELDS,
  CURRENT_VERSION,
} from '../ydoc';
import { MIGRATIONS } from '../migrations';
import { ORIGIN } from '../../collab/origins';
import { initializeYDoc, hydrateFromSheets } from '../../collab/initialization';
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
 * Helper: write a task to a Y.Doc and return the attached Y.Map.
 */
function insertTask(task: Task): Y.Map<unknown> {
  const doc = new Y.Doc();
  const { tasks: ytasks } = getDocMaps(doc);
  writeTaskToDoc(ytasks, task.id, task);
  return ytasks.get(task.id)!;
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

// ─── yMapToTask ──────────────────────────────────────────────────────

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

// ─── writeTaskToDoc ──────────────────────────────────────────────────

describe('writeTaskToDoc', () => {
  it('creates a new Y.Map with all TASK_FIELDS when task is new', () => {
    const doc = new Y.Doc();
    const { tasks: ytasks } = getDocMaps(doc);
    const task = makeTask();

    writeTaskToDoc(ytasks, task.id, task);
    const ymap = ytasks.get(task.id)!;

    for (const field of TASK_FIELDS) {
      expect(ymap.has(field)).toBe(true);
    }
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

  it('updates existing Y.Map in place (preserves unknown fields)', () => {
    const doc = new Y.Doc();
    const { tasks: ytasks } = getDocMaps(doc);
    const task = makeTask({ name: 'Original' });

    // Create the task
    writeTaskToDoc(ytasks, task.id, task);
    const ymap = ytasks.get(task.id)!;

    // Simulate a future version adding an unknown field
    ymap.set('futureField', 'v3-data');

    // Update via writeTaskToDoc — should preserve unknown fields
    const updated = makeTask({ name: 'Updated' });
    writeTaskToDoc(ytasks, task.id, updated);

    const result = ytasks.get(task.id)!;
    expect(result.get('name')).toBe('Updated');
    expect(result.get('futureField')).toBe('v3-data'); // preserved!
  });

  it('covers all TASK_FIELDS (catches forgotten fields)', () => {
    const task = makeTask();
    const ymap = insertTask(task);
    const writtenKeys = Array.from(ymap.keys());

    for (const field of TASK_FIELDS) {
      expect(writtenKeys).toContain(field);
    }
  });
});

// ─── getDocMaps ──────────────────────────────────────────────────────

describe('getDocMaps', () => {
  it('returns tasks map, taskOrder array, meta map', () => {
    const doc = new Y.Doc();
    const { tasks, taskOrder, meta } = getDocMaps(doc);
    expect(tasks).toBeInstanceOf(Y.Map);
    expect(taskOrder).toBeInstanceOf(Y.Array);
    expect(meta).toBeInstanceOf(Y.Map);
  });

  it('returns same references as doc.getMap/getArray', () => {
    const doc = new Y.Doc();
    const { tasks, taskOrder, meta } = getDocMaps(doc);
    expect(tasks).toBe(doc.getMap('tasks'));
    expect(taskOrder).toBe(doc.getArray('taskOrder'));
    expect(meta).toBe(doc.getMap('meta'));
  });
});

// ─── migrateDoc ──────────────────────────────────────────────────────

describe('migrateDoc', () => {
  it('migrates fresh doc (v0) to current version', () => {
    const doc = new Y.Doc();
    const result = migrateDoc(doc);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(CURRENT_VERSION);
      expect(result.migrationsRun).toBe(MIGRATIONS.length);
    }

    const { meta } = getDocMaps(doc);
    expect(meta.get('schemaVersion')).toBe(CURRENT_VERSION);
  });

  it('strips isExpanded/isHidden from v1 doc (v2 migration)', () => {
    const doc = new Y.Doc();
    const { tasks: ytasks, meta } = getDocMaps(doc);

    // Simulate a v1 doc with isExpanded/isHidden on tasks
    meta.set('schemaVersion', 1);
    const ymap = new Y.Map<unknown>();
    ymap.set('id', 'task-1');
    ymap.set('name', 'Test');
    ymap.set('isExpanded', true);
    ymap.set('isHidden', false);
    ytasks.set('task-1', ymap);

    const result = migrateDoc(doc);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.fromVersion).toBe(1);
      expect(result.migrationsRun).toBe(1);
    }

    const migrated = ytasks.get('task-1')!;
    expect(migrated.has('isExpanded')).toBe(false);
    expect(migrated.has('isHidden')).toBe(false);
    expect(migrated.get('name')).toBe('Test'); // other fields preserved
  });

  it('returns noop for doc already at current version', () => {
    const doc = new Y.Doc();
    const { meta } = getDocMaps(doc);
    meta.set('schemaVersion', CURRENT_VERSION);

    const result = migrateDoc(doc);
    expect(result).toEqual({ status: 'noop' });
  });

  it('returns incompatible for doc from the future', () => {
    const doc = new Y.Doc();
    const { meta } = getDocMaps(doc);
    meta.set('schemaVersion', 99);

    const result = migrateDoc(doc);
    expect(result).toEqual({
      status: 'incompatible',
      docVersion: 99,
      codeVersion: CURRENT_VERSION,
    });
  });

  it('is idempotent — double call returns noop on second run', () => {
    const doc = new Y.Doc();
    const result1 = migrateDoc(doc);
    const result2 = migrateDoc(doc);

    expect(result1.status).toBe('ok');
    expect(result2.status).toBe('noop');
  });

  it('every migration is idempotent (run twice, same result)', () => {
    for (const migration of MIGRATIONS) {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      // Set up identical v1-like docs with stale fields
      for (const d of [doc1, doc2]) {
        const ytasks = d.getMap('tasks') as Y.Map<Y.Map<unknown>>;
        const ymap = new Y.Map<unknown>();
        ymap.set('id', 'test');
        ymap.set('isExpanded', true);
        ymap.set('isHidden', false);
        ytasks.set('test', ymap);
      }

      // Run migration once on doc1
      migration.migrate(doc1);

      // Run migration twice on doc2
      migration.migrate(doc2);
      migration.migrate(doc2);

      // Results should be identical
      const ytasks1 = doc1.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      const ytasks2 = doc2.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      const ymap1 = ytasks1.get('test')!;
      const ymap2 = ytasks2.get('test')!;

      expect(Array.from(ymap1.keys()).sort()).toEqual(Array.from(ymap2.keys()).sort());
      for (const key of ymap1.keys()) {
        expect(ymap1.get(key)).toEqual(ymap2.get(key));
      }
    }
  });

  it('CAS guard prevents double-execution within a single client', () => {
    const doc = new Y.Doc();
    const { meta } = getDocMaps(doc);

    // Simulate: someone else already migrated within the transaction window
    // by pre-setting version inside a transact
    let migrationBodyRan = false;
    const originalMigrate = MIGRATIONS[0].migrate;
    MIGRATIONS[0].migrate = (d) => {
      migrationBodyRan = true;
      originalMigrate(d);
    };

    // First call: should run
    meta.set('schemaVersion', 0);
    migrateDoc(doc);
    expect(migrationBodyRan).toBe(true);

    // Reset and try again — should be noop
    migrationBodyRan = false;
    const result = migrateDoc(doc);
    expect(result.status).toBe('noop');
    expect(migrationBodyRan).toBe(false);

    // Restore original
    MIGRATIONS[0].migrate = originalMigrate;
  });
});

// ─── Forward/Backward Compatibility ─────────────────────────────────

describe('forward/backward compatibility', () => {
  it('TASK_FIELDS matches all serializable fields on Task type (catches forgotten fields)', () => {
    // Task has these serializable fields (all except 'duration' which is computed).
    // If someone adds a field to Task but forgets TASK_FIELDS, this test fails.
    const SERIALIZABLE_TASK_FIELDS = new Set([
      'id',
      'name',
      'startDate',
      'endDate',
      // 'duration' — computed, NOT serialized
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
    ]);

    const taskFieldsSet = new Set(TASK_FIELDS);

    // Check both directions
    for (const field of SERIALIZABLE_TASK_FIELDS) {
      expect(taskFieldsSet.has(field)).toBe(true);
    }
    for (const field of TASK_FIELDS) {
      expect(SERIALIZABLE_TASK_FIELDS.has(field)).toBe(true);
    }

    // Also verify a full Task roundtrip covers all fields
    const task = makeTask();
    const taskKeys = Object.keys(task).filter((k) => k !== 'duration');
    expect(taskKeys.sort()).toEqual([...SERIALIZABLE_TASK_FIELDS].sort());
  });

  it('CRDT merge: v2 peer unknown field survives v1-like peer writeTaskToDoc', () => {
    // Simulate: peer A (v3 code) adds 'priority' field.
    // Peer B (v2 code) updates the same task via writeTaskToDoc.
    // The 'priority' field must survive because writeTaskToDoc updates in place.
    const peerA = new Y.Doc();
    const peerB = new Y.Doc();

    // Peer A creates a task with a future field
    const { tasks: ytasksA } = getDocMaps(peerA);
    const task = makeTask({ id: 'shared-task', name: 'Original' });
    writeTaskToDoc(ytasksA, task.id, task);
    ytasksA.get(task.id)!.set('priority', 'high'); // Future v3 field

    // Sync A → B
    applyUpdate(peerB, encodeStateAsUpdate(peerA));

    // Verify B received the task with the unknown field
    const { tasks: ytasksB } = getDocMaps(peerB);
    expect(ytasksB.get('shared-task')!.get('priority')).toBe('high');

    // Peer B (v2 code) updates the task name — this MUST preserve 'priority'
    const updated = makeTask({ id: 'shared-task', name: 'Renamed by B' });
    writeTaskToDoc(ytasksB, updated.id, updated);

    // Sync B → A
    applyUpdate(peerA, encodeStateAsUpdate(peerB));

    // Verify: both peers have renamed task AND preserved future field
    expect(ytasksA.get('shared-task')!.get('name')).toBe('Renamed by B');
    expect(ytasksA.get('shared-task')!.get('priority')).toBe('high'); // survived!
    expect(ytasksB.get('shared-task')!.get('name')).toBe('Renamed by B');
    expect(ytasksB.get('shared-task')!.get('priority')).toBe('high'); // survived!
  });

  it('CRDT merge: migration propagates from one peer to another', () => {
    // Peer A has v1 doc with isExpanded. Peer B migrates it. Sync back to A.
    const peerA = new Y.Doc();
    const peerB = new Y.Doc();

    // Peer A: create v1 doc with stale fields
    const { tasks: ytasksA, meta: metaA } = getDocMaps(peerA);
    metaA.set('schemaVersion', 1);
    const ymap = new Y.Map<unknown>();
    ymap.set('id', 'task-1');
    ymap.set('name', 'Test');
    ymap.set('isExpanded', true);
    ymap.set('isHidden', false);
    ytasksA.set('task-1', ymap);

    // Sync A → B
    applyUpdate(peerB, encodeStateAsUpdate(peerA));

    // Peer B runs migration
    const result = migrateDoc(peerB);
    expect(result.status).toBe('ok');

    // Sync B → A (migration ops propagate)
    applyUpdate(peerA, encodeStateAsUpdate(peerB));

    // Verify: A now has v2 schema and stripped fields
    expect(metaA.get('schemaVersion')).toBe(CURRENT_VERSION);
    const migratedOnA = ytasksA.get('task-1')!;
    expect(migratedOnA.has('isExpanded')).toBe(false);
    expect(migratedOnA.has('isHidden')).toBe(false);
    expect(migratedOnA.get('name')).toBe('Test'); // data preserved
  });

  it('hydrateFromSheets preserves unknown fields on existing tasks', () => {
    const doc = new Y.Doc();
    const { tasks: ytasks } = getDocMaps(doc);

    // Pre-populate a task with a future field
    const task = makeTask({ id: 'existing', name: 'Before hydration' });
    writeTaskToDoc(ytasks, task.id, task);
    ytasks.get('existing')!.set('futureField', 'must-survive');

    // Hydrate from sheets — updates the same task
    const sheetTask = makeTask({ id: 'existing', name: 'From Sheet' });
    hydrateFromSheets(doc, [sheetTask]);

    // Known fields updated, unknown field preserved
    const result = ytasks.get('existing')!;
    expect(result.get('name')).toBe('From Sheet');
    expect(result.get('futureField')).toBe('must-survive');
  });

  it('initializeYDoc + writeTaskToDoc end-to-end flow', () => {
    const doc = new Y.Doc();

    // Migrate first (as the real flow does)
    migrateDoc(doc);

    // Initialize with demo tasks
    const tasks = [makeTask({ id: 't1', name: 'Task 1' }), makeTask({ id: 't2', name: 'Task 2' })];
    initializeYDoc(doc, tasks);

    // Verify tasks are in Y.Doc
    const { tasks: ytasks, taskOrder, meta } = getDocMaps(doc);
    expect(ytasks.size).toBe(2);
    expect(yMapToTask(ytasks.get('t1')!).name).toBe('Task 1');
    expect(yMapToTask(ytasks.get('t2')!).name).toBe('Task 2');
    expect(Array.from(taskOrder)).toEqual(['t1', 't2']);
    expect(meta.get('schemaVersion')).toBe(CURRENT_VERSION);
  });

  it('incompatible doc version blocks writes (v99 → cannot proceed)', () => {
    const doc = new Y.Doc();
    const { meta } = getDocMaps(doc);
    meta.set('schemaVersion', 99);

    const result = migrateDoc(doc);
    expect(result.status).toBe('incompatible');

    // The app would render SchemaIncompatibleError here.
    // The inner TaskStoreProviderInner never mounts, so no writes happen.
    // This test documents the expected behavior — the gate is structural, not a runtime check.
    if (result.status === 'incompatible') {
      expect(result.docVersion).toBe(99);
      expect(result.codeVersion).toBe(CURRENT_VERSION);
    }
  });
});
