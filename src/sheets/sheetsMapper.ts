import type { Task, Dependency, DependencyType } from '../types';
import { taskDuration, ensureBusinessDay, prevBusinessDay } from '../utils/dateUtils';
import { parseISO, format } from 'date-fns';

export function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ─── Column Layout ───────────────────────────────────────────────────

// Column order in the Google Sheet (row 1 = headers).
// taskToRow writes in this order. rowToTask reads by name via HeaderMap.
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
  'lastModifiedBy',
  'lastModifiedAt',
] as const;

export const HEADER_ROW = SHEET_COLUMNS.map((c) => c as string);

// ─── Header Map (name-based column lookup) ───────────────────────────

/**
 * Map from column name → column index.
 * Built from the actual Sheet header row. Used by rowToTask for
 * position-independent reads.
 */
export type HeaderMap = Map<string, number>;

/**
 * Known column aliases for backward compatibility.
 * When a column is renamed in a future version, add the old name here
 * so Sheets with the old header still work.
 *
 * Format: { canonicalName: [alias1, alias2, ...] }
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  // Example for future use:
  // 'team': ['workStream'],  // if workStream is renamed to team
};

/** The columns required for a Sheet to be recognized as Ganttlet format. */
const REQUIRED_COLUMNS = new Set([
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
]);

/**
 * Build a column-name → index map from a Sheet header row.
 * Case-insensitive. Supports aliases for renamed columns.
 *
 * Returns the map on success, null if required columns are missing.
 */
export function buildHeaderMap(headerRow: string[]): HeaderMap | null {
  const map: HeaderMap = new Map();

  // Build raw name → index (case-insensitive)
  for (let i = 0; i < headerRow.length; i++) {
    const name = headerRow[i].trim().toLowerCase();
    if (name) map.set(name, i);
  }

  // Resolve aliases: if canonical name is missing but an alias is present, use it
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (!map.has(canonical.toLowerCase())) {
      for (const alias of aliases) {
        const idx = map.get(alias.toLowerCase());
        if (idx !== undefined) {
          map.set(canonical.toLowerCase(), idx);
          break;
        }
      }
    }
  }

  // Check all required columns are present
  for (const col of REQUIRED_COLUMNS) {
    if (!map.has(col.toLowerCase())) {
      return null;
    }
  }

  return map;
}

/**
 * Get a cell value from a row using the header map.
 * Returns '' for missing columns or missing cells.
 */
function getCell(row: string[], headerMap: HeaderMap, columnName: string): string {
  const idx = headerMap.get(columnName.toLowerCase());
  if (idx === undefined) return '';
  return row[idx] || '';
}

// ─── Write Path ──────────────────────────────────────────────────────

/** Lowercase → canonical camelCase lookup for column names. */
const CANONICAL_COLUMN_NAME = new Map<string, string>(
  SHEET_COLUMNS.map((c) => [c.toLowerCase(), c])
);

/** Serialize a single field to its Sheet string representation. */
function serializeField(task: Task, columnName: string): string {
  // Normalize to canonical camelCase (headerMap stores lowercase keys)
  const canonical = CANONICAL_COLUMN_NAME.get(columnName.toLowerCase()) ?? columnName;
  switch (canonical) {
    case 'id':
      return task.id;
    case 'name':
      return task.name;
    case 'startDate':
      return task.startDate;
    case 'endDate':
      return task.endDate;
    case 'duration':
      return String(taskDuration(task.startDate, task.endDate));
    case 'owner':
      return task.owner;
    case 'workStream':
      return task.workStream;
    case 'project':
      return task.project;
    case 'functionalArea':
      return task.functionalArea;
    case 'done':
      return String(task.done);
    case 'description':
      return task.description;
    case 'isMilestone':
      return String(task.isMilestone);
    case 'isSummary':
      return String(task.isSummary);
    case 'parentId':
      return task.parentId || '';
    case 'childIds':
      return task.childIds.join(',');
    case 'dependencies':
      return serializeDependencies(task.dependencies);
    case 'notes':
      return task.notes;
    case 'okrs':
      return task.okrs.join('|');
    case 'constraintType':
      return task.constraintType ?? '';
    case 'constraintDate':
      return task.constraintDate ?? '';
    case 'lastModifiedBy':
      return ''; // written by SheetsAdapter
    case 'lastModifiedAt':
      return ''; // written by SheetsAdapter
    default:
      return ''; // unknown column — preserve the cell as empty
  }
}

/**
 * Serialize a task to a row in canonical SHEET_COLUMNS order.
 * Used only when creating a brand-new Sheet (no existing column order to respect).
 */
export function taskToRow(task: Task): string[] {
  return SHEET_COLUMNS.map((col) => serializeField(task, col));
}

/**
 * Serialize a task to a row in the Sheet's actual column order.
 * Used when writing back to an existing Sheet — respects user column reordering.
 *
 * The headerMap tells us which column index each field occupies in the Sheet.
 * Unknown columns (user-added) get empty strings. Known columns the Sheet
 * doesn't have are NOT appended — the Sheet's column layout is authoritative.
 */
export function taskToRowWithMap(task: Task, headerMap: HeaderMap, columnCount: number): string[] {
  const row = new Array<string>(columnCount).fill('');
  for (const [colName, colIdx] of headerMap) {
    if (colIdx < columnCount) {
      row[colIdx] = serializeField(task, colName);
    }
  }
  return row;
}

// ─── Read Path (header-map based) ────────────────────────────────────

/**
 * Parse a Sheet row into a Task using a header map for column lookup.
 * Position-independent: survives column reordering and extra columns.
 */
export function rowToTask(row: string[], headerMap: HeaderMap): Task | null {
  const id = getCell(row, headerMap, 'id');
  if (!id) return null;

  let startDate = getCell(row, headerMap, 'startDate');
  let endDate = getCell(row, headerMap, 'endDate');

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
    return parseInt(getCell(row, headerMap, 'duration')) || 1;
  })();

  const childIdsRaw = getCell(row, headerMap, 'childIds');
  const okrsRaw = getCell(row, headerMap, 'okrs');

  return {
    id,
    name: getCell(row, headerMap, 'name'),
    startDate,
    endDate,
    duration,
    owner: getCell(row, headerMap, 'owner'),
    workStream: getCell(row, headerMap, 'workStream'),
    project: getCell(row, headerMap, 'project'),
    functionalArea: getCell(row, headerMap, 'functionalArea'),
    done: getCell(row, headerMap, 'done') === 'true',
    description: getCell(row, headerMap, 'description'),
    isMilestone: getCell(row, headerMap, 'isMilestone') === 'true',
    isSummary: getCell(row, headerMap, 'isSummary') === 'true',
    parentId: getCell(row, headerMap, 'parentId') || null,
    childIds: childIdsRaw ? childIdsRaw.split(',').filter(Boolean) : [],
    dependencies: parseDependencies(getCell(row, headerMap, 'dependencies')),
    notes: getCell(row, headerMap, 'notes'),
    okrs: okrsRaw ? okrsRaw.split('|').filter(Boolean) : [],
    ...parseConstraintFields(
      getCell(row, headerMap, 'constraintType'),
      getCell(row, headerMap, 'constraintDate')
    ),
  };
}

// ─── Bulk operations ─────────────────────────────────────────────────

export function tasksToRows(tasks: Task[]): string[][] {
  return [HEADER_ROW, ...tasks.filter((t) => !t.isSummary || t.childIds.length > 0).map(taskToRow)];
}

export function rowsToTasks(rows: string[][]): Task[] {
  if (rows.length < 2) return []; // Only header or empty

  // Build header map from the actual header row
  const headerMap = buildHeaderMap(rows[0]);
  if (!headerMap) return []; // Invalid headers

  const dataRows = rows.slice(1); // Skip header
  const tasks: Task[] = [];
  for (const row of dataRows) {
    const task = rowToTask(row, headerMap);
    if (task) {
      // Fix dependency toId references
      task.dependencies = task.dependencies.map((d) => ({ ...d, toId: task.id }));
      tasks.push(task);
    }
  }
  return tasks;
}

// ─── Validation (returns HeaderMap, not boolean) ─────────────────────

/**
 * Validate that the sheet header row contains all required columns.
 * Returns a HeaderMap on success, null on failure.
 *
 * This is the same as buildHeaderMap — the name is kept for API clarity
 * at callsites that only care about validation (e.g. TargetSheetCheck).
 */
export function validateHeaders(headerRow: string[]): HeaderMap | null {
  return buildHeaderMap(headerRow);
}

// ─── Internal helpers ────────────────────────────────────────────────

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
