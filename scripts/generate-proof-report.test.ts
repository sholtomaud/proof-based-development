import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parsePlaywrightJson,
  parseTapOutput,
  renderMarkdownSummary,
} from './generate-proof-report.ts';
import type { ProofReport } from '../src/shared/proof-report.ts';

describe('generate-proof-report helpers', () => {
  test('parseTapOutput extracts pass, fail, skip counts, duration, and test names', () => {
    const sampleTap = [
      'TAP version 13',
      '    ok 1 - passes for valid layered imports',
      '    ok 2 - detects circular dependencies',
      '    not ok 3 - fails on violation',
      '# tests 3',
      '# pass 2',
      '# fail 1',
      '# skipped 0',
      '# duration_ms 42.7',
    ].join('\n');

    const parsed = parseTapOutput(sampleTap);
    assert.strictEqual(parsed.passed, 2);
    assert.strictEqual(parsed.failed, 1);
    assert.strictEqual(parsed.skipped, 0);
    assert.strictEqual(parsed.durationMs, 43);
    assert.deepStrictEqual(parsed.testNames, [
      'passes for valid layered imports',
      'detects circular dependencies',
      'fails on violation',
    ]);
  });

  test('parsePlaywrightJson aggregates per-project counts and media metadata', () => {
    const fakePlaywright = {
      suites: [
        {
          title: 'app.spec.ts',
          file: 'app.spec.ts',
          specs: [
            {
              title: 'has title',
              file: 'app.spec.ts',
              tests: [
                {
                  projectName: 'chromium',
                  status: 'expected',
                  results: [
                    { status: 'passed', duration: 312.4, attachments: [] },
                  ],
                },
                {
                  projectName: 'production',
                  status: 'skipped',
                  results: [
                    { status: 'skipped', duration: 0, attachments: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parsePlaywrightJson(fakePlaywright);
    assert.strictEqual(parsed.passed, 1);
    assert.strictEqual(parsed.failed, 0);
    assert.strictEqual(parsed.skipped, 1);
    assert.strictEqual(parsed.durationMs, 312);
    assert.strictEqual(parsed.checks.length, 2);
    assert.strictEqual(parsed.media.length, 2);
    assert.strictEqual(parsed.media[0].project, 'chromium');
    assert.strictEqual(parsed.media[0].status, 'passed');
  });

  test('renderMarkdownSummary includes status, counts, and Pages URL', () => {
    const report: ProofReport = {
      schemaVersion: 1,
      overallStatus: 'passed',
      totalPassed: 50,
      totalFailed: 0,
      totalSkipped: 1,
      totalDurationMs: 1200,
      build: {
        commit: 'abcdef1234567',
        shortCommit: 'abcdef1',
        branch: 'main',
        generatedAt: '2026-11-19T12:00:00.000Z',
        nodeVersion: 'v24.22.3',
        commitUrl: '',
        runUrl: '',
        repoUrl: '',
        playwrightReportUrl: 'playwright-report/index.html',
      },
      tiers: [
        {
          tier: 1,
          id: 'static',
          title: 'Static',
          subtitle: '',
          status: 'passed',
          passedCount: 4,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 100,
          checks: [],
        },
      ],
      architecture: {
        totalModules: 10,
        totalEdges: 12,
        cycles: 0,
        violations: 0,
        layers: [],
        rules: [],
      },
      e2eMedia: [],
      integrity: {
        status: 'intact',
        rootSha256: 'deadbeef0123456789abcdef',
        harnessFileCount: 10,
        testFileCount: 14,
        metricFloors: {
          minUnitTests: 39,
          minPropertyTests: 12,
          minE2ETests: 31,
          minArchRules: 10,
          maxSkippedTests: 1,
        },
        lockedFiles: [],
        changelogChainValid: true,
        changelogEntries: [],
      },
    };

    const md = renderMarkdownSummary(
      report,
      'https://sholtomaud.github.io/proof-based-development/'
    );
    assert.match(md, /Proof-Based Verification Report \(PASS\)/);
    assert.match(md, /SEAL INTACT/);
    assert.match(md, /abcdef1/);
    assert.match(
      md,
      /https:\/\/sholtomaud\.github\.io\/proof-based-development\//
    );
  });
});
