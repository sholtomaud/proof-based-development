import {
  isRecord,
  isTodoFilter,
  type Task,
  type TodoFilter,
} from '../shared/contracts.ts';

export interface TodoState {
  readonly tasks: readonly Task[];
  readonly filter: TodoFilter;
  readonly nextTaskId: number;
}

export interface TodoCounts {
  readonly total: number;
  readonly active: number;
  readonly completed: number;
}

export type TodoAction =
  | { readonly type: 'add'; readonly text: string }
  | { readonly type: 'toggle'; readonly id: number }
  | { readonly type: 'delete'; readonly id: number }
  | { readonly type: 'setFilter'; readonly filter: TodoFilter }
  | { readonly type: 'clearCompleted' }
  | { readonly type: 'hydrate'; readonly raw: unknown };

export const DEFAULT_TASKS: readonly Task[] = [
  { id: 1, text: 'Discover Boba framework standards', completed: true },
  { id: 2, text: 'Explore the upgraded regex router', completed: false },
  { id: 3, text: 'Build a gorgeous state-driven interface', completed: false },
];

function computeNextTaskId(tasks: readonly Task[], floor = 1): number {
  const maxId = tasks.reduce((max, task) => (task.id > max ? task.id : max), 0);
  return Math.max(floor, maxId + 1);
}

export function createInitialTodoState(
  tasks: readonly Task[] = DEFAULT_TASKS
): TodoState {
  const sanitized = sanitizeTaskList(tasks);
  return {
    tasks: sanitized,
    filter: 'all',
    nextTaskId: computeNextTaskId(sanitized),
  };
}

function sanitizeTaskList(rawTasks: readonly unknown[]): Task[] {
  const seenIds = new Set<number>();
  const valid: Task[] = [];
  for (const item of rawTasks) {
    if (!isRecord(item)) continue;
    const { id, text, completed } = item;
    if (
      typeof id !== 'number' ||
      !Number.isInteger(id) ||
      id < 1 ||
      seenIds.has(id)
    ) {
      continue;
    }
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (typeof completed !== 'boolean') continue;
    seenIds.add(id);
    valid.push({ id, text: trimmed, completed });
  }
  return valid;
}

/**
 * Safely hydrates persisted todo state from untrusted storage data.
 * Always resets the active view filter to `'all'` and preserves all domain
 * invariants, falling back to `DEFAULT_TASKS` when the input is malformed.
 */
export function parsePersistedTodoState(raw: unknown): TodoState {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) {
    return createInitialTodoState();
  }
  const tasks = sanitizeTaskList(raw.tasks);
  return {
    tasks,
    filter: 'all',
    nextTaskId: computeNextTaskId(tasks),
  };
}

export function transitionTodo(
  state: TodoState,
  action: TodoAction
): TodoState {
  switch (action.type) {
    case 'add': {
      const text = action.text.trim();
      if (text.length === 0) return state;
      const newTask: Task = {
        id: state.nextTaskId,
        text,
        completed: false,
      };
      return {
        ...state,
        tasks: [...state.tasks, newTask],
        nextTaskId: state.nextTaskId + 1,
      };
    }
    case 'toggle': {
      let changed = false;
      const tasks = state.tasks.map((task) => {
        if (task.id !== action.id) return task;
        changed = true;
        return { ...task, completed: !task.completed };
      });
      return changed ? { ...state, tasks } : state;
    }
    case 'delete': {
      const tasks = state.tasks.filter((task) => task.id !== action.id);
      return tasks.length === state.tasks.length ? state : { ...state, tasks };
    }
    case 'setFilter': {
      if (!isTodoFilter(action.filter) || action.filter === state.filter) {
        return state;
      }
      return { ...state, filter: action.filter };
    }
    case 'clearCompleted': {
      const tasks = state.tasks.filter((task) => !task.completed);
      return tasks.length === state.tasks.length ? state : { ...state, tasks };
    }
    case 'hydrate': {
      return parsePersistedTodoState(action.raw);
    }
  }
}

export function selectFilteredTasks(state: TodoState): readonly Task[] {
  if (state.filter === 'active') {
    return state.tasks.filter((task) => !task.completed);
  }
  if (state.filter === 'completed') {
    return state.tasks.filter((task) => task.completed);
  }
  return state.tasks;
}

export function selectTodoCounts(state: TodoState): TodoCounts {
  let active = 0;
  let completed = 0;
  for (const task of state.tasks) {
    if (task.completed) completed += 1;
    else active += 1;
  }
  return {
    total: state.tasks.length,
    active,
    completed,
  };
}

/**
 * Verifies every formal invariant on a `TodoState`.
 * Returns an empty array when all invariants hold.
 */
export function checkTodoInvariants(state: TodoState): string[] {
  const violations: string[] = [];

  if (!isTodoFilter(state.filter)) {
    violations.push(`Invalid filter value: ${String(state.filter)}`);
  }

  if (!Number.isInteger(state.nextTaskId) || state.nextTaskId < 1) {
    violations.push(
      `nextTaskId must be a positive integer, got ${String(state.nextTaskId)}`
    );
  }

  const seenIds = new Set<number>();
  for (const task of state.tasks) {
    if (!Number.isInteger(task.id) || task.id < 1) {
      violations.push(`Task id must be a positive integer, got ${task.id}`);
    }
    if (seenIds.has(task.id)) {
      violations.push(`Duplicate task id detected: ${task.id}`);
    }
    seenIds.add(task.id);

    if (task.id >= state.nextTaskId) {
      violations.push(
        `Task id ${task.id} must be strictly less than nextTaskId ${state.nextTaskId}`
      );
    }
    if (task.text.length === 0 || task.text !== task.text.trim()) {
      violations.push(
        `Task ${task.id} must have non-empty trimmed text, got "${task.text}"`
      );
    }
  }

  const counts = selectTodoCounts(state);
  if (counts.active + counts.completed !== counts.total) {
    violations.push('active + completed count mismatch');
  }

  const filtered = selectFilteredTasks(state);
  const expectedLength =
    state.filter === 'all'
      ? counts.total
      : state.filter === 'active'
        ? counts.active
        : counts.completed;
  if (filtered.length !== expectedLength) {
    violations.push(
      `Filtered task count ${filtered.length} does not match expected ${expectedLength} for filter "${state.filter}"`
    );
  }

  return violations;
}
