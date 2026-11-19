import { test, describe } from 'node:test';
import assert from 'node:assert';
import { arb, assertProperty, type Arbitrary } from '../lib/property.ts';
import {
  PROOF_TIER_IDS,
  type ProofReport,
} from '../../src/shared/proof-report.ts';
import {
  checkProofDashboardInvariants,
  createInitialProofDashboardState,
  selectOverallPassRate,
  selectVisibleMedia,
  selectVisibleTiers,
  transitionProofDashboard,
  type ProofDashboardAction,
  type TierFilter,
} from '../../src/domain/proof-report-machine.ts';

function sampleReport(projects: readonly string[]): ProofReport {
  return {
    schemaVersion: 1,
    overallStatus: 'passed',
    totalPassed: 42,
    totalFailed: 0,
    totalSkipped: 1,
    totalDurationMs: 1200,
    build: {
      commit: '0123456789abcdef',
      shortCommit: '0123456',
      branch: 'main',
      generatedAt: '2026-11-19T12:00:00.000Z',
      nodeVersion: 'v24.22.3',
      commitUrl: 'https://github.com/sholtomaud/proof-based-development',
      runUrl: '',
      repoUrl: 'https://github.com/sholtomaud/proof-based-development',
      playwrightReportUrl: 'playwright-report/index.html',
    },
    tiers: [
      {
        tier: 1,
        id: 'static',
        title: 'Static & Escape Hatches',
        subtitle: 'TypeScript + Oxlint + static rules',
        status: 'passed',
        passedCount: 4,
        failedCount: 0,
        skippedCount: 0,
        durationMs: 200,
        checks: [
          {
            id: 'typecheck',
            name: 'TypeScript strict check',
            status: 'passed',
            durationMs: 100,
            summary: '0 errors',
            command: 'npm run typecheck',
            details: ['Checked 40 files'],
          },
        ],
      },
      {
        tier: 2,
        id: 'architecture',
        title: 'Architectural Boundaries',
        subtitle: 'Layer isolation',
        status: 'passed',
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        durationMs: 50,
        checks: [
          {
            id: 'arch',
            name: 'Boundary graph',
            status: 'passed',
            durationMs: 50,
            summary: '0 violations',
            command: 'npm run arch:check',
            details: ['0 cycles'],
          },
        ],
      },
      {
        tier: 3,
        id: 'properties',
        title: 'Unit & Property Proofs',
        subtitle: 'State machines',
        status: 'passed',
        passedCount: 30,
        failedCount: 0,
        skippedCount: 0,
        durationMs: 450,
        checks: [
          {
            id: 'props',
            name: 'Todo invariants',
            status: 'passed',
            durationMs: 30,
            summary: 'All passed',
            command: 'npm run test:properties',
            details: ['300 runs'],
          },
        ],
      },
      {
        tier: 4,
        id: 'e2e',
        title: 'Runtime & Visual Proofs',
        subtitle: 'Playwright',
        status: 'passed',
        passedCount: 7,
        failedCount: 0,
        skippedCount: 1,
        durationMs: 500,
        checks: [],
      },
    ],
    architecture: {
      totalModules: 14,
      totalEdges: 22,
      cycles: 0,
      violations: 0,
      layers: [],
      rules: ['pure-domain-core'],
    },
    e2eMedia: projects.map((project, index) => ({
      id: `${project}-${index}`,
      title: `proof flow ${index}`,
      project,
      file: 'e2e/app.spec.ts',
      status: 'passed',
      durationMs: 120,
      videoPath: `proof-media/${project}-${index}/video.webm`,
      screenshotPath: `proof-media/${project}-${index}/screenshot.png`,
      tracePath: `proof-media/${project}-${index}/trace.zip`,
    })),
  };
}

const tierFilterArb: Arbitrary<TierFilter> = arb.constantFrom(
  'all',
  ...PROOF_TIER_IDS
);

const projectArb: Arbitrary<string> = arb.constantFrom(
  'all',
  'chromium',
  'production',
  'firefox',
  'webkit',
  'subpath',
  'nonexistent',
  '   '
);

const dashboardActionArb: Arbitrary<ProofDashboardAction> =
  arb.oneOf<ProofDashboardAction>(
    { generate: () => ({ type: 'loadStarted' }) },
    arb.map(
      arb.array(
        arb.constantFrom('chromium', 'production', 'firefox', 'subpath'),
        { minLength: 0, maxLength: 5 }
      ),
      (projects) => ({
        type: 'loadSucceeded',
        report: sampleReport(projects),
      })
    ),
    arb.map(arb.string({ minLength: 0, maxLength: 20 }), (message) => ({
      type: 'loadFailed',
      message,
    })),
    arb.map(tierFilterArb, (tier) => ({ type: 'selectTier', tier })),
    arb.map(projectArb, (project) => ({ type: 'selectProject', project })),
    arb.map(
      arb.oneOf(
        arb.constantFrom('', 'typecheck', 'chromium', 'flow', '   ', 'zzz'),
        arb.string({ minLength: 0, maxLength: 10 })
      ),
      (query) => ({ type: 'setSearchQuery', query })
    )
  );

describe('ProofDashboard state machine properties', () => {
  test('all formal invariants hold across arbitrary UI action sequences', () => {
    assertProperty(
      arb.array(dashboardActionArb, { maxLength: 40 }),
      (actions) => {
        let state = createInitialProofDashboardState();
        assert.deepStrictEqual(checkProofDashboardInvariants(state), []);

        for (const action of actions) {
          state = transitionProofDashboard(state, action);
          const violations = checkProofDashboardInvariants(state);
          assert.deepStrictEqual(
            violations,
            [],
            `Invariant violated after ${JSON.stringify(action)}: ${violations.join('; ')}`
          );
        }
      },
      { numRuns: 250, seed: 3001 }
    );
  });

  test('filtering by a specific tier never returns tiers outside that selection', () => {
    assertProperty(
      arb.constantFrom(...PROOF_TIER_IDS),
      (tierId) => {
        const loaded = transitionProofDashboard(
          createInitialProofDashboardState(),
          {
            type: 'loadSucceeded',
            report: sampleReport(['chromium', 'production']),
          }
        );
        const filtered = transitionProofDashboard(loaded, {
          type: 'selectTier',
          tier: tierId,
        });
        const visible = selectVisibleTiers(filtered);
        assert.ok(visible.every((tier) => tier.id === tierId));
      },
      { numRuns: 50, seed: 3002 }
    );
  });

  test('pass rate is bounded in [0, 100] for all non-negative passed/failed counts', () => {
    assertProperty(
      {
        generate: (rng) => ({
          passed: rng.int(0, 500),
          failed: rng.int(0, 500),
        }),
      },
      ({ passed, failed }) => {
        const base = sampleReport(['chromium']);
        const rate = selectOverallPassRate({
          ...base,
          totalPassed: passed,
          totalFailed: failed,
        });
        assert.ok(rate >= 0 && rate <= 100);
        if (failed === 0) assert.strictEqual(rate, 100);
        if (passed === 0 && failed > 0) assert.strictEqual(rate, 0);
      },
      { numRuns: 200, seed: 3003 }
    );
  });

  test('media project filter always returns only matching project items', () => {
    assertProperty(
      arb.constantFrom('chromium', 'production', 'subpath'),
      (project) => {
        const loaded = transitionProofDashboard(
          createInitialProofDashboardState(),
          {
            type: 'loadSucceeded',
            report: sampleReport(['chromium', 'production', 'subpath']),
          }
        );
        const filtered = transitionProofDashboard(loaded, {
          type: 'selectProject',
          project,
        });
        const media = selectVisibleMedia(filtered);
        assert.ok(media.length > 0);
        assert.ok(media.every((item) => item.project === project));
      },
      { numRuns: 50, seed: 3004 }
    );
  });
});
