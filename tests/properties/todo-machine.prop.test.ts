import { test, describe } from 'node:test';
import assert from 'node:assert';
import { arb, assertProperty, type Arbitrary } from '../lib/property.ts';
import { TODO_FILTERS } from '../../src/shared/contracts.ts';
import {
  checkTodoInvariants,
  createInitialTodoState,
  parsePersistedTodoState,
  selectFilteredTasks,
  selectTodoCounts,
  transitionTodo,
  type TodoAction,
} from '../../src/domain/todo-machine.ts';

const todoActionArb: Arbitrary<TodoAction> = arb.oneOf<TodoAction>(
  arb.map(arb.string({ minLength: 0, maxLength: 24 }), (text) => ({
    type: 'add',
    text,
  })),
  arb.map(arb.integer(-2, 15), (id) => ({
    type: 'toggle',
    id,
  })),
  arb.map(arb.integer(-2, 15), (id) => ({
    type: 'delete',
    id,
  })),
  arb.map(arb.constantFrom(...TODO_FILTERS), (filter) => ({
    type: 'setFilter',
    filter,
  })),
  { generate: () => ({ type: 'clearCompleted' }) }
);

const malformedPayloadArb: Arbitrary<unknown> = arb.oneOf<unknown>(
  arb.constantFrom(null, undefined, 42, 'corrupted', [], {}),
  arb.map(
    arb.array(
      arb.oneOf<unknown>(arb.constantFrom(null, 'bad', 123, {}), {
        generate: (rng) => ({
          id: rng.int(-3, 5),
          text: rng.int(0, 1) === 0 ? '   ' : ` Task ${rng.int(1, 5)} `,
          completed: rng.int(0, 1) === 1,
        }),
      }),
      { maxLength: 10 }
    ),
    (tasks) => ({ tasks, filter: 'invalid-filter' })
  )
);

describe('TodoState machine properties', () => {
  test('all formal invariants hold after every transition in arbitrary action sequences', () => {
    assertProperty(
      arb.array(todoActionArb, { maxLength: 40 }),
      (actions) => {
        let state = createInitialTodoState();
        assert.deepStrictEqual(checkTodoInvariants(state), []);

        for (const action of actions) {
          state = transitionTodo(state, action);
          const violations = checkTodoInvariants(state);
          assert.deepStrictEqual(
            violations,
            [],
            `Invariant violated after ${JSON.stringify(action)}: ${violations.join('; ')}`
          );
        }
      },
      { numRuns: 300, seed: 1001 }
    );
  });

  test('toggling any task twice restores the exact original state', () => {
    assertProperty(
      arb.array(todoActionArb, { maxLength: 20 }),
      (setupActions) => {
        let state = createInitialTodoState();
        for (const action of setupActions) {
          state = transitionTodo(state, action);
        }
        for (const task of state.tasks) {
          const toggledOnce = transitionTodo(state, {
            type: 'toggle',
            id: task.id,
          });
          const toggledTwice = transitionTodo(toggledOnce, {
            type: 'toggle',
            id: task.id,
          });
          assert.deepStrictEqual(toggledTwice, state);
        }
      },
      { numRuns: 200, seed: 1002 }
    );
  });

  test('clearCompleted removes all completed tasks and preserves every active task in order', () => {
    assertProperty(
      arb.array(todoActionArb, { maxLength: 30 }),
      (actions) => {
        let state = createInitialTodoState();
        for (const action of actions) {
          state = transitionTodo(state, action);
        }
        const activeBefore = state.tasks.filter((task) => !task.completed);
        const cleared = transitionTodo(state, { type: 'clearCompleted' });

        assert.strictEqual(selectTodoCounts(cleared).completed, 0);
        assert.deepStrictEqual(cleared.tasks, activeBefore);
        assert.deepStrictEqual(checkTodoInvariants(cleared), []);
      },
      { numRuns: 200, seed: 1003 }
    );
  });

  test('adding a blank or whitespace-only task is always a no-op', () => {
    assertProperty(
      arb.string({ minLength: 0, maxLength: 10, alphabet: ' \t\n' }),
      (blankText) => {
        const initial = createInitialTodoState();
        const next = transitionTodo(initial, { type: 'add', text: blankText });
        assert.strictEqual(next, initial);
      },
      { numRuns: 100, seed: 1004 }
    );
  });

  test('adding a non-blank task then deleting its assigned id leaves task list unchanged', () => {
    assertProperty(
      arb.string({ minLength: 1, maxLength: 20, alphabet: 'abcXYZ123 ' }),
      (rawText) => {
        const trimmed = rawText.trim();
        if (trimmed.length === 0) return;

        const initial = createInitialTodoState();
        const assignedId = initial.nextTaskId;
        const afterAdd = transitionTodo(initial, {
          type: 'add',
          text: rawText,
        });

        assert.strictEqual(afterAdd.tasks.length, initial.tasks.length + 1);
        assert.strictEqual(afterAdd.nextTaskId, assignedId + 1);
        assert.ok(
          selectFilteredTasks(afterAdd).some(
            (task) => task.id === assignedId && task.text === trimmed
          )
        );

        const afterDelete = transitionTodo(afterAdd, {
          type: 'delete',
          id: assignedId,
        });
        assert.deepStrictEqual(afterDelete.tasks, initial.tasks);
      },
      { numRuns: 200, seed: 1005 }
    );
  });

  test('hydrating arbitrary untrusted storage payloads always produces a valid TodoState', () => {
    assertProperty(
      malformedPayloadArb,
      (payload) => {
        const hydrated = parsePersistedTodoState(payload);
        assert.strictEqual(hydrated.filter, 'all');
        assert.deepStrictEqual(checkTodoInvariants(hydrated), []);
      },
      { numRuns: 250, seed: 1006 }
    );
  });
});
