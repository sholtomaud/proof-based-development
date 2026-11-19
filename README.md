# proof-based-development

A **Boba** web application scaffolded for **Proof- & Constraint-Driven Development**—combining native Web Components, strict TypeScript, minimal third-party dependencies, and a deterministic 4-tier verification pipeline.

## Verification Pipeline (`npm run verify`)

Every change is verified by a single deterministic command:

```bash
npm run verify
```

| Tier | Command | What It Proves |
| --- | --- | --- |
| **1. Static & Escape-Hatch Checks** | `npm run typecheck && npm run lint` | Strict TypeScript across `src/`, `scripts/`, `tests/`, `e2e/`; `oxlint --deny-warnings` banning `any`, type assertions (`as`), non-null assertions (`!`), and `@ts-*` comments; `scripts/check-rules.ts` banning all lint/type suppression directives, DOM globals in `src/domain/`, and unmapped E2E specs; Prettier formatting. |
| **2. Architectural Boundaries** | `npm run arch:check` | Zero-dependency graph verifier (`scripts/arch-check.ts`) enforcing strict isolation between `src/shared/`, `src/domain/`, `src/server/`, `src/services/`, `src/core/`, and `src/components/`, zero circular dependencies, and explicit `.ts` import extensions. |
| **3. Unit & Property-Based Invariant Proofs** | `npm run test:unit && npm run test:properties` | Native `node --test` execution of unit tests and deterministic, shrinking property-based proofs (`tests/lib/property.ts` + `tests/properties/*.prop.test.ts`) verifying state-machine invariants across hundreds of generated action sequences. |
| **4. Runtime & Visual Proofs** | `npm run test:e2e` | Playwright tests grounded in `tests/feature-map.ts` with an automatic zero-error fixture (`e2e/fixtures.ts`: zero `pageerror`, zero `console.error`, zero unexpected HTTP/network failures). Records `video: 'on'`, `trace: 'on'`, and `screenshot: 'on'` even on passing builds; uploaded as PR artifacts in `.github/workflows/verify.yml`. |

## Directory Architecture

```text
src/
  shared/        # Pure domain types & runtime type guards
  domain/        # Pure, framework-agnostic state machines & invariants
  server/        # Isolated server handlers (forbidden from client imports)
  services/      # DOM-free client I/O adapters
  core/          # Boba primitives (BaseComponent, Store, Router)
  components/    # Boba Web Components (.ts, .html, .css)
  main.ts        # Entry point & route registration
scripts/
  arch-check.ts  # Architectural boundary & cycle verifier (+ unit tests)
  check-rules.ts # Suppression-comment, domain-purity & FeatureMap verifier (+ unit tests)
  boba.ts        # Boba generator CLI & MCP server (+ unit tests)
tests/
  feature-map.ts # Single typed source of truth for routes & data-testid selectors
  lib/           # Zero-dependency deterministic property-based testing engine
  properties/    # Property-based invariant proofs for src/domain/
e2e/
  fixtures.ts    # Zero-runtime/console/network-error Playwright fixture
  *.spec.ts      # FeatureMap-driven runtime & visual proof specs
```

## Quick Start

```bash
npm ci
npm run verify
npm run dev
```

See [AGENTS.md](./AGENTS.md) for the complete operating model and feature implementation workflow.