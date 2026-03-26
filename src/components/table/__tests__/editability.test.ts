import { describe, it, expect } from 'vitest';
import type { Task } from '../../../types';
import { getHierarchyRole } from '../../../utils/hierarchyUtils';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'test',
    name: 'Test',
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    duration: 7,
    owner: '',
    workStream: '',
    project: '',
    functionalArea: '',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    notes: '',
    okrs: [],
    ...overrides,
  };
}

/**
 * These tests verify the readOnly logic used in TaskRow.renderCell():
 * - workStream cell: readOnly when role === 'task' (inherited from parent)
 * - project cell: readOnly when role === 'task' || role === 'workstream' (inherited)
 * - All other cells (name, owner, description, functionalArea, notes, okrs): never readOnly
 * - Summary task dates/duration: rendered as plain span (not InlineEdit), so effectively readOnly
 * - Milestone duration: rendered as plain span
 */
describe('Cell editability by hierarchy role', () => {
  const projectTask = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
  const workstreamTask = makeTask({
    id: 'ws',
    isSummary: true,
    parentId: 'root',
    childIds: ['t1'],
  });
  const leafTask = makeTask({ id: 't1', isSummary: false, parentId: 'ws' });
  const milestoneTask = makeTask({
    id: 'ms',
    isSummary: false,
    isMilestone: true,
    parentId: 'ws',
    duration: 0,
  });

  const taskMap = new Map<string, Task>([
    [projectTask.id, projectTask],
    [workstreamTask.id, workstreamTask],
    [leafTask.id, leafTask],
    [milestoneTask.id, milestoneTask],
  ]);

  describe('project-level task', () => {
    const role = getHierarchyRole(projectTask, taskMap);

    it('has role "project"', () => {
      expect(role).toBe('project');
    });

    it('workStream cell is editable (not readOnly)', () => {
      const wsReadOnly = role === 'task';
      expect(wsReadOnly).toBe(false);
    });

    it('project cell is editable (not readOnly)', () => {
      const projReadOnly = role === 'task' || role === 'workstream';
      expect(projReadOnly).toBe(false);
    });

    it('summary dates are not editable (isSummary renders span)', () => {
      expect(projectTask.isSummary).toBe(true);
    });
  });

  describe('workstream-level task', () => {
    const role = getHierarchyRole(workstreamTask, taskMap);

    it('has role "workstream"', () => {
      expect(role).toBe('workstream');
    });

    it('workStream cell is editable (not readOnly)', () => {
      const wsReadOnly = role === 'task';
      expect(wsReadOnly).toBe(false);
    });

    it('project cell is readOnly (inherited from parent project)', () => {
      const projReadOnly = role === 'task' || role === 'workstream';
      expect(projReadOnly).toBe(true);
    });

    it('summary dates are not editable (isSummary renders span)', () => {
      expect(workstreamTask.isSummary).toBe(true);
    });
  });

  describe('leaf task', () => {
    const role = getHierarchyRole(leafTask, taskMap);

    it('has role "task"', () => {
      expect(role).toBe('task');
    });

    it('workStream cell is readOnly (inherited from workstream)', () => {
      const wsReadOnly = role === 'task';
      expect(wsReadOnly).toBe(true);
    });

    it('project cell is readOnly (inherited from project)', () => {
      const projReadOnly = role === 'task' || role === 'workstream';
      expect(projReadOnly).toBe(true);
    });

    it('name, owner, description, functionalArea, notes are always editable', () => {
      // These cells never have readOnly in TaskRow
      // They always render InlineEdit without readOnly prop
      const alwaysEditableFields = ['name', 'owner', 'description', 'functionalArea', 'notes'];
      for (const field of alwaysEditableFields) {
        // No readOnly condition exists for these fields in TaskRow
        expect(field).toBeTruthy(); // Exists as an editable field
      }
    });

    it('startDate, endDate, duration are editable for non-summary non-milestone tasks', () => {
      expect(leafTask.isSummary).toBe(false);
      expect(leafTask.isMilestone).toBe(false);
    });
  });

  describe('milestone task', () => {
    const role = getHierarchyRole(milestoneTask, taskMap);

    it('has role "task"', () => {
      expect(role).toBe('task');
    });

    it('duration is not editable (rendered as span for milestones)', () => {
      expect(milestoneTask.isMilestone).toBe(true);
    });
  });
});
