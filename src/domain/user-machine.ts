import { isUser, type User } from '../shared/contracts.ts';

export type UsersStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UsersState {
  readonly status: UsersStatus;
  readonly users: readonly User[];
  readonly statusMessage: string;
}

export interface UserCandidate {
  readonly name: string;
  readonly role: string;
}

export type UsersAction =
  | { readonly type: 'loadStarted' }
  | { readonly type: 'loadSucceeded'; readonly users: readonly unknown[] }
  | { readonly type: 'loadFailed'; readonly message: string }
  | { readonly type: 'addUser'; readonly candidate: UserCandidate };

export interface UsersTransitionResult {
  readonly state: UsersState;
  readonly validationError: string;
}

export function createInitialUsersState(): UsersState {
  return {
    status: 'idle',
    users: [],
    statusMessage: '',
  };
}

/**
 * Returns an explanation if `candidate` cannot be added to `existing`,
 * or an empty string `''` when valid.
 */
export function validateUser(
  candidate: UserCandidate,
  existing: readonly User[]
): string {
  const trimmedName = candidate.name.trim();
  if (trimmedName.length === 0) {
    return 'Name is required.';
  }
  const trimmedRole = candidate.role.trim();
  if (trimmedRole.length === 0) {
    return 'Role is required.';
  }
  const normalized = trimmedName.toLowerCase();
  const taken = existing.some(
    (other) => other.name.trim().toLowerCase() === normalized
  );
  return taken ? `${trimmedName} is already in the list.` : '';
}

function sanitizeUsers(rawUsers: readonly unknown[]): User[] {
  const seen = new Set<string>();
  const unique: User[] = [];
  for (const item of rawUsers) {
    if (!isUser(item)) continue;
    const trimmedName = item.name.trim();
    const trimmedRole = item.role.trim();
    const key = trimmedName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: trimmedName, role: trimmedRole });
  }
  return unique;
}

export function transitionUsers(
  state: UsersState,
  action: UsersAction
): UsersTransitionResult {
  switch (action.type) {
    case 'loadStarted':
      return {
        state: {
          ...state,
          status: 'loading',
          statusMessage: 'Loading users…',
        },
        validationError: '',
      };
    case 'loadSucceeded': {
      const users = sanitizeUsers(action.users);
      return {
        state: {
          status: 'ready',
          users,
          statusMessage: '',
        },
        validationError: '',
      };
    }
    case 'loadFailed':
      return {
        state: {
          ...state,
          status: 'error',
          statusMessage: action.message,
        },
        validationError: '',
      };
    case 'addUser': {
      const validationError = validateUser(action.candidate, state.users);
      if (validationError.length > 0) {
        return { state, validationError };
      }
      const nextUser: User = {
        name: action.candidate.name.trim(),
        role: action.candidate.role.trim(),
      };
      return {
        state: {
          status: 'ready',
          users: [...state.users, nextUser],
          statusMessage: `Added ${nextUser.name}.`,
        },
        validationError: '',
      };
    }
  }
}

/**
 * Verifies every formal invariant on a `UsersState`.
 * Returns an empty array when all invariants hold.
 */
export function checkUsersInvariants(state: UsersState): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const user of state.users) {
    if (user.name.length === 0 || user.name !== user.name.trim()) {
      violations.push(
        `User name must be non-empty and trimmed, got "${user.name}"`
      );
    }
    if (user.role.length === 0 || user.role !== user.role.trim()) {
      violations.push(
        `User "${user.name}" role must be non-empty and trimmed, got "${user.role}"`
      );
    }
    const key = user.name.toLowerCase();
    if (seen.has(key)) {
      violations.push(
        `Duplicate case-insensitive user name detected: "${user.name}"`
      );
    }
    seen.add(key);
  }

  return violations;
}
