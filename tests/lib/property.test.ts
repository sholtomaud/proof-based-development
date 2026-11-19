import { test, describe } from 'node:test';
import assert from 'node:assert';
import { arb, assertProperty } from './property.ts';

describe('property testing engine', () => {
  test('passes when invariant always holds', () => {
    assertProperty(arb.array(arb.integer(-50, 50)), (values) => {
      const reversedTwice = [...values].reverse().reverse();
      assert.deepStrictEqual(reversedTwice, values);
    });
  });

  test('finds and shrinks a counterexample deterministically', () => {
    let errorMessage = '';
    try {
      assertProperty(
        arb.array(arb.integer(0, 100), { maxLength: 20 }),
        (values) => !values.some((n) => n >= 10),
        { seed: 42, numRuns: 100 }
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    assert.match(errorMessage, /seed=42/);
    // Shrinking should reduce the failing array to a single element [10]
    assert.match(errorMessage, /Counterexample: \[10\]/);
  });
});
