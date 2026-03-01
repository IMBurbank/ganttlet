import { startOfDay } from 'date-fns';
import { addWorkingDays } from '../engine/date-utils';
import type {
  Task,
  Dependency,
  Resource,
  Project,
  Workstream,
  ChangeRecord,
  CollaborationUser,
} from '../types';

export function generateSeedData(): {
  tasks: Task[];
  dependencies: Dependency[];
  resources: Resource[];
  projects: Project[];
  workstreams: Workstream[];
  changeRecords: ChangeRecord[];
  collaborationUsers: CollaborationUser[];
} {
  const today = startOfDay(new Date());

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  const projects: Project[] = [
    { id: 'proj-1', name: 'Platform Redesign', color: '#6366f1' },
    { id: 'proj-2', name: 'Mobile App v2', color: '#3b82f6' },
  ];

  // ---------------------------------------------------------------------------
  // Workstreams
  // ---------------------------------------------------------------------------
  const workstreams: Workstream[] = [
    { id: 'ws-1', name: 'Frontend', color: '#6366f1', projectId: 'proj-1' },
    { id: 'ws-2', name: 'Backend API', color: '#06b6d4', projectId: 'proj-1' },
    { id: 'ws-3', name: 'Infrastructure', color: '#22c55e', projectId: 'proj-1' },
    { id: 'ws-4', name: 'iOS Development', color: '#f97316', projectId: 'proj-2' },
    { id: 'ws-5', name: 'Android Development', color: '#a855f7', projectId: 'proj-2' },
  ];

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------
  const resources: Resource[] = [
    { id: 'res-1', name: 'Sarah Chen', initials: 'SC', role: 'engineer', avatarColor: '#6366f1' },
    { id: 'res-2', name: 'Marcus Johnson', initials: 'MJ', role: 'engineer', avatarColor: '#3b82f6' },
    { id: 'res-3', name: 'Emily Park', initials: 'EP', role: 'designer', avatarColor: '#ec4899' },
    { id: 'res-4', name: 'David Kim', initials: 'DK', role: 'pm', avatarColor: '#f97316' },
    { id: 'res-5', name: 'Lisa Wang', initials: 'LW', role: 'ux', avatarColor: '#a855f7' },
    { id: 'res-6', name: 'James Smith', initials: 'JS', role: 'engineer', avatarColor: '#22c55e' },
    { id: 'res-7', name: 'Anna Lee', initials: 'AL', role: 'qa', avatarColor: '#ef4444' },
    { id: 'res-8', name: 'Tom Brown', initials: 'TB', role: 'devops', avatarColor: '#eab308' },
  ];

  // ---------------------------------------------------------------------------
  // Helper: create a leaf task
  // ---------------------------------------------------------------------------
  function makeTask(
    id: string,
    name: string,
    type: Task['type'],
    durationDays: number,
    startOffset: number, // working-day offset from `today`
    workstreamId: string,
    projectId: string,
    parentId: string | null,
    level: number,
    wbsCode: string,
    percentComplete: number,
    assignedResourceIds: string[],
    sortOrder: number,
  ): Task {
    const startDate = addWorkingDays(today, startOffset);
    const endDate = durationDays === 0 ? startDate : addWorkingDays(startDate, durationDays);
    return {
      id,
      name,
      type,
      startDate,
      endDate,
      duration: durationDays,
      percentComplete,
      parentId,
      wbsCode,
      level,
      isCollapsed: false,
      workstreamId,
      projectId,
      assignedResourceIds,
      earlyStart: null,
      earlyFinish: null,
      lateStart: null,
      lateFinish: null,
      totalFloat: null,
      freeFloat: null,
      isCritical: false,
      notes: '',
      sortOrder,
    };
  }

  // ---------------------------------------------------------------------------
  // Leaf & milestone tasks (built first so summary ranges can be computed)
  // ---------------------------------------------------------------------------
  const leafTasks: Task[] = [];
  let order = 0;

  // -- Project 1: Platform Redesign ------------------------------------------

  // 1.1 Frontend leaf tasks
  leafTasks.push(makeTask('task-1-1-1', 'Design System Setup', 'task', 5, -20, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.1', 45, ['res-3', 'res-1'], order++));
  leafTasks.push(makeTask('task-1-1-2', 'Component Library', 'task', 8, -13, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.2', 70, ['res-1'], order++));
  leafTasks.push(makeTask('task-1-1-3', 'Dashboard Layout', 'task', 6, -3, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.3', 15, ['res-1', 'res-2'], order++));
  leafTasks.push(makeTask('task-1-1-4', 'Data Visualization', 'task', 7, 3, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.4', 0, ['res-2'], order++));
  leafTasks.push(makeTask('task-1-1-5', 'User Settings Page', 'task', 4, 8, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.5', 0, ['res-1'], order++));
  leafTasks.push(makeTask('task-1-1-6', 'Search & Filters', 'task', 5, 5, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.6', 0, ['res-2'], order++));
  leafTasks.push(makeTask('task-1-1-7', 'Frontend Integration Testing', 'task', 3, 14, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.7', 0, ['res-7'], order++));
  leafTasks.push(makeTask('task-1-1-8', 'Frontend Complete', 'milestone', 0, 17, 'ws-1', 'proj-1', 'ws1-summary', 2, '1.1.8', 0, [], order++));

  // 1.2 Backend API leaf tasks
  leafTasks.push(makeTask('task-1-2-1', 'API Architecture Design', 'task', 3, -22, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.1', 100, ['res-4', 'res-6'], order++));
  leafTasks.push(makeTask('task-1-2-2', 'Auth Service', 'task', 6, -18, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.2', 90, ['res-6'], order++));
  leafTasks.push(makeTask('task-1-2-3', 'User Management API', 'task', 5, -10, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.3', 60, ['res-6'], order++));
  leafTasks.push(makeTask('task-1-2-4', 'Data Pipeline', 'task', 8, -5, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.4', 25, ['res-2', 'res-6'], order++));
  leafTasks.push(makeTask('task-1-2-5', 'Notification Service', 'task', 4, 5, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.5', 0, ['res-6'], order++));
  leafTasks.push(makeTask('task-1-2-6', 'API Documentation', 'task', 3, 9, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.6', 0, ['res-6'], order++));
  leafTasks.push(makeTask('task-1-2-7', 'Backend Complete', 'milestone', 0, 12, 'ws-2', 'proj-1', 'ws2-summary', 2, '1.2.7', 0, [], order++));

  // 1.3 Infrastructure leaf tasks
  leafTasks.push(makeTask('task-1-3-1', 'CI/CD Pipeline', 'task', 4, -25, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.1', 100, ['res-8'], order++));
  leafTasks.push(makeTask('task-1-3-2', 'Staging Environment', 'task', 3, -20, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.2', 100, ['res-8'], order++));
  leafTasks.push(makeTask('task-1-3-3', 'Monitoring Setup', 'task', 5, -8, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.3', 50, ['res-8'], order++));
  leafTasks.push(makeTask('task-1-3-4', 'Load Testing', 'task', 3, 5, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.4', 0, ['res-8', 'res-7'], order++));
  leafTasks.push(makeTask('task-1-3-5', 'Security Audit', 'task', 4, 8, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.5', 0, ['res-7'], order++));
  leafTasks.push(makeTask('task-1-3-6', 'Production Deploy', 'milestone', 0, 20, 'ws-3', 'proj-1', 'ws3-summary', 2, '1.3.6', 0, [], order++));

  // -- Project 2: Mobile App v2 ----------------------------------------------

  // 2.1 iOS Development leaf tasks
  leafTasks.push(makeTask('task-2-1-1', 'iOS UI Kit', 'task', 6, -15, 'ws-4', 'proj-2', 'ws4-summary', 2, '2.1.1', 80, ['res-3', 'res-5'], order++));
  leafTasks.push(makeTask('task-2-1-2', 'Core Navigation', 'task', 4, -7, 'ws-4', 'proj-2', 'ws4-summary', 2, '2.1.2', 40, ['res-1'], order++));
  leafTasks.push(makeTask('task-2-1-3', 'Offline Sync', 'task', 7, -1, 'ws-4', 'proj-2', 'ws4-summary', 2, '2.1.3', 5, ['res-1'], order++));
  leafTasks.push(makeTask('task-2-1-4', 'Push Notifications', 'task', 3, 6, 'ws-4', 'proj-2', 'ws4-summary', 2, '2.1.4', 0, ['res-1'], order++));
  leafTasks.push(makeTask('task-2-1-5', 'iOS Beta Release', 'milestone', 0, 12, 'ws-4', 'proj-2', 'ws4-summary', 2, '2.1.5', 0, [], order++));

  // 2.2 Android Development leaf tasks
  leafTasks.push(makeTask('task-2-2-1', 'Android UI Kit', 'task', 6, -12, 'ws-5', 'proj-2', 'ws5-summary', 2, '2.2.1', 65, ['res-3'], order++));
  leafTasks.push(makeTask('task-2-2-2', 'Core Navigation', 'task', 4, -4, 'ws-5', 'proj-2', 'ws5-summary', 2, '2.2.2', 20, ['res-2'], order++));
  leafTasks.push(makeTask('task-2-2-3', 'Offline Sync', 'task', 7, 2, 'ws-5', 'proj-2', 'ws5-summary', 2, '2.2.3', 0, ['res-2'], order++));
  leafTasks.push(makeTask('task-2-2-4', 'Push Notifications', 'task', 3, 9, 'ws-5', 'proj-2', 'ws5-summary', 2, '2.2.4', 0, ['res-2'], order++));
  leafTasks.push(makeTask('task-2-2-5', 'Android Beta Release', 'milestone', 0, 14, 'ws-5', 'proj-2', 'ws5-summary', 2, '2.2.5', 0, [], order++));

  // ---------------------------------------------------------------------------
  // Summary tasks — derive date ranges from children
  // ---------------------------------------------------------------------------
  function summaryRange(childIds: string[]): { startDate: Date; endDate: Date; duration: number } {
    const children = leafTasks.filter((t) => childIds.includes(t.id));
    const start = new Date(Math.min(...children.map((c) => c.startDate.getTime())));
    const end = new Date(Math.max(...children.map((c) => c.endDate.getTime())));
    // Duration for summaries is the total calendar span expressed as a count;
    // we store it as the max child-end minus min child-start in working days (approximate).
    let wd = 0;
    let cur = new Date(start);
    while (cur < end) {
      cur = new Date(cur.getTime() + 86400000);
      const day = cur.getDay();
      if (day !== 0 && day !== 6) wd++;
    }
    return { startDate: start, endDate: end, duration: wd };
  }

  // WBS 1.1 Frontend summary children
  const ws1ChildIds = ['task-1-1-1', 'task-1-1-2', 'task-1-1-3', 'task-1-1-4', 'task-1-1-5', 'task-1-1-6', 'task-1-1-7', 'task-1-1-8'];
  const ws1Range = summaryRange(ws1ChildIds);

  // WBS 1.2 Backend API summary children
  const ws2ChildIds = ['task-1-2-1', 'task-1-2-2', 'task-1-2-3', 'task-1-2-4', 'task-1-2-5', 'task-1-2-6', 'task-1-2-7'];
  const ws2Range = summaryRange(ws2ChildIds);

  // WBS 1.3 Infrastructure summary children
  const ws3ChildIds = ['task-1-3-1', 'task-1-3-2', 'task-1-3-3', 'task-1-3-4', 'task-1-3-5', 'task-1-3-6'];
  const ws3Range = summaryRange(ws3ChildIds);

  // WBS 2.1 iOS Development summary children
  const ws4ChildIds = ['task-2-1-1', 'task-2-1-2', 'task-2-1-3', 'task-2-1-4', 'task-2-1-5'];
  const ws4Range = summaryRange(ws4ChildIds);

  // WBS 2.2 Android Development summary children
  const ws5ChildIds = ['task-2-2-1', 'task-2-2-2', 'task-2-2-3', 'task-2-2-4', 'task-2-2-5'];
  const ws5Range = summaryRange(ws5ChildIds);

  // Project-level summaries span all their workstream children
  const proj1Range = {
    startDate: new Date(Math.min(ws1Range.startDate.getTime(), ws2Range.startDate.getTime(), ws3Range.startDate.getTime())),
    endDate: new Date(Math.max(ws1Range.endDate.getTime(), ws2Range.endDate.getTime(), ws3Range.endDate.getTime())),
  };
  const proj2Range = {
    startDate: new Date(Math.min(ws4Range.startDate.getTime(), ws5Range.startDate.getTime())),
    endDate: new Date(Math.max(ws4Range.endDate.getTime(), ws5Range.endDate.getTime())),
  };

  function makeSummary(
    id: string,
    name: string,
    range: { startDate: Date; endDate: Date; duration?: number },
    workstreamId: string,
    projectId: string,
    parentId: string | null,
    level: number,
    wbsCode: string,
    sortOrder: number,
  ): Task {
    return {
      id,
      name,
      type: 'summary',
      startDate: range.startDate,
      endDate: range.endDate,
      duration: range.duration ?? 0,
      percentComplete: 0,
      parentId,
      wbsCode,
      level,
      isCollapsed: false,
      workstreamId,
      projectId,
      assignedResourceIds: [],
      earlyStart: null,
      earlyFinish: null,
      lateStart: null,
      lateFinish: null,
      totalFloat: null,
      freeFloat: null,
      isCritical: false,
      notes: '',
      sortOrder,
    };
  }

  // Build summary tasks. We'll re-number sortOrder after assembly.
  const summaryTasks: Task[] = [
    // Project 1 top-level summary
    makeSummary('p1', 'Platform Redesign', proj1Range, 'ws-1', 'proj-1', null, 0, '1', 0),
    // Workstream summaries under Project 1
    makeSummary('ws1-summary', 'Frontend', ws1Range, 'ws-1', 'proj-1', 'p1', 1, '1.1', 0),
    makeSummary('ws2-summary', 'Backend API', ws2Range, 'ws-2', 'proj-1', 'p1', 1, '1.2', 0),
    makeSummary('ws3-summary', 'Infrastructure', ws3Range, 'ws-3', 'proj-1', 'p1', 1, '1.3', 0),
    // Project 2 top-level summary
    makeSummary('p2', 'Mobile App v2', proj2Range, 'ws-4', 'proj-2', null, 0, '2', 0),
    // Workstream summaries under Project 2
    makeSummary('ws4-summary', 'iOS Development', ws4Range, 'ws-4', 'proj-2', 'p2', 1, '2.1', 0),
    makeSummary('ws5-summary', 'Android Development', ws5Range, 'ws-5', 'proj-2', 'p2', 1, '2.2', 0),
  ];

  // ---------------------------------------------------------------------------
  // Assemble tasks in WBS display order and assign sequential sortOrder
  // ---------------------------------------------------------------------------
  const tasks: Task[] = [
    // Project 1
    summaryTasks.find((t) => t.id === 'p1')!,
    summaryTasks.find((t) => t.id === 'ws1-summary')!,
    ...leafTasks.filter((t) => ws1ChildIds.includes(t.id)),
    summaryTasks.find((t) => t.id === 'ws2-summary')!,
    ...leafTasks.filter((t) => ws2ChildIds.includes(t.id)),
    summaryTasks.find((t) => t.id === 'ws3-summary')!,
    ...leafTasks.filter((t) => ws3ChildIds.includes(t.id)),
    // Project 2
    summaryTasks.find((t) => t.id === 'p2')!,
    summaryTasks.find((t) => t.id === 'ws4-summary')!,
    ...leafTasks.filter((t) => ws4ChildIds.includes(t.id)),
    summaryTasks.find((t) => t.id === 'ws5-summary')!,
    ...leafTasks.filter((t) => ws5ChildIds.includes(t.id)),
  ];

  tasks.forEach((t, i) => {
    t.sortOrder = i;
  });

  // ---------------------------------------------------------------------------
  // Dependencies
  // ---------------------------------------------------------------------------
  const dependencies: Dependency[] = [
    // 1.1 Frontend chain
    { id: 'dep-1', predecessorId: 'task-1-1-1', successorId: 'task-1-1-2', type: 'FS', lagDays: 0 },
    { id: 'dep-2', predecessorId: 'task-1-1-2', successorId: 'task-1-1-3', type: 'FS', lagDays: 0 },
    { id: 'dep-3', predecessorId: 'task-1-1-3', successorId: 'task-1-1-4', type: 'FS', lagDays: 0 },
    { id: 'dep-4', predecessorId: 'task-1-1-4', successorId: 'task-1-1-5', type: 'SS', lagDays: 2 },
    { id: 'dep-5', predecessorId: 'task-1-1-3', successorId: 'task-1-1-6', type: 'SS', lagDays: 0 },
    { id: 'dep-6', predecessorId: 'task-1-1-5', successorId: 'task-1-1-7', type: 'FS', lagDays: 0 },
    { id: 'dep-7', predecessorId: 'task-1-1-6', successorId: 'task-1-1-7', type: 'FS', lagDays: 0 },
    { id: 'dep-8', predecessorId: 'task-1-1-7', successorId: 'task-1-1-8', type: 'FS', lagDays: 0 },

    // 1.2 Backend API chain
    { id: 'dep-9', predecessorId: 'task-1-2-1', successorId: 'task-1-2-2', type: 'FS', lagDays: 0 },
    { id: 'dep-10', predecessorId: 'task-1-2-2', successorId: 'task-1-2-3', type: 'FS', lagDays: 0 },
    { id: 'dep-11', predecessorId: 'task-1-2-3', successorId: 'task-1-2-4', type: 'SS', lagDays: 2 },
    { id: 'dep-12', predecessorId: 'task-1-2-4', successorId: 'task-1-2-5', type: 'FS', lagDays: 0 },
    { id: 'dep-13', predecessorId: 'task-1-2-5', successorId: 'task-1-2-6', type: 'FS', lagDays: 0 },
    { id: 'dep-14', predecessorId: 'task-1-2-6', successorId: 'task-1-2-7', type: 'FS', lagDays: 0 },

    // 1.3 Infrastructure chain
    { id: 'dep-15', predecessorId: 'task-1-3-1', successorId: 'task-1-3-2', type: 'FS', lagDays: 0 },
    { id: 'dep-16', predecessorId: 'task-1-3-2', successorId: 'task-1-3-3', type: 'FS', lagDays: 1 },
    { id: 'dep-17', predecessorId: 'task-1-3-3', successorId: 'task-1-3-4', type: 'FS', lagDays: 0 },
    { id: 'dep-18', predecessorId: 'task-1-3-4', successorId: 'task-1-3-5', type: 'FS', lagDays: 0 },

    // Cross-workstream: Production Deploy depends on Frontend Complete, Backend Complete, and Security Audit
    { id: 'dep-19', predecessorId: 'task-1-1-8', successorId: 'task-1-3-6', type: 'FS', lagDays: 0 },
    { id: 'dep-20', predecessorId: 'task-1-2-7', successorId: 'task-1-3-6', type: 'FS', lagDays: 0 },
    { id: 'dep-21', predecessorId: 'task-1-3-5', successorId: 'task-1-3-6', type: 'FS', lagDays: 0 },

    // 2.1 iOS chain
    { id: 'dep-22', predecessorId: 'task-2-1-1', successorId: 'task-2-1-2', type: 'FS', lagDays: 0 },
    { id: 'dep-23', predecessorId: 'task-2-1-2', successorId: 'task-2-1-3', type: 'FS', lagDays: 0 },
    { id: 'dep-24', predecessorId: 'task-2-1-3', successorId: 'task-2-1-4', type: 'FF', lagDays: 0 },
    { id: 'dep-25', predecessorId: 'task-2-1-4', successorId: 'task-2-1-5', type: 'FS', lagDays: 0 },

    // 2.2 Android chain
    { id: 'dep-26', predecessorId: 'task-2-2-1', successorId: 'task-2-2-2', type: 'FS', lagDays: 0 },
    { id: 'dep-27', predecessorId: 'task-2-2-2', successorId: 'task-2-2-3', type: 'FS', lagDays: 0 },
    { id: 'dep-28', predecessorId: 'task-2-2-3', successorId: 'task-2-2-4', type: 'SF', lagDays: 0 },
    { id: 'dep-29', predecessorId: 'task-2-2-4', successorId: 'task-2-2-5', type: 'FS', lagDays: 0 },
  ];

  // ---------------------------------------------------------------------------
  // Change Records — spread over the past 7 days
  // ---------------------------------------------------------------------------
  function daysAgo(d: number, hours: number = 10, minutes: number = 0): Date {
    const date = addWorkingDays(today, -d);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  const changeRecords: ChangeRecord[] = [
    {
      id: 'change-1',
      timestamp: daysAgo(7, 9, 15),
      userId: 'res-4',
      changeType: 'create',
      taskId: 'task-1-2-1',
      field: null,
      oldValue: null,
      newValue: null,
      description: 'Created API Architecture Design task',
    },
    {
      id: 'change-2',
      timestamp: daysAgo(7, 10, 30),
      userId: 'res-8',
      changeType: 'create',
      taskId: 'task-1-3-1',
      field: null,
      oldValue: null,
      newValue: null,
      description: 'Created CI/CD Pipeline task',
    },
    {
      id: 'change-3',
      timestamp: daysAgo(6, 11, 0),
      userId: 'res-3',
      changeType: 'create',
      taskId: 'task-2-1-1',
      field: null,
      oldValue: null,
      newValue: null,
      description: 'Created iOS UI Kit task',
    },
    {
      id: 'change-4',
      timestamp: daysAgo(6, 14, 20),
      userId: 'res-6',
      changeType: 'update',
      taskId: 'task-1-2-2',
      field: 'percentComplete',
      oldValue: '50',
      newValue: '90',
      description: 'Updated progress on Auth Service to 90%',
    },
    {
      id: 'change-5',
      timestamp: daysAgo(5, 9, 45),
      userId: 'res-1',
      changeType: 'update',
      taskId: 'task-1-1-1',
      field: 'percentComplete',
      oldValue: '20',
      newValue: '45',
      description: 'Updated progress on Design System Setup to 45%',
    },
    {
      id: 'change-6',
      timestamp: daysAgo(5, 13, 10),
      userId: 'res-4',
      changeType: 'link',
      taskId: 'task-1-2-4',
      field: null,
      oldValue: null,
      newValue: 'task-1-2-5',
      description: 'Linked Data Pipeline to Notification Service',
    },
    {
      id: 'change-7',
      timestamp: daysAgo(5, 15, 0),
      userId: 'res-8',
      changeType: 'update',
      taskId: 'task-1-3-2',
      field: 'percentComplete',
      oldValue: '75',
      newValue: '100',
      description: 'Marked Staging Environment as complete',
    },
    {
      id: 'change-8',
      timestamp: daysAgo(4, 10, 0),
      userId: 'res-2',
      changeType: 'update',
      taskId: 'task-1-1-3',
      field: 'startDate',
      oldValue: null,
      newValue: null,
      description: 'Updated start date for Dashboard Layout',
    },
    {
      id: 'change-9',
      timestamp: daysAgo(4, 11, 30),
      userId: 'res-1',
      changeType: 'update',
      taskId: 'task-1-1-2',
      field: 'percentComplete',
      oldValue: '40',
      newValue: '70',
      description: 'Updated progress on Component Library to 70%',
    },
    {
      id: 'change-10',
      timestamp: daysAgo(4, 14, 0),
      userId: 'res-6',
      changeType: 'update',
      taskId: 'task-1-2-3',
      field: 'percentComplete',
      oldValue: '30',
      newValue: '60',
      description: 'Updated progress on User Management API to 60%',
    },
    {
      id: 'change-11',
      timestamp: daysAgo(3, 9, 0),
      userId: 'res-3',
      changeType: 'update',
      taskId: 'task-2-1-1',
      field: 'percentComplete',
      oldValue: '50',
      newValue: '80',
      description: 'Updated progress on iOS UI Kit to 80%',
    },
    {
      id: 'change-12',
      timestamp: daysAgo(3, 11, 15),
      userId: 'res-4',
      changeType: 'link',
      taskId: 'task-1-1-8',
      field: null,
      oldValue: null,
      newValue: 'task-1-3-6',
      description: 'Linked Frontend Complete milestone to Production Deploy',
    },
    {
      id: 'change-13',
      timestamp: daysAgo(3, 14, 45),
      userId: 'res-8',
      changeType: 'update',
      taskId: 'task-1-3-3',
      field: 'percentComplete',
      oldValue: '20',
      newValue: '50',
      description: 'Updated progress on Monitoring Setup to 50%',
    },
    {
      id: 'change-14',
      timestamp: daysAgo(2, 10, 30),
      userId: 'res-2',
      changeType: 'move',
      taskId: 'task-1-1-4',
      field: 'startDate',
      oldValue: null,
      newValue: null,
      description: 'Rescheduled Data Visualization to start later',
    },
    {
      id: 'change-15',
      timestamp: daysAgo(2, 11, 0),
      userId: 'res-1',
      changeType: 'update',
      taskId: 'task-2-1-2',
      field: 'percentComplete',
      oldValue: '10',
      newValue: '40',
      description: 'Updated progress on Core Navigation (iOS) to 40%',
    },
    {
      id: 'change-16',
      timestamp: daysAgo(2, 15, 20),
      userId: 'res-3',
      changeType: 'update',
      taskId: 'task-2-2-1',
      field: 'percentComplete',
      oldValue: '35',
      newValue: '65',
      description: 'Updated progress on Android UI Kit to 65%',
    },
    {
      id: 'change-17',
      timestamp: daysAgo(1, 9, 30),
      userId: 'res-6',
      changeType: 'update',
      taskId: 'task-1-2-4',
      field: 'percentComplete',
      oldValue: '10',
      newValue: '25',
      description: 'Updated progress on Data Pipeline to 25%',
    },
    {
      id: 'change-18',
      timestamp: daysAgo(1, 10, 45),
      userId: 'res-4',
      changeType: 'link',
      taskId: 'task-1-2-7',
      field: null,
      oldValue: null,
      newValue: 'task-1-3-6',
      description: 'Linked Backend Complete milestone to Production Deploy',
    },
    {
      id: 'change-19',
      timestamp: daysAgo(1, 13, 0),
      userId: 'res-2',
      changeType: 'update',
      taskId: 'task-2-2-2',
      field: 'percentComplete',
      oldValue: '0',
      newValue: '20',
      description: 'Updated progress on Core Navigation (Android) to 20%',
    },
    {
      id: 'change-20',
      timestamp: daysAgo(1, 16, 0),
      userId: 'res-1',
      changeType: 'update',
      taskId: 'task-2-1-3',
      field: 'percentComplete',
      oldValue: '0',
      newValue: '5',
      description: 'Started Offline Sync (iOS) — 5% complete',
    },
    {
      id: 'change-21',
      timestamp: daysAgo(0, 8, 30),
      userId: 'res-8',
      changeType: 'create',
      taskId: 'task-1-3-4',
      field: null,
      oldValue: null,
      newValue: null,
      description: 'Created Load Testing task',
    },
    {
      id: 'change-22',
      timestamp: daysAgo(0, 9, 15),
      userId: 'res-7',
      changeType: 'create',
      taskId: 'task-1-3-5',
      field: null,
      oldValue: null,
      newValue: null,
      description: 'Created Security Audit task',
    },
    {
      id: 'change-23',
      timestamp: daysAgo(0, 10, 0),
      userId: 'res-4',
      changeType: 'update',
      taskId: 'task-1-1-3',
      field: 'percentComplete',
      oldValue: '5',
      newValue: '15',
      description: 'Updated progress on Dashboard Layout to 15%',
    },
  ];

  // ---------------------------------------------------------------------------
  // Collaboration Users
  // ---------------------------------------------------------------------------
  const collaborationUsers: CollaborationUser[] = [
    {
      id: 'collab-1',
      name: 'You',
      avatarColor: '#6366f1',
      initials: 'YO',
      isYou: true,
      cursorX: 500,
      cursorY: 300,
      selectedTaskId: null,
      isOnline: true,
      lastSeen: new Date(),
    },
    {
      id: 'collab-2',
      name: 'Sarah Chen',
      avatarColor: '#3b82f6',
      initials: 'SC',
      isYou: false,
      cursorX: 700,
      cursorY: 200,
      selectedTaskId: null,
      isOnline: true,
      lastSeen: new Date(),
    },
    {
      id: 'collab-3',
      name: 'David Kim',
      avatarColor: '#f97316',
      initials: 'DK',
      isYou: false,
      cursorX: 300,
      cursorY: 400,
      selectedTaskId: null,
      isOnline: true,
      lastSeen: new Date(),
    },
  ];

  return {
    tasks,
    dependencies,
    resources,
    projects,
    workstreams,
    changeRecords,
    collaborationUsers,
  };
}
