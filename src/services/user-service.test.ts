import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  fetchUsers,
  validateUser,
  type FetchUsersTransport,
  type User,
} from './user-service.ts';

const ada: User = { name: 'Ada', role: 'Engineer' };

describe('user-service', () => {
  test('fetchUsers returns the users from the API', async () => {
    const fetchStub: FetchUsersTransport = async (url) => {
      assert.strictEqual(url, 'data/users.json');
      return Response.json([ada]);
    };
    assert.deepStrictEqual(await fetchUsers(fetchStub), [ada]);
  });

  test('fetchUsers rejects when the request fails', async () => {
    const fetchStub: FetchUsersTransport = async () =>
      new Response('', { status: 500 });
    await assert.rejects(fetchUsers(fetchStub), /HTTP 500/);
  });

  test('validateUser rejects duplicate names, ignoring case', () => {
    assert.strictEqual(
      validateUser({ name: 'Grace', role: 'Engineer' }, [ada]),
      ''
    );
    assert.match(
      validateUser({ name: 'ada', role: 'Engineer' }, [ada]),
      /already/
    );
  });
});
