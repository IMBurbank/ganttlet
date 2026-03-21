import type { Task, Dependency, DependencyType } from '../types';
import { taskDuration, ensureBusinessDay, prevBusinessDay } from '../utils/dateUtils';
import { parseISO, format } from 'date-fns';

// Column order in the Google Sheet (row 1 = headers)
export const SHEET_COLUMNS = [
  'id',
  'name',
  'startDate',
  'endDate',
  'duration',
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
] as const;

export const HEADER_ROW = SHEET_COLUMNS.map((c) => c as string);

export function taskToRow(task: Task): string[] {
  return [
    task.id,
    task.name,
    task.startDate,
    task.endDate,
    String(taskDuration(task.startDate, task.endDate)),
    task.owner,
    task.workStream,
    task.project,
    task.functionalArea,
    String(task.done),
    task.description,
    String(task.isMilestone),
    String(task.isSummary),
    task.parentId || '',
    task.childIds.join(','),
    serializeDependencies(task.dependencies),
    task.notes,
    task.okrs.join('|'),
    task.constraintType ?? '',
    task.constraintDate ?? '',
  ];
}

export function rowToTask(row: string[]): Task | null {
  if (!row[0]) return null;

  const get = (i: number) => row[i] || '';

  let startDate = get(2);
  let endDate = get(3);

  // Snap weekend dates to valid business days
  if (startDate) {
    const snapped = format(ensureBusinessDay(parseISO(startDate)), 'yyyy-MM-dd');
    if (snapped !== startDate) {
      console.warn(`rowToTask: snapped startDate "${startDate}" to "${snapped}"`);
      startDate = snapped;
    }
  }
  if (endDate) {
    const snapped = format(prevBusinessDay(parseISO(endDate)), 'yyyy-MM-dd');
    if (snapped !== endDate) {
      console.warn(`rowToTask: snapped endDate "${endDate}" to "${snapped}"`);
      endDate = snapped;
    }
  }

  // Ensure endDate >= startDate after snapping
  if (startDate && endDate && endDate < startDate) {
    console.warn(
      `rowToTask: endDate "${endDate}" before startDate "${startDate}", correcting to startDate`
    );
    endDate = startDate;
  }

  // Compute duration with minimum of 1
  const duration = (() => {
    if (startDate && endDate) return Math.max(taskDuration(startDate, endDate), 1);
    return parseInt(get(4)) || 1;
  })();

  return {
    id: get(0),
    name: get(1),
    startDate,
    endDate,
    duration,
    owner: get(5),
    workStream: get(6),
    project: get(7),
    functionalArea: get(8),
    done: get(9) === 'true',
    description: get(10),
    isMilestone: get(11) === 'true',
    isSummary: get(12) === 'true',
    parentId: get(13) || null,
    childIds: get(14) ? get(14).split(',').filter(Boolean) : [],
    dependencies: parseDependencies(get(15)),
    isExpanded: true,
    isHidden: false,
    notes: get(16),
    okrs: get(17) ? get(17).split('|').filter(Boolean) : [],
    ...parseConstraintFields(get(18), get(19)),
  };
}

const VALID_CONSTRAINT_TYPES = new Set([
  'ASAP',
  'SNET',
  'ALAP',
  'SNLT',
  'FNET',
  'FNLT',
  'MSO',
  'MFO',
]);
const DATE_FREE_CONSTRAINTS = new Set(['ASAP', 'ALAP']);

function parseConstraintFields(
  rawType: string,
  rawDate: string
): { constraintType?: Task['constraintType']; constraintDate?: string } {
  if (!rawType) return {};

  const ct = rawType.trim().toUpperCase();
  if (!VALID_CONSTRAINT_TYPES.has(ct)) {
    console.warn(`Invalid constraintType "${rawType}", ignoring`);
    return {};
  }

  const constraintType = ct as Task['constraintType'];

  // ASAP and ALAP don't use dates
  if (DATE_FREE_CONSTRAINTS.has(ct) || !rawDate) {
    return { constraintType };
  }

  // Snap weekend constraint dates: forward for start constraints, backward for finish constraints
  let constraintDate = rawDate;
  const FINISH_CONSTRAINTS = new Set(['FNET', 'FNLT', 'MFO']);
  const snapFn = FINISH_CONSTRAINTS.has(ct) ? prevBusinessDay : ensureBusinessDay;
  const snapped = format(snapFn(parseISO(rawDate)), 'yyyy-MM-dd');
  if (snapped !== rawDate) {
    console.warn(`parseConstraintFields: snapped constraintDate "${rawDate}" to "${snapped}"`);
    constraintDate = snapped;
  }

  return { constraintType, constraintDate };
}

function serializeDependencies(deps: Dependency[]): string {
  return deps.map((d) => `${d.fromId}:${d.type}:${d.lag}`).join(';');
}

function parseDependencies(str: string): Dependency[] {
  if (!str) return [];
  return str
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const [fromId, type, lagStr] = part.split(':');
      return {
        fromId,
        toId: '', // Will be filled by the caller based on which task owns this dep
        type: (type as DependencyType) || 'FS',
        lag: parseInt(lagStr) || 0,
      };
    });
}

/**
 * Validate that the header row matches the expected SHEET_COLUMNS.
 * Case-insensitive, order-sensitive. All 20 required columns must be present.
 * Extra columns after column T are ignored.
 */
export function validateHeaders(headerRow: string[]): boolean {
  if (headerRow.length < SHEET_COLUMNS.length) return false;
  for (let i = 0; i < SHEET_COLUMNS.length; i++) {
    if (headerRow[i].toLowerCase() !== SHEET_COLUMNS[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

export function tasksToRows(tasks: Task[]): string[][] {
  return [HEADER_ROW, ...tasks.filter((t) => !t.isSummary || t.childIds.length > 0).map(taskToRow)];
}

export function rowsToTasks(rows: string[][]): Task[] {
  if (rows.length < 2) return []; // Only header or empty
  const dataRows = rows.slice(1); // Skip header
  const tasks: Task[] = [];
  for (const row of dataRows) {
    const task = rowToTask(row);
    if (task) {
      // Fix dependency toId references
      task.dependencies = task.dependencies.map((d) => ({ ...d, toId: task.id }));
      tasks.push(task);
    }
  }
  return tasks;
}
