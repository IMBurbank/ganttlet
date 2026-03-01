import type { Task, Dependency, DependencyType } from '../types';

// Column order in the Google Sheet (row 1 = headers)
export const SHEET_COLUMNS = [
  'id', 'name', 'startDate', 'endDate', 'duration', 'owner',
  'workStream', 'project', 'functionalArea', 'done', 'description',
  'isMilestone', 'isSummary', 'parentId', 'childIds', 'dependencies',
  'notes', 'okrs',
] as const;

export const HEADER_ROW = SHEET_COLUMNS.map(c => c as string);

export function taskToRow(task: Task): string[] {
  return [
    task.id,
    task.name,
    task.startDate,
    task.endDate,
    String(task.duration),
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
  ];
}

export function rowToTask(row: string[]): Task | null {
  if (!row[0]) return null;

  const get = (i: number) => row[i] || '';

  return {
    id: get(0),
    name: get(1),
    startDate: get(2),
    endDate: get(3),
    duration: parseInt(get(4)) || 0,
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
  };
}

function serializeDependencies(deps: Dependency[]): string {
  return deps.map(d => `${d.fromId}:${d.type}:${d.lag}`).join(';');
}

function parseDependencies(str: string): Dependency[] {
  if (!str) return [];
  return str.split(';').filter(Boolean).map(part => {
    const [fromId, type, lagStr] = part.split(':');
    return {
      fromId,
      toId: '', // Will be filled by the caller based on which task owns this dep
      type: (type as DependencyType) || 'FS',
      lag: parseInt(lagStr) || 0,
    };
  });
}

export function tasksToRows(tasks: Task[]): string[][] {
  return [HEADER_ROW, ...tasks.filter(t => !t.isSummary || t.childIds.length > 0).map(taskToRow)];
}

export function rowsToTasks(rows: string[][]): Task[] {
  if (rows.length < 2) return []; // Only header or empty
  const dataRows = rows.slice(1); // Skip header
  const tasks: Task[] = [];
  for (const row of dataRows) {
    const task = rowToTask(row);
    if (task) {
      // Fix dependency toId references
      task.dependencies = task.dependencies.map(d => ({ ...d, toId: task.id }));
      tasks.push(task);
    }
  }
  return tasks;
}
