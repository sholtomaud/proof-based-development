import { isUser, type User } from '../shared/contracts.ts';
import { validateUser } from '../domain/user-machine.ts';

export type { User };
export { validateUser };

export type FetchUsersTransport = (url: string) => Promise<Response>;

/**
 * Loads the users from the app's API — here a static JSON file in `public/`,
 * so the example needs no backend. The URL is relative to the app's base URL.
 *
 * Services hold logic that needs no DOM, which keeps them unit-testable with
 * `node --test`: pass a stand-in transport as `fetchImpl`.
 */
export async function fetchUsers(
  fetchImpl: FetchUsersTransport = (url) => fetch(url)
): Promise<User[]> {
  const response = await fetchImpl('data/users.json');
  if (!response.ok) {
    throw new Error(`Could not load users (HTTP ${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Could not load users (invalid payload)');
  }
  return payload.filter(isUser);
}
