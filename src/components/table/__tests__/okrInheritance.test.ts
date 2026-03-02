import { describe, it, expect, beforeAll } from 'vitest';
import { ganttReducer } from '../../../state/ganttReducer';
import type { GanttState, Task } from '../../../types';
import { initScheduler } from '../../../utils/schedulerWasm';
import { fakeTasks } from '../../../data/fakeData';
import { findWorkstreamAncestor } from '../../../utils/hierarchyUtils';

beforeAll(async () => {
  await initScheduler();
});

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
    isExpanded: false,
    isHidden: false,
    notes: '',
    okrs: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<GanttState> = {}): GanttState {
  return {
    tasks: [],
    columns: [],
    colorBy: 'owner',
    zoomLevel: 'day',
    searchQuery: '',
    changeHistory: [],
    users: [],
    isHistoryPanelOpen: false,
    isSyncing: false,
    syncComplete: false,
    contextMenu: null,
    showOwnerOnBar: false,
    showAreaOnBar: false,
    showOkrsOnBar: false,
    showCriticalPath: false,
    dependencyEditor: null,
    theme: 'dark',
    collabUsers: [],
    isCollabConnected: false,
    undoStack: [],
    redoStack: [],
    lastCascadeIds: [],
    cascadeShifts: [],
    criticalPathScope: { type: 'project', name: '' },
    collapseWeekends: true,
    focusNewTaskId: null,
    isLeftPaneCollapsed: false,
    reparentPicker: null,
    ...overrides,
  };
}

describe('OKR seed data', () => {
  it('workstream summary tasks have OKRs populated', () => {
    const taskMap = new Map(fakeTasks.map(t => [t.id, t]));

    const pe = taskMap.get('pe')!;
    expect(pe.okrs).toEqual(["KR: API p99 latency < 200ms", "KR: Zero-downtime migration", "KR: 99.9% uptime SLA"]);

    const ux = taskMap.get('ux')!;
    expect(ux.okrs).toEqual(["KR: User satisfaction > 4.5/5", "KR: Ship design system v2", "KR: WCAG 2.1 AA compliance"]);

    const gtm = taskMap.get('gtm')!;
    expect(gtm.okrs).toEqual(["KR: 20% market share increase", "KR: 3x website conversion rate", "KR: 50 published content pieces"]);
  });

  it('leaf tasks can find their workstream ancestor OKRs', () => {
    const taskMap = new Map(fakeTasks.map(t => [t.id, t]));

    // PE leaf task should find PE workstream
    const pe1 = taskMap.get('pe-1')!;
    const peWorkstream = findWorkstreamAncestor(pe1, taskMap);
    expect(peWorkstream).toBeDefined();
    expect(peWorkstream!.id).toBe('pe');
    expect(peWorkstream!.okrs.length).toBeGreaterThan(0);

    // UX leaf task should find UX workstream
    const ux1 = taskMap.get('ux-1')!;
    const uxWorkstream = findWorkstreamAncestor(ux1, taskMap);
    expect(uxWorkstream).toBeDefined();
    expect(uxWorkstream!.id).toBe('ux');

    // GTM leaf task should find GTM workstream
    const gtm1 = taskMap.get('gtm-1')!;
    const gtmWorkstream = findWorkstreamAncestor(gtm1, taskMap);
    expect(gtmWorkstream).toBeDefined();
    expect(gtmWorkstream!.id).toBe('gtm');
  });
});

describe('OKR inheritance on new tasks', () => {
  it('new task under workstream inherits workstream OKRs', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'root', name: 'Project', isSummary: true, parentId: null, childIds: ['ws'] }),
        makeTask({
          id: 'ws', name: 'Workstream', isSummary: true, parentId: 'root',
          project: 'Project', childIds: ['ws-1'],
          okrs: ['KR: Target 1', 'KR: Target 2'],
        }),
        makeTask({ id: 'ws-1', parentId: 'ws', project: 'Project', workStream: 'Workstream' }),
      ],
    });

    const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'ws', afterTaskId: null });
    const newTask = result.tasks.find(t => t.id === 'ws-2');
    expect(newTask).toBeDefined();
    expect(newTask!.okrs).toEqual(['KR: Target 1', 'KR: Target 2']);
    expect(newTask!.workStream).toBe('Workstream');
    expect(newTask!.project).toBe('Project');
  });

  it('new task under project with no OKRs gets empty OKRs', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'root', name: 'Project', isSummary: true, parentId: null, childIds: [], okrs: [] }),
      ],
    });

    const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'root', afterTaskId: null });
    const newTask = result.tasks.find(t => t.parentId === 'root' && t.id !== 'root');
    expect(newTask).toBeDefined();
    expect(newTask!.okrs).toEqual([]);
  });
});
