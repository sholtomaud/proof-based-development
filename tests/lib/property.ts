// Minimal, zero-dependency, deterministic property-based testing library with
// shrinking. Runs directly under `node --test` with native TypeScript stripping.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number): number {
      if (max <= min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}

export interface Arbitrary<T> {
  generate(rng: Rng): T;
  shrink?(value: T): Iterable<T>;
}

const DEFAULT_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_';

function* shrinkNumber(value: number, min: number): Iterable<number> {
  const target = min > 0 ? min : 0;
  if (value === target) return;
  const seen = new Set<number>([value]);
  const emit = (candidate: number): number | null => {
    if (seen.has(candidate)) return null;
    seen.add(candidate);
    return candidate;
  };

  const first = emit(target);
  if (first !== null) yield first;

  let diff = value - target;
  while (Math.abs(diff) > 1) {
    diff = Math.trunc(diff / 2);
    const candidate = emit(value - diff);
    if (candidate !== null) yield candidate;
  }

  const step = emit(value - Math.sign(value - target));
  if (step !== null) yield step;
}

function* shrinkArray<T>(
  value: readonly T[],
  shrinkItem?: (item: T) => Iterable<T>
): Iterable<T[]> {
  if (value.length === 0) return;
  yield [];
  if (value.length > 1) {
    const half = Math.floor(value.length / 2);
    yield value.slice(0, half);
    yield value.slice(half);
  }
  for (let i = 0; i < value.length; i += 1) {
    yield [...value.slice(0, i), ...value.slice(i + 1)];
  }
  if (shrinkItem) {
    for (let i = 0; i < value.length; i += 1) {
      for (const smaller of shrinkItem(value[i])) {
        yield [...value.slice(0, i), smaller, ...value.slice(i + 1)];
      }
    }
  }
}

export const arb = {
  integer(min = -100, max = 100): Arbitrary<number> {
    return {
      generate: (rng) => rng.int(min, max),
      shrink: (value) => shrinkNumber(value, min),
    };
  },

  boolean(): Arbitrary<boolean> {
    return {
      generate: (rng) => rng.int(0, 1) === 1,
      shrink: function* (value) {
        if (value) yield false;
      },
    };
  },

  string(options?: {
    minLength?: number;
    maxLength?: number;
    alphabet?: string;
  }): Arbitrary<string> {
    const minLength = options?.minLength ?? 0;
    const maxLength = options?.maxLength ?? 20;
    const alphabet = options?.alphabet ?? DEFAULT_ALPHABET;
    return {
      generate(rng) {
        const length = rng.int(minLength, maxLength);
        let out = '';
        for (let i = 0; i < length; i += 1) {
          out += alphabet[rng.int(0, alphabet.length - 1)];
        }
        return out;
      },
      shrink: function* (value) {
        if (value.length <= minLength) return;
        if (minLength === 0) yield '';
        if (value.length > minLength + 1) {
          yield value.slice(
            0,
            Math.max(minLength, Math.floor(value.length / 2))
          );
        }
        yield value.slice(0, value.length - 1);
      },
    };
  },

  constantFrom<const T extends readonly [unknown, ...unknown[]]>(
    ...values: T
  ): Arbitrary<T[number]> {
    return {
      generate: (rng) => values[rng.int(0, values.length - 1)],
    };
  },

  array<T>(
    itemArb: Arbitrary<T>,
    options?: { minLength?: number; maxLength?: number }
  ): Arbitrary<T[]> {
    const minLength = options?.minLength ?? 0;
    const maxLength = options?.maxLength ?? 25;
    return {
      generate(rng) {
        const length = rng.int(minLength, maxLength);
        const result: T[] = [];
        for (let i = 0; i < length; i += 1) {
          result.push(itemArb.generate(rng));
        }
        return result;
      },
      shrink: (value) => shrinkArray(value, itemArb.shrink),
    };
  },

  oneOf<T>(
    ...arbitraries: readonly [Arbitrary<T>, ...Arbitrary<T>[]]
  ): Arbitrary<T> {
    return {
      generate(rng) {
        const chosen = arbitraries[rng.int(0, arbitraries.length - 1)];
        return chosen.generate(rng);
      },
    };
  },

  map<A, B>(source: Arbitrary<A>, fn: (value: A) => B): Arbitrary<B> {
    return {
      generate: (rng) => fn(source.generate(rng)),
    };
  },
};

export interface PropertyOptions {
  readonly numRuns?: number;
  readonly seed?: number;
  readonly maxShrinkSteps?: number;
}

function tryPredicate<T>(
  predicate: (value: T) => boolean | void,
  value: T
): { ok: true } | { ok: false; reason: string } {
  try {
    const result = predicate(value);
    if (result === false) {
      return { ok: false, reason: 'Predicate returned false' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Executes `predicate` across `numRuns` deterministic generated inputs.
 * On the first failure, shrinks to a minimal counterexample and throws with
 * the exact seed and shrunk input for 100% deterministic reproduction.
 */
export function assertProperty<T>(
  arbitrary: Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  options?: PropertyOptions
): void {
  const numRuns = options?.numRuns ?? 200;
  const envSeed = process.env.PROP_SEED
    ? Number.parseInt(process.env.PROP_SEED, 10)
    : undefined;
  const seed =
    options?.seed ??
    (envSeed !== undefined && Number.isFinite(envSeed) ? envSeed : 0x5eed1234);
  const maxShrinkSteps = options?.maxShrinkSteps ?? 200;
  const rng = createRng(seed);

  for (let run = 0; run < numRuns; run += 1) {
    const sample = arbitrary.generate(rng);
    const outcome = tryPredicate(predicate, sample);
    if (outcome.ok) continue;

    let minimal = sample;
    let minimalReason = outcome.reason;
    let steps = 0;

    if (arbitrary.shrink) {
      let improved = true;
      while (improved && steps < maxShrinkSteps) {
        improved = false;
        for (const candidate of arbitrary.shrink(minimal)) {
          steps += 1;
          const candidateOutcome = tryPredicate(predicate, candidate);
          if (!candidateOutcome.ok) {
            minimal = candidate;
            minimalReason = candidateOutcome.reason;
            improved = true;
            break;
          }
          if (steps >= maxShrinkSteps) break;
        }
      }
    }

    throw new Error(
      [
        `Property failed on run ${run + 1}/${numRuns} (seed=${seed}, shrinkSteps=${steps})`,
        `Reason: ${minimalReason}`,
        `Counterexample: ${JSON.stringify(minimal)}`,
      ].join('\n')
    );
  }
}
