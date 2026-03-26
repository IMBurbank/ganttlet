import { describe, it, expect } from 'vitest';
import { templates } from '../index';
import { taskDuration, taskEndDate } from '../../../utils/dateUtils';
import { parseISO, isWeekend } from 'date-fns';

describe('Template data validation', () => {
  // Test all non-blank templates
  const nonBlankTemplates = templates.filter((t) => t.id !== 'blank');

  it('blank template returns empty data', async () => {
    const blank = templates.find((t) => t.id === 'blank')!;
    expect(blank).toBeDefined();
    const data = await blank.load();
    expect(data.tasks).toEqual([]);
    expect(data.changeHistory).toEqual([]);
  });

  for (const template of nonBlankTemplates) {
    describe(template.name, () => {
      it('taskCount matches loaded tasks', async () => {
        const { tasks } = await template.load();
        expect(tasks.length).toBe(template.taskCount);
      });

      it('every task has id, name, startDate, endDate, duration', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          expect(task.id).toBeTruthy();
          expect(task.name).toBeTruthy();
          expect(task.startDate).toBeTruthy();
          expect(task.endDate).toBeTruthy();
          expect(typeof task.duration).toBe('number');
        }
      });

      it('all task ids are valid UUIDs or short ids', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          // softwareRelease uses short ids, new templates use UUIDs
          expect(task.id).toBeTruthy();
        }
      });

      it('no weekend dates', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          if (task.isMilestone && task.duration === 0) continue;
          const start = parseISO(task.startDate);
          const end = parseISO(task.endDate);
          expect(isWeekend(start), `${task.name} startDate ${task.startDate} is weekend`).toBe(
            false
          );
          expect(isWeekend(end), `${task.name} endDate ${task.endDate} is weekend`).toBe(false);
        }
      });

      it('duration === taskDuration(startDate, endDate) for leaf tasks', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          if (task.isMilestone && task.duration === 0) continue;
          // Summary tasks roll up child ranges — skip duration formula check
          if (task.isSummary) continue;
          const expected = taskDuration(task.startDate, task.endDate);
          expect(task.duration, `${task.name} duration mismatch`).toBe(expected);
        }
      });

      it('endDate === taskEndDate(startDate, duration) for leaf tasks', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          if (task.isMilestone && task.duration === 0) continue;
          if (task.isSummary) continue;
          const expected = taskEndDate(task.startDate, task.duration);
          expect(task.endDate, `${task.name} endDate mismatch`).toBe(expected);
        }
      });

      it('parentId <-> childIds bidirectionally consistent', async () => {
        const { tasks } = await template.load();
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        for (const task of tasks) {
          // If task has parentId, parent must list task in childIds
          if (task.parentId) {
            const parent = taskMap.get(task.parentId);
            expect(parent, `parent ${task.parentId} not found for ${task.name}`).toBeDefined();
            expect(parent!.childIds, `parent ${parent!.name} missing child ${task.name}`).toContain(
              task.id
            );
          }

          // If task has childIds, each child must reference this task as parentId
          for (const childId of task.childIds) {
            const child = taskMap.get(childId);
            expect(child, `child ${childId} not found in ${task.name}`).toBeDefined();
            expect(child!.parentId, `child ${child!.name} parentId mismatch`).toBe(task.id);
          }
        }
      });

      it('no UI state fields (isExpanded/isHidden removed from Task type)', async () => {
        const { tasks } = await template.load();
        for (const task of tasks) {
          // isExpanded and isHidden are per-user view state, not part of Task
          expect(task).not.toHaveProperty('isExpanded');
          expect(task).not.toHaveProperty('isHidden');
        }
      });
    });
  }
});
