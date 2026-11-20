# AGENTS.md — Proof- & Constraint-Driven Development Operating Model

You are building a web application on the **Boba** framework (native Web Components + strict TypeScript + minimal third-party dependencies). Do not rely on memory, prose comments, or manual spot-checks to ensure quality. Every change must pass the deterministic 4-tier verification pipeline (`npm run verify`) before you declare a task finished.

## 1. Obey Architectural Constraints Over Prose

### Directory Boundaries (Enforced by `npm run arch:check`)

| Directory | Purpose | Allowed Imports |
| --- | --- | --- |
| `src/shared/` | Pure domain types and runtime type guards | Only `src/shared/` |
| `src/domain/` | Pure, framework-agnostic state machines, reducers, and formal invariants | `src/domain/`, `src/shared/` (zero DOM/browser globals, zero UI/core/server imports) |
| `src/server/` | Server/backend handlers & server-only logic | `src/server/`, `src/domain/`, `src/shared/`, `node:*` |
| `src/services/` | DOM-free client I/O adapters (e.g., `fetch`) | `src/services/`, `src/domain/`, `src/shared/` |
| `src/core/` | Boba framework primitives (`BaseComponent`, `Store`, `Router`) | `src/core/` (router lazy-loads route components) |
| `src/components/` | Boba Web Components (`.ts`, `.html`, `.css`) | `src/core/`, `src/domain/`, `src/services/`, `src/shared/`, own `.html?raw`/`.css?raw` (no sibling component imports, no `src/server/`, no `node:*`) |

- **No circular dependencies** anywhere in `src/`.
- **Mandatory `.ts` extensions** on all relative TypeScript imports so Node.js native type stripping executes directly.
- **Minimal dependencies**: Keep the app lean—do not add third-party libraries when Node.js, TypeScript, or Web Platform APIs suffice.

### Zero Escape Hatches (Enforced by `npm run lint` & `npm run typecheck`)

- Never use `any`, unsafe type assertions (`as Type` — `as const` is allowed), non-null assertions (`!`), or suppression directives (`eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`).
- If a check blocks you, refactor the root type or architecture (e.g., `instanceof` narrowing, runtime type predicates in `src/shared/`, or cleaner state separation).

### Canonical Patterns

Before writing new code, inspect existing routes (`src/main.ts`), components (`src/components/*`), pure state machines (`src/domain/*`), property tests (`tests/properties/*`), and E2E proofs (`e2e/*`) and match their exact structure.

## 2. Express Critical Logic as State Machines & Invariants

- Isolate core stateful workflows into pure, framework-agnostic transition functions in `src/domain/`.
- Export an explicit `check<Feature>Invariants(state): string[]` function for every state machine.
- Verify invariants across arbitrary action sequences and edge cases using property-based tests in `tests/properties/*.prop.test.ts` (powered by the zero-dependency engine in `tests/lib/property.ts`).

## 3. Self-Verify via Runtime & Visual Proof

- Never finish a task after only reading code. Run `npm run verify` locally after edits.
- Maintain `tests/feature-map.ts` as the single typed source of truth for routes, `data-testid` selectors, and visible states. Update it whenever adding or changing a UI flow.
- Every E2E spec in `e2e/` must import `FeatureMap` from `tests/feature-map.ts` and `test`/`expect` from `e2e/fixtures.ts`, which automatically fails on any `pageerror`, `console.error`, or unexpected network/HTTP failure.
- Playwright records `video: 'on'`, `trace: 'on'`, and `screenshot: 'on'` on every run (passing or failing), uploaded as CI proof artifacts.

## 4. Turn Every Mistake Into a Deterministic Rule

Whenever a bug escapes or a review correction is made, do not add a note to markdown prose. Instead, codify a permanent check in one of:
- `scripts/arch-check.ts` (boundary / dependency graph rule + unit test in `scripts/arch-check.test.ts`)
- `scripts/check-rules.ts` (static anti-pattern rule + unit test in `scripts/check-rules.test.ts`)
- `.oxlintrc.json` / `tsconfig.json` (compiler/linter rule)
- `tests/properties/*.prop.test.ts` (domain invariant property test)

## 5. Never Tamper With Locked Tests or Verification Harness

- `proof-lock.json` pins SHA-256 digests of every verification harness file (Zone A), every existing test/spec file (Zone B), and monotonic metric floors (Zone C).
- **Adding new test files** is encouraged and passes `npm run proof:check` automatically.
- **Modifying or deleting existing locked tests or harness files** is blocked locally and in CI (where PRs are verified against `origin/main:proof-lock.json`, which cannot be forged from inside a PR). Only a human maintainer can authorize intentional spec/harness updates via `.github/CODEOWNERS` review + PR labels (`allow-test-change` / `allow-harness-change`), then re-sealing with `npm run proof:lock` and recording a hash-chained attestation in `PROOF_CHANGELOG.md` via `npm run proof:attest`.
- Never add `.only(...)` or unconditional `.skip(...)` directives to any test file.

## Feature Implementation Workflow

1. Model types/guards in `src/shared/` and pure state transitions + invariants in `src/domain/`.
2. Add new property-based tests in `tests/properties/` proving all invariants across arbitrary sequences.
3. Wire the Boba component (`src/components/<tag>/`), route (`src/main.ts`), and `data-testid` hooks.
4. Update `tests/feature-map.ts` (when adding new routes/controls) and add Playwright proof tests in `e2e/`.
5. Run `npm run verify` until every tier passes with zero warnings, an intact cryptographic seal, and recorded video/trace proof artifacts.
