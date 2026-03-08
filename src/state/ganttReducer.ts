import type { GanttState, Task, CascadeShift } from '../types';
import type { GanttAction } from './actions';
import { cascadeDependents, recalculateEarliest } from '../utils/schedulerWasm';
import { recalcSummaryDates } from '../utils/summaryUtils';
import { workingDaysBetween } from '../utils/dateUtils';
import { computeInheritedFields, generatePrefixedId, getHierarchyRole, getAllDescendantIds, isDescendantOf } from '../utils/hierarchyUtils';
import { validateDependencyHierarchy } from '../utils/dependencyValidation';
import { checkMoveConflicts } from '../utils/dependencyValidation';

const UNDOABLE_ACTIONS = new Set([
  'RESIZE_TASK', 'CASCADE_DEPENDENTS', 'COMPLETE_DRAG',
  'ADD_DEPENDENCY', 'UPDATE_DEPENDENCY', 'REMOVE_DEPENDENCY',
  'ADD_TASK', 'DELETE_TASK', 'REPARENT_TASK',
  'RECALCULATE_EARLIEST', 'SET_CONSTRAINT',
]);

export function ganttReducer(state: GanttState, action: GanttAction): GanttState {
  // Snapshot before undoable actions
  let stateForReducer = state;
  if (UNDOABLE_ACTIONS.has(action.type)) {
    const undoStack = [...state.undoStack, state.tasks].slice(-50);
    stateForReducer = { ...state, undoStack, redoStack: [] };
  }

  return ganttReducerInner(stateForReducer, action);
}

function ganttReducerInner(state: GanttState, action: GanttAction): GanttState {
  switch (action.type) {
    case 'MOVE_TASK': {
      let tasks = state.tasks.map(t => {
        if (t.id !== action.taskId) return t;
        const duration = workingDaysBetween(action.newStartDate, action.newEndDate);
        return { ...t, startDate: action.newStartDate, endDate: action.newEndDate, duration };
      });
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'RESIZE_TASK': {
      let tasks = state.tasks.map(t => {
        if (t.id !== action.taskId) return t;
        const duration = workingDaysBetween(t.startDate, action.newEndDate);
        return { ...t, endDate: action.newEndDate, duration };
      });
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'UPDATE_TASK_FIELD': {
      const taskMap = new Map(state.tasks.map(t => [t.id, t]));
      const targetTask = taskMap.get(action.taskId);

      let tasks = state.tasks.map(t => {
        if (t.id !== action.taskId) return t;
        const updated = { ...t, [action.field]: action.value };
        // Recompute duration when dates change
        if (action.field === 'startDate' || action.field === 'endDate') {
          updated.duration = workingDaysBetween(updated.startDate, updated.endDate);
        }
        return updated;
      });

      // If renaming a project or workstream, cascade to descendants
      if (action.field === 'name' && targetTask && typeof action.value === 'string') {
        const role = getHierarchyRole(targetTask, taskMap);

        if (role === 'project') {
          // Update own project field + all descendants' project field
          const descendantIds = getAllDescendantIds(action.taskId, taskMap);
          tasks = tasks.map(t => {
            if (t.id === action.taskId) return { ...t, project: action.value as string };
            if (descendantIds.has(t.id)) return { ...t, project: action.value as string };
            return t;
          });
        } else if (role === 'workstream') {
          // Update own workStream field + all child tasks' workStream field
          const descendantIds = getAllDescendantIds(action.taskId, taskMap);
          tasks = tasks.map(t => {
            if (t.id === action.taskId) return { ...t, workStream: action.value as string };
            if (descendantIds.has(t.id)) return { ...t, workStream: action.value as string };
            return t;
          });
        }
      }

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'TOGGLE_EXPAND': {
      const tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, isExpanded: !t.isExpanded }
          : t
      );
      return { ...state, tasks };
    }

    case 'SET_COLOR_BY':
      return { ...state, colorBy: action.colorBy };

    case 'SET_ZOOM':
      return { ...state, zoomLevel: action.zoomLevel };

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };

    case 'TOGGLE_COLUMN': {
      const columns = state.columns.map(c =>
        c.key === action.columnKey ? { ...c, visible: !c.visible } : c
      );
      return { ...state, columns };
    }

    case 'SET_COLUMNS':
      return { ...state, columns: action.columns };

    case 'HIDE_TASK': {
      const tasks = state.tasks.map(t =>
        t.id === action.taskId ? { ...t, isHidden: true } : t
      );
      return { ...state, tasks };
    }

    case 'SHOW_ALL_TASKS': {
      const tasks = state.tasks.map(t => ({ ...t, isHidden: false }));
      return { ...state, tasks };
    }

    case 'TOGGLE_HISTORY_PANEL':
      return { ...state, isHistoryPanelOpen: !state.isHistoryPanelOpen };

    case 'START_SYNC':
      return { ...state, isSyncing: true, syncComplete: false };

    case 'COMPLETE_SYNC':
      return { ...state, isSyncing: false, syncComplete: true };

    case 'RESET_SYNC':
      return { ...state, syncComplete: false };

    case 'SET_CONTEXT_MENU':
      return { ...state, contextMenu: action.menu };

    case 'ADD_CHANGE_RECORD': {
      const record = {
        id: `ch-${Date.now()}`,
        timestamp: new Date().toISOString(),
        user: action.user,
        taskId: action.taskId,
        taskName: action.taskName,
        field: action.field,
        oldValue: action.oldValue,
        newValue: action.newValue,
      };
      return { ...state, changeHistory: [record, ...state.changeHistory] };
    }

    case 'CASCADE_DEPENDENTS': {
      const preCascadeDates = new Map(state.tasks.map(t => [t.id, { start: t.startDate, end: t.endDate }]));
      let tasks = cascadeDependents(state.tasks, action.taskId, action.daysDelta);
      const changedIds: string[] = [];
      const shifts: CascadeShift[] = [];
      for (let i = 0; i < tasks.length; i++) {
        const pre = preCascadeDates.get(tasks[i].id);
        if (pre && (tasks[i].startDate !== pre.start || tasks[i].endDate !== pre.end)) {
          changedIds.push(tasks[i].id);
          shifts.push({ taskId: tasks[i].id, fromStartDate: pre.start, fromEndDate: pre.end });
        }
      }
      tasks = recalcSummaryDates(tasks);
      // Only set cascade highlight for forward moves (non-empty changedIds)
      if (changedIds.length > 0) {
        return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: shifts };
      }
      return { ...state, tasks };
    }

    case 'TOGGLE_SHOW_OWNER_ON_BAR':
      return { ...state, showOwnerOnBar: !state.showOwnerOnBar };

    case 'TOGGLE_SHOW_AREA_ON_BAR':
      return { ...state, showAreaOnBar: !state.showAreaOnBar };

    case 'TOGGLE_SHOW_OKRS_ON_BAR':
      return { ...state, showOkrsOnBar: !state.showOkrsOnBar };

    case 'TOGGLE_CRITICAL_PATH':
      return { ...state, showCriticalPath: !state.showCriticalPath };

    case 'ADD_DEPENDENCY': {
      // Validate hierarchy rules
      const hierarchyError = validateDependencyHierarchy(
        state.tasks,
        action.taskId,
        action.dependency.fromId
      );
      if (hierarchyError) return state; // Silently reject — UI filters invalid options

      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, dependencies: [...t.dependencies, action.dependency] }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'UPDATE_DEPENDENCY': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? {
              ...t,
              dependencies: t.dependencies.map(d =>
                d.fromId === action.fromId
                  ? { ...d, type: action.newType, lag: action.newLag }
                  : d
              ),
            }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'REMOVE_DEPENDENCY': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, dependencies: t.dependencies.filter(d => d.fromId !== action.fromId) }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'SET_TASKS':
      return { ...state, tasks: action.tasks };

    case 'MERGE_EXTERNAL_TASKS': {
      const { externalTasks } = action;
      const localMap = new Map(state.tasks.map(t => [t.id, t]));

      // Start with all external tasks (source of truth for additions/deletions)
      const merged = externalTasks.map(ext => {
        const local = localMap.get(ext.id);
        if (!local) return ext; // New task from sheets
        // If local task exists, keep local version (preserves in-progress edits)
        return local;
      });

      return { ...state, tasks: merged };
    }

    case 'SET_DEPENDENCY_EDITOR':
      return { ...state, dependencyEditor: action.editor };

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'ADD_TASK': {
      const addTaskMap = new Map(state.tasks.map(t => [t.id, t]));
      const parent = action.parentId ? addTaskMap.get(action.parentId) : undefined;

      // Generate ID: prefixed if parent is summary, otherwise timestamp
      const newId = parent && parent.isSummary
        ? generatePrefixedId(parent, state.tasks)
        : `task-${Date.now()}`;

      // Inherit fields from parent
      const inherited = computeInheritedFields(action.parentId, addTaskMap);

      const today = new Date().toISOString().split('T')[0];
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 5);
      const endDateStr = endDate.toISOString().split('T')[0];

      const newTask: Task = {
        id: newId,
        name: 'New Task',
        startDate: today,
        endDate: endDateStr,
        duration: workingDaysBetween(today, endDateStr),
        owner: '',
        workStream: inherited.workStream,
        project: inherited.project,
        functionalArea: '',
        done: false,
        description: '',
        isMilestone: false,
        isSummary: false,
        parentId: action.parentId,
        childIds: [],
        dependencies: [],
        isExpanded: false,
        isHidden: false,
        notes: '',
        okrs: inherited.okrs,
      };

      let tasks = [...state.tasks];

      // If it has a parent, add to parent's childIds
      if (action.parentId) {
        tasks = tasks.map(t =>
          t.id === action.parentId
            ? { ...t, childIds: [...t.childIds, newId] }
            : t
        );
      }

      // Insert after the specified task, or at the end
      if (action.afterTaskId) {
        const idx = tasks.findIndex(t => t.id === action.afterTaskId);
        if (idx !== -1) {
          let insertIdx = idx + 1;
          const afterTask = tasks[idx];
          if (afterTask.isSummary && afterTask.isExpanded) {
            const descendants = new Set<string>();
            const queue = [...afterTask.childIds];
            while (queue.length > 0) {
              const cid = queue.pop()!;
              descendants.add(cid);
              const child = tasks.find(t => t.id === cid);
              if (child) queue.push(...child.childIds);
            }
            while (insertIdx < tasks.length && descendants.has(tasks[insertIdx].id)) {
              insertIdx++;
            }
          }
          tasks.splice(insertIdx, 0, newTask);
        } else {
          tasks.push(newTask);
        }
      } else {
        tasks.push(newTask);
      }

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, focusNewTaskId: newId };
    }

    case 'DELETE_TASK': {
      const toDelete = new Set<string>();
      const queue = [action.taskId];
      while (queue.length > 0) {
        const id = queue.pop()!;
        toDelete.add(id);
        const task = state.tasks.find(t => t.id === id);
        if (task) queue.push(...task.childIds);
      }

      let tasks = state.tasks
        .filter(t => !toDelete.has(t.id))
        .map(t => ({
          ...t,
          childIds: t.childIds.filter(cid => !toDelete.has(cid)),
          dependencies: t.dependencies.filter(d => !toDelete.has(d.fromId)),
        }));

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, contextMenu: null };
    }

    case 'SET_COLLAB_USERS':
      return { ...state, collabUsers: action.users };

    case 'SET_COLLAB_CONNECTED':
      return { ...state, isCollabConnected: action.connected };

    case 'SET_LAST_CASCADE_IDS':
      return { ...state, lastCascadeIds: action.taskIds };

    case 'SET_CASCADE_SHIFTS':
      return { ...state, cascadeShifts: action.shifts };

    case 'SET_CRITICAL_PATH_SCOPE':
      return { ...state, criticalPathScope: action.scope };

    case 'TOGGLE_COLLAPSE_WEEKENDS':
      return { ...state, collapseWeekends: !state.collapseWeekends };

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        tasks: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.tasks],
        lastCascadeIds: [],
        cascadeShifts: [],
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        ...state,
        tasks: next,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, state.tasks],
        lastCascadeIds: [],
        cascadeShifts: [],
      };
    }

    case 'REPARENT_TASK': {
      const rTaskMap = new Map(state.tasks.map(t => [t.id, t]));
      const rTask = rTaskMap.get(action.taskId);
      if (!rTask) return state;

      // Can't reparent to self
      if (action.newParentId === action.taskId) return state;

      // Can't reparent to own descendant
      if (action.newParentId && isDescendantOf(action.newParentId, action.taskId, rTaskMap)) {
        return state;
      }

      // Check for dependency conflicts
      if (action.newParentId) {
        const conflicts = checkMoveConflicts(state.tasks, action.taskId, action.newParentId);
        if (conflicts.length > 0) return state;
      }

      let tasks = [...state.tasks];

      // 1. Remove from old parent's childIds
      if (rTask.parentId) {
        tasks = tasks.map(t =>
          t.id === rTask.parentId
            ? { ...t, childIds: t.childIds.filter(cid => cid !== action.taskId) }
            : t
        );
      }

      // 2. Determine new ID
      const newId = action.newId || action.taskId;
      const oldId = action.taskId;

      // 3. Compute inherited fields from new parent
      const updatedTaskMap = new Map(tasks.map(t => [t.id, t]));
      const rInherited = computeInheritedFields(action.newParentId, updatedTaskMap);

      // 4. Update the task itself
      tasks = tasks.map(t => {
        if (t.id === oldId) {
          return {
            ...t,
            id: newId,
            parentId: action.newParentId,
            project: rInherited.project,
            workStream: rInherited.workStream,
          };
        }
        return t;
      });

      // 5. Add to new parent's childIds
      if (action.newParentId) {
        tasks = tasks.map(t =>
          t.id === action.newParentId
            ? { ...t, childIds: [...t.childIds, newId] }
            : t
        );
      }

      // 6. If ID changed, update all references
      if (newId !== oldId) {
        tasks = tasks.map(t => {
          let updated = t;

          // Update parentId references
          if (t.parentId === oldId) {
            updated = { ...updated, parentId: newId };
          }

          // Update childIds references
          if (t.childIds.includes(oldId)) {
            updated = { ...updated, childIds: updated.childIds.map(cid => cid === oldId ? newId : cid) };
          }

          // Update dependency references (fromId and toId)
          const newDeps = t.dependencies.map(d => ({
            ...d,
            fromId: d.fromId === oldId ? newId : d.fromId,
            toId: d.toId === oldId ? newId : d.toId,
          }));
          if (JSON.stringify(newDeps) !== JSON.stringify(t.dependencies)) {
            updated = { ...updated, dependencies: newDeps };
          }

          return updated;
        });
      }

      // 7. Also update descendants' inherited fields
      const rDescendantIds = getAllDescendantIds(newId, new Map(tasks.map(t => [t.id, t])));
      if (rDescendantIds.size > 0) {
        tasks = tasks.map(t => {
          if (rDescendantIds.has(t.id)) {
            return { ...t, project: rInherited.project, workStream: rInherited.workStream || t.workStream };
          }
          return t;
        });
      }

      // 8. Reposition task in array after new parent
      if (action.newParentId) {
        const taskToMove = tasks.find(t => t.id === newId);
        if (taskToMove) {
          tasks = tasks.filter(t => t.id !== newId);
          const parentIdx = tasks.findIndex(t => t.id === action.newParentId);
          if (parentIdx !== -1) {
            // Insert after parent's last descendant
            let insertIdx = parentIdx + 1;
            const parentTask = tasks[parentIdx];
            const parentDescendants = getAllDescendantIds(parentTask.id, new Map(tasks.map(t => [t.id, t])));
            while (insertIdx < tasks.length && parentDescendants.has(tasks[insertIdx].id)) {
              insertIdx++;
            }
            tasks.splice(insertIdx, 0, taskToMove);
          } else {
            tasks.push(taskToMove);
          }
        }
      }

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, reparentPicker: null };
    }

    case 'SET_REPARENT_PICKER':
      return { ...state, reparentPicker: action.picker };

    case 'TOGGLE_LEFT_PANE':
      return { ...state, isLeftPaneCollapsed: !state.isLeftPaneCollapsed };

    case 'CLEAR_FOCUS_NEW_TASK':
      return { ...state, focusNewTaskId: null };

    case 'COMPLETE_DRAG': {
      // Atomic: set final position + cascade dependents in one reducer pass
      const duration = workingDaysBetween(action.newStartDate, action.newEndDate);
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, startDate: action.newStartDate, endDate: action.newEndDate, duration }
          : t
      );
      if (action.daysDelta !== 0) {
        const preCascadeDates = new Map(tasks.map(t => [t.id, { start: t.startDate, end: t.endDate }]));
        tasks = cascadeDependents(tasks, action.taskId, action.daysDelta);
        const changedIds: string[] = [];
        const shifts: CascadeShift[] = [];
        for (const t of tasks) {
          const pre = preCascadeDates.get(t.id);
          if (pre && (t.startDate !== pre.start || t.endDate !== pre.end)) {
            changedIds.push(t.id);
            shifts.push({ taskId: t.id, fromStartDate: pre.start, fromEndDate: pre.end });
          }
        }
        tasks = recalcSummaryDates(tasks);
        if (changedIds.length > 0) {
          return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: shifts };
        }
        return { ...state, tasks };
      }
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'SET_CONSTRAINT': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? {
              ...t,
              constraintType: action.constraintType,
              constraintDate: action.constraintType === 'ASAP' || action.constraintType === 'ALAP'
                ? undefined
                : action.constraintDate,
            }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'RECALCULATE_EARLIEST': {
      const { scope } = action;
      const results = recalculateEarliest(
        state.tasks,
        scope.project,
        scope.workstream,
        scope.taskId,
      );
      if (results.length === 0) return state;
      const recalcMap = new Map(results.map(r => [r.id, r]));
      const changedIds: string[] = [];
      let tasks = state.tasks.map(t => {
        const r = recalcMap.get(t.id);
        if (r && (t.startDate !== r.newStart || t.endDate !== r.newEnd)) {
          changedIds.push(t.id);
          return { ...t, startDate: r.newStart, endDate: r.newEnd };
        }
        return t;
      });
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, lastCascadeIds: changedIds, cascadeShifts: [] };
    }

    default:
      return state;
  }
}
