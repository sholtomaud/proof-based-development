import { test, describe } from 'node:test';
import assert from 'node:assert';
import { arb, assertProperty, type Arbitrary } from '../lib/property.ts';
import { USER_ROLE_OPTIONS } from '../../src/shared/contracts.ts';
import {
  checkUsersInvariants,
  createInitialUsersState,
  transitionUsers,
  validateUser,
  type UsersAction,
} from '../../src/domain/user-machine.ts';

const sampleNameArb = arb.oneOf(
  arb.constantFrom('Ada', 'ada', ' ADA ', 'Grace', 'Margaret', '   ', ''),
  arb.string({ minLength: 0, maxLength: 16, alphabet: 'AdaGrace -' })
);

const sampleRoleArb = arb.oneOf<string>(
  arb.constantFrom(...USER_ROLE_OPTIONS),
  arb.constantFrom('Admiral', '  Engineer  ', '', '   ')
);

const usersActionArb: Arbitrary<UsersAction> = arb.oneOf<UsersAction>(
  { generate: () => ({ type: 'loadStarted' }) },
  arb.map(
    arb.array(
      {
        generate: (rng) => ({
          name: sampleNameArb.generate(rng),
          role: sampleRoleArb.generate(rng),
        }),
      },
      { maxLength: 8 }
    ),
    (users) => ({ type: 'loadSucceeded', users })
  ),
  arb.map(arb.string({ minLength: 1, maxLength: 20 }), (message) => ({
    type: 'loadFailed',
    message,
  })),
  {
    generate: (rng) => ({
      type: 'addUser',
      candidate: {
        name: sampleNameArb.generate(rng),
        role: sampleRoleArb.generate(rng),
      },
    }),
  }
);

describe('UsersState machine properties', () => {
  test('all formal invariants hold across arbitrary sequences of load and addUser actions', () => {
    assertProperty(
      arb.array(usersActionArb, { maxLength: 40 }),
      (actions) => {
        let state = createInitialUsersState();
        assert.deepStrictEqual(checkUsersInvariants(state), []);

        for (const action of actions) {
          const prevUsers = state.users;
          const result = transitionUsers(state, action);
          state = result.state;

          const violations = checkUsersInvariants(state);
          assert.deepStrictEqual(
            violations,
            [],
            `Invariant violated after ${JSON.stringify(action)}: ${violations.join('; ')}`
          );

          if (result.validationError.length > 0) {
            assert.deepStrictEqual(state.users, prevUsers);
          }
        }
      },
      { numRuns: 300, seed: 2001 }
    );
  });

  test('adding an already-existing name (ignoring case and surrounding whitespace) is always rejected', () => {
    assertProperty(
      arb.constantFrom(...USER_ROLE_OPTIONS),
      (role) => {
        const seeded = transitionUsers(createInitialUsersState(), {
          type: 'addUser',
          candidate: { name: 'Ada', role },
        });
        assert.strictEqual(seeded.validationError, '');

        for (const variant of ['ada', 'ADA', '  Ada  ', 'aDa']) {
          const error = validateUser(
            { name: variant, role },
            seeded.state.users
          );
          assert.match(error, /already in the list/);

          const rejected = transitionUsers(seeded.state, {
            type: 'addUser',
            candidate: { name: variant, role },
          });
          assert.strictEqual(rejected.state, seeded.state);
          assert.strictEqual(rejected.validationError, error);
        }
      },
      { numRuns: 50, seed: 2002 }
    );
  });
});
