export const USER_ROLE_OPTIONS = [
  'Engineer',
  'Designer',
  'Maintainer',
] as const;

export interface User {
  readonly name: string;
  readonly role: string;
}

export const TODO_FILTERS = ['all', 'active', 'completed'] as const;

export type TodoFilter = (typeof TODO_FILTERS)[number];

export interface Task {
  readonly id: number;
  readonly text: string;
  readonly completed: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTodoFilter(value: unknown): value is TodoFilter {
  return (
    typeof value === 'string' &&
    TODO_FILTERS.some((allowed) => allowed === value)
  );
}

export function isUser(value: unknown): value is User {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.role === 'string' &&
    value.role.trim().length > 0
  );
}
