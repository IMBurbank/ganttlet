import { describe, it, expect } from 'vitest';
import type { Task, Dependency } from '../../types';
import {
  taskToRow,
  rowToTask,
  tasksToRows,
  rowsToTasks,
  HEADER_ROW,
  SHEET_COLUMNS,
} from '../sheetsMapper';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    startDate: '2026-03-02', // Monday
    endDate: '2026-03-06', // Friday
    duration: 5, // Mon-Fri = 5 business days (inclusive convention)
    owner: 'Alice',
    workStream: 'Engineering',
    project: 'Alpha',
    functionalArea: 'Backend',
    done: false,
    description: 'A test task',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    isExpanded: true,
    isHidden: false,
    notes: 'Some notes',
    okrs: [],
    ...overrides,
  };
}

describe('sheetsMapper', () => {
  describe('taskToRow', () => {
    it('serializes all 20 columns', () => {
      const task = makeTask();
      const row = taskToRow(task);
      expect(row).toHaveLength(SHEET_COLUMNS.length);
      expect(row[0]).toBe('task-1');
      expect(row[1]).toBe('Test Task');
      expect(row[2]).toBe('2026-03-02');
      expect(row[3]).toBe('2026-03-06');
      // duration computed via taskDuration (inclusive: both endpoints counted)
      expect(row[4]).toBe('5');
      expect(row[5]).toBe('Alice');
      expect(row[6]).toBe('Engineering');
      expect(row[7]).toBe('Alpha');
      expect(row[8]).toBe('Backend');
      expect(row[9]).toBe('false');
      expect(row[10]).toBe('A test task');
      expect(row[11]).toBe('false');
      expect(row[12]).toBe('false');
      expect(row[13]).toBe(''); // parentId null → empty
      expect(row[14]).toBe(''); // childIds empty → empty
      expect(row[15]).toBe(''); // no dependencies
      expect(row[16]).toBe('Some notes');
      expect(row[17]).toBe(''); // no okrs
      expect(row[18]).toBe(''); // no constraintType
      expect(row[19]).toBe(''); // no constraintDate
    });

    it('serializes constraintType and constraintDate', () => {
      const row = taskToRow(makeTask({ constraintType: 'SNET', constraintDate: '2026-04-01' }));
      expect(row[18]).toBe('SNET');
      expect(row[19]).toBe('2026-04-01');
    });

    it('serializes ASAP constraint without date', () => {
      const row = taskToRow(makeTask({ constraintType: 'ASAP' }));
      expect(row[18]).toBe('ASAP');
      expect(row[19]).toBe('');
    });

    it('serializes childIds as comma-separated', () => {
      const row = taskToRow(makeTask({ childIds: ['c1', 'c2', 'c3'] }));
      expect(row[14]).toBe('c1,c2,c3');
    });

    it('serializes okrs as pipe-separated', () => {
      const row = taskToRow(makeTask({ okrs: ['OKR-1', 'OKR-2'] }));
      expect(row[17]).toBe('OKR-1|OKR-2');
    });

    it('serializes dependencies as fromId:type:lag separated by semicolons', () => {
      const deps: Dependency[] = [
        { fromId: 'a', toId: 'task-1', type: 'FS', lag: 0 },
        { fromId: 'b', toId: 'task-1', type: 'SS', lag: 2 },
        { fromId: 'c', toId: 'task-1', type: 'FF', lag: -1 },
      ];
      const row = taskToRow(makeTask({ dependencies: deps }));
      expect(row[15]).toBe('a:FS:0;b:SS:2;c:FF:-1');
    });

    it('serializes done=true', () => {
      const row = taskToRow(makeTask({ done: true }));
      expect(row[9]).toBe('true');
    });

    it('serializes milestone and summary flags', () => {
      const row = taskToRow(makeTask({ isMilestone: true, isSummary: true }));
      expect(row[11]).toBe('true');
      expect(row[12]).toBe('true');
    });
  });

  describe('rowToTask', () => {
    it('returns null for empty id', () => {
      expect(rowToTask(['', 'name'])).toBeNull();
    });

    it('deserializes a full row', () => {
      const row = [
        'task-1',
        'Test Task',
        '2026-03-02',
        '2026-03-06',
        '4',
        'Alice',
        'Engineering',
        'Alpha',
        'Backend',
        'false',
        'A test task',
        'false',
        'false',
        '',
        '',
        '',
        'Some notes',
        '',
        '',
        '',
      ];
      const task = rowToTask(row);
      expect(task).not.toBeNull();
      expect(task!.id).toBe('task-1');
      expect(task!.name).toBe('Test Task');
      expect(task!.startDate).toBe('2026-03-02');
      expect(task!.endDate).toBe('2026-03-06');
      // duration derived from dates via taskDuration (inclusive convention)
      expect(task!.duration).toBe(5);
      expect(task!.owner).toBe('Alice');
      expect(task!.done).toBe(false);
      expect(task!.parentId).toBeNull();
      expect(task!.childIds).toEqual([]);
      expect(task!.dependencies).toEqual([]);
      expect(task!.isExpanded).toBe(true);
      expect(task!.isHidden).toBe(false);
    });

    it('parses done=true', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[9] = 'true';
      expect(rowToTask(row)!.done).toBe(true);
    });

    it('parses childIds from comma-separated string', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[14] = 'c1,c2,c3';
      expect(rowToTask(row)!.childIds).toEqual(['c1', 'c2', 'c3']);
    });

    it('parses okrs from pipe-separated string', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[17] = 'OKR-1|OKR-2';
      expect(rowToTask(row)!.okrs).toEqual(['OKR-1', 'OKR-2']);
    });

    it('parses dependencies', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[15] = 'a:FS:0;b:SS:2';
      const task = rowToTask(row)!;
      expect(task.dependencies).toHaveLength(2);
      expect(task.dependencies[0]).toEqual({ fromId: 'a', toId: '', type: 'FS', lag: 0 });
      expect(task.dependencies[1]).toEqual({ fromId: 'b', toId: '', type: 'SS', lag: 2 });
    });

    it('falls back to duration column when dates are missing', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[4] = '5';
      // No start/end dates → falls back to parsed duration column
      expect(rowToTask(row)!.duration).toBe(5);
    });

    it('handles short rows gracefully', () => {
      const row = ['task-short', 'Name'];
      const task = rowToTask(row);
      expect(task).not.toBeNull();
      expect(task!.id).toBe('task-short');
      expect(task!.name).toBe('Name');
      expect(task!.owner).toBe('');
      expect(task!.childIds).toEqual([]);
    });

    it('defaults dependency type to FS when missing', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[15] = 'a::0';
      const task = rowToTask(row)!;
      expect(task.dependencies[0].type).toBe('FS');
    });

    it('parses constraintType and constraintDate', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[18] = 'SNET';
      row[19] = '2026-04-01';
      const task = rowToTask(row)!;
      expect(task.constraintType).toBe('SNET');
      expect(task.constraintDate).toBe('2026-04-01');
    });

    it('parses all 8 constraint types', () => {
      for (const ct of ['ASAP', 'SNET', 'ALAP', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']) {
        const row = Array(20).fill('');
        row[0] = 'x';
        row[18] = ct;
        row[19] = '2026-04-01';
        const task = rowToTask(row)!;
        expect(task.constraintType).toBe(ct);
      }
    });

    it('ignores date for ASAP and ALAP constraints', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[18] = 'ALAP';
      row[19] = '2026-04-01';
      const task = rowToTask(row)!;
      expect(task.constraintType).toBe('ALAP');
      expect(task.constraintDate).toBeUndefined();
    });

    it('ignores invalid constraint type', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[18] = 'INVALID';
      const task = rowToTask(row)!;
      expect(task.constraintType).toBeUndefined();
    });

    it('returns no constraint fields for empty columns', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      const task = rowToTask(row)!;
      expect(task.constraintType).toBeUndefined();
      expect(task.constraintDate).toBeUndefined();
    });

    it('ignores constraintDate without constraintType', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[19] = '2026-04-01';
      const task = rowToTask(row)!;
      expect(task.constraintType).toBeUndefined();
      expect(task.constraintDate).toBeUndefined();
    });
  });

  describe('rowToTask invalid input handling', () => {
    it('snaps weekend startDate to Monday', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[2] = '2026-03-07'; // Saturday
      row[3] = '2026-03-13'; // Friday
      const task = rowToTask(row)!;
      expect(task.startDate).toBe('2026-03-09'); // Monday
    });

    it('snaps weekend endDate to Friday', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[2] = '2026-03-02'; // Monday
      row[3] = '2026-03-08'; // Sunday
      const task = rowToTask(row)!;
      expect(task.endDate).toBe('2026-03-06'); // Friday
    });

    it('ensures duration >= 1', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[2] = '2026-03-02';
      row[3] = '2026-03-02';
      const task = rowToTask(row)!;
      expect(task.duration).toBeGreaterThanOrEqual(1);
    });

    it('corrects endDate before startDate', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[2] = '2026-03-06'; // Friday
      row[3] = '2026-03-02'; // Monday (before start)
      const task = rowToTask(row)!;
      expect(task.endDate).toBe(task.startDate);
    });

    it('snaps weekend constraintDate to Monday', () => {
      const row = Array(20).fill('');
      row[0] = 'x';
      row[2] = '2026-03-02';
      row[3] = '2026-03-06';
      row[18] = 'SNET';
      row[19] = '2026-03-07'; // Saturday
      const task = rowToTask(row)!;
      expect(task.constraintDate).toBe('2026-03-09'); // Monday
    });
  });

  describe('round-trip', () => {
    it('taskToRow → rowToTask preserves key fields', () => {
      const original = makeTask({
        parentId: 'parent-1',
        childIds: ['c1', 'c2'],
        dependencies: [{ fromId: 'dep-1', toId: 'task-1', type: 'SS', lag: 3 }],
        okrs: ['OKR-A', 'OKR-B'],
        done: true,
        isMilestone: true,
      });

      const row = taskToRow(original);
      const restored = rowToTask(row)!;

      expect(restored.id).toBe(original.id);
      expect(restored.name).toBe(original.name);
      expect(restored.startDate).toBe(original.startDate);
      expect(restored.endDate).toBe(original.endDate);
      expect(restored.duration).toBe(original.duration);
      expect(restored.owner).toBe(original.owner);
      expect(restored.workStream).toBe(original.workStream);
      expect(restored.project).toBe(original.project);
      expect(restored.functionalArea).toBe(original.functionalArea);
      expect(restored.done).toBe(original.done);
      expect(restored.description).toBe(original.description);
      expect(restored.isMilestone).toBe(original.isMilestone);
      expect(restored.isSummary).toBe(original.isSummary);
      expect(restored.parentId).toBe(original.parentId);
      expect(restored.childIds).toEqual(original.childIds);
      expect(restored.notes).toBe(original.notes);
      expect(restored.okrs).toEqual(original.okrs);
      // dependency toId is empty from rowToTask (filled by rowsToTasks)
      expect(restored.dependencies[0].fromId).toBe('dep-1');
      expect(restored.dependencies[0].type).toBe('SS');
      expect(restored.dependencies[0].lag).toBe(3);
    });

    it('round-trips constraintType and constraintDate', () => {
      const original = makeTask({
        constraintType: 'FNLT',
        constraintDate: '2026-05-15',
      });
      const row = taskToRow(original);
      const restored = rowToTask(row)!;
      expect(restored.constraintType).toBe('FNLT');
      expect(restored.constraintDate).toBe('2026-05-15');
    });

    it('round-trips ASAP constraint (no date)', () => {
      const original = makeTask({ constraintType: 'ASAP' });
      const row = taskToRow(original);
      const restored = rowToTask(row)!;
      expect(restored.constraintType).toBe('ASAP');
      expect(restored.constraintDate).toBeUndefined();
    });

    it('round-trips task without constraints', () => {
      const original = makeTask();
      const row = taskToRow(original);
      const restored = rowToTask(row)!;
      expect(restored.constraintType).toBeUndefined();
      expect(restored.constraintDate).toBeUndefined();
    });
  });

  describe('tasksToRows', () => {
    it('prepends header row', () => {
      const rows = tasksToRows([makeTask()]);
      expect(rows[0]).toEqual(HEADER_ROW);
      expect(rows).toHaveLength(2);
    });

    it('filters out summary tasks with no children', () => {
      const summary = makeTask({ id: 's1', isSummary: true, childIds: [] });
      const normal = makeTask({ id: 'n1' });
      const summaryWithKids = makeTask({ id: 's2', isSummary: true, childIds: ['n1'] });

      const rows = tasksToRows([summary, normal, summaryWithKids]);
      const ids = rows.slice(1).map((r) => r[0]);
      expect(ids).toContain('n1');
      expect(ids).toContain('s2');
      expect(ids).not.toContain('s1');
    });
  });

  describe('rowsToTasks', () => {
    it('skips header row', () => {
      const rows = [HEADER_ROW, taskToRow(makeTask({ id: 'a' })), taskToRow(makeTask({ id: 'b' }))];
      const tasks = rowsToTasks(rows);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('a');
      expect(tasks[1].id).toBe('b');
    });

    it('fixes dependency toId references', () => {
      const task = makeTask({
        id: 'target',
        dependencies: [{ fromId: 'source', toId: 'target', type: 'FS', lag: 0 }],
      });
      const rows = [HEADER_ROW, taskToRow(task)];
      const tasks = rowsToTasks(rows);
      expect(tasks[0].dependencies[0].toId).toBe('target');
    });

    it('returns empty for header-only input', () => {
      expect(rowsToTasks([HEADER_ROW])).toEqual([]);
    });

    it('returns empty for empty input', () => {
      expect(rowsToTasks([])).toEqual([]);
    });

    it('skips rows with empty id', () => {
      const rows = [
        HEADER_ROW,
        taskToRow(makeTask({ id: 'a' })),
        Array(20).fill(''), // empty row
        taskToRow(makeTask({ id: 'b' })),
      ];
      const tasks = rowsToTasks(rows);
      expect(tasks).toHaveLength(2);
    });
  });
});
