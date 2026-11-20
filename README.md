# proof-based-development

**Live Proof Dashboard (GitHub Pages):** https://sholtomaud.github.io/proof-based-development/

- **Interactive 4-Tier Proof Report:** https://sholtomaud.github.io/proof-based-development/proofs
- **Playwright HTML Report (Videos, Screenshots & Traces):** https://sholtomaud.github.io/proof-based-development/playwright-report/

A **Boba** web application scaffolded for **Proof- & Constraint-Driven Development**—combining native Web Components, strict TypeScript, minimal third-party dependencies, a deterministic 4-tier verification pipeline, and a live Boba-powered Proof Reporting website automatically deployed via GitHub Pages Actions.

## Verification Pipeline (`npm run verify`)

Every change is verified by a single deterministic command:

```bash
npm run verify
```

| Tier | Command | What It Proves |
| --- | --- | --- |
| **0. Cryptographic Integrity Seal & Tamper Gate** | `npm run proof:check` | Verifies SHA-256 hashes of all verification harness files and existing tests (`proof-lock.json`), verifies the hash-chained attestation ledger (`PROOF_CHANGELOG.md`), bans `.only`/unconditional `.skip`, and enforces monotonic test-count floors + skip ceiling. On PRs, CI verifies against **`origin/main:proof-lock.json`** so an agent cannot forge the lockfile to hide test or harness edits. Protected by `.github/CODEOWNERS`. |
| **1. Static & Escape-Hatch Checks** | `npm run typecheck && npm run lint` | Strict TypeScript across `src/`, `scripts/`, `tests/`, `e2e/`; `oxlint --deny-warnings` banning `any`, type assertions (`as`), non-null assertions (`!`), and `@ts-*` comments; `scripts/check-rules.ts` banning all lint/type suppression directives, DOM globals in `src/domain/`, and unmapped E2E specs; Prettier formatting. |
| **2. Architectural Boundaries** | `npm run arch:check` | Zero-dependency graph verifier (`scripts/arch-check.ts`) enforcing strict isolation between `src/shared/`, `src/domain/`, `src/server/`, `src/services/`, `src/core/`, and `src/components/`, zero circular dependencies, and explicit `.ts` import extensions. |
| **3. Unit & Property-Based Invariant Proofs** | `npm run test:unit && npm run test:properties` | Native `node --test` execution of unit tests and deterministic, shrinking property-based proofs (`tests/lib/property.ts` + `tests/properties/*.prop.test.ts`) verifying state-machine invariants across hundreds of generated action sequences. |
| **4. Runtime & Visual Proofs** | `npm run test:e2e` | Playwright tests grounded in `tests/feature-map.ts` with an automatic zero-error fixture (`e2e/fixtures.ts`: zero `pageerror`, zero `console.error`, zero unexpected HTTP/network failures). Records `video: 'on'`, `trace: 'on'`, and `screenshot: 'on'` even on passing builds; published live to GitHub Pages and uploaded as PR artifacts in `.github/workflows/verify.yml`. |

## Directory Architecture

```text
src/
  shared/        # Pure domain types & runtime type guards (contracts + proof-report schema)
  domain/        # Pure, framework-agnostic state machines & invariants (todo, users, proof dashboard)
  server/        # Isolated server handlers (forbidden from client imports)
  services/      # DOM-free client I/O adapters
  core/          # Boba primitives (BaseComponent, Store, Router)
  components/    # Boba Web Components (.ts, .html, .css) including the live Proof Dashboard
  main.ts        # Entry point & route registration
scripts/
  arch-check.ts            # Architectural boundary & cycle verifier (+ unit tests)
  check-rules.ts           # Suppression-comment, domain-purity & FeatureMap verifier (+ unit tests)
  generate-proof-report.ts # Collects 4-tier telemetry & bundles Playwright media (+ unit tests)
  boba.ts                  # Boba generator CLI & MCP server (+ unit tests)
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
npm run report
npm run dev
```

See [AGENTS.md](./AGENTS.md) for the complete operating model and feature implementation workflow.