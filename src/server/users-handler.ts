import { isUser, type User } from '../shared/contracts.ts';
import { validateUser, type UserCandidate } from '../domain/user-machine.ts';

export interface ServerResponse<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * Example server-side handler isolated in `src/server/`.
 * Client UI (`src/components/`, `src/core/`, `src/services/`, `src/main.ts`)
 * is architecturally forbidden from importing anything in `src/server/`.
 */
export function handleCreateUser(
  candidate: UserCandidate,
  existing: readonly User[]
): ServerResponse<{ readonly user?: User; readonly error?: string }> {
  const error = validateUser(candidate, existing);
  if (error.length > 0) {
    return { status: 400, body: { error } };
  }
  const created = { name: candidate.name.trim(), role: candidate.role };
  if (!isUser(created)) {
    return { status: 400, body: { error: 'Invalid user payload.' } };
  }
  return { status: 201, body: { user: created } };
}
