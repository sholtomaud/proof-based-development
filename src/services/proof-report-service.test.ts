import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  fetchProofReport,
  type FetchProofReportTransport,
} from './proof-report-service.ts';
import type { ProofReport } from '../shared/proof-report.ts';

const validReport: ProofReport = {
  schemaVersion: 1,
  overallStatus: 'passed',
  totalPassed: 10,
  totalFailed: 0,
  totalSkipped: 0,
  totalDurationMs: 250,
  build: {
    commit: 'abc123456789',
    shortCommit: 'abc1234',
    branch: 'main',
    generatedAt: '2026-11-19T12:00:00.000Z',
    nodeVersion: 'v24.22.3',
    commitUrl: '',
    runUrl: '',
    repoUrl: '',
    playwrightReportUrl: '',
  },
  tiers: [],
  architecture: {
    totalModules: 5,
    totalEdges: 6,
    cycles: 0,
    violations: 0,
    layers: [],
    rules: [],
  },
  e2eMedia: [],
  integrity: {
    status: 'intact',
    rootSha256: 'deadbeef',
    harnessFileCount: 10,
    testFileCount: 12,
    metricFloors: {
      minUnitTests: 10,
      minPropertyTests: 4,
      minE2ETests: 5,
      minArchRules: 8,
      maxSkippedTests: 1,
    },
    lockedFiles: [],
    changelogChainValid: true,
    changelogEntries: [],
  },
};

describe('proof-report-service', () => {
  test('fetchProofReport returns validated ProofReport from data/proof-report.json', async () => {
    const stub: FetchProofReportTransport = async (url) => {
      assert.strictEqual(url, 'data/proof-report.json');
      return Response.json(validReport);
    };
    assert.deepStrictEqual(await fetchProofReport(stub), validReport);
  });

  test('fetchProofReport rejects on HTTP error', async () => {
    const stub: FetchProofReportTransport = async () =>
      new Response('', { status: 404 });
    await assert.rejects(fetchProofReport(stub), /HTTP 404/);
  });

  test('fetchProofReport rejects on malformed payload', async () => {
    const stub: FetchProofReportTransport = async () =>
      Response.json({ broken: true });
    await assert.rejects(fetchProofReport(stub), /invalid report schema/);
  });
});
