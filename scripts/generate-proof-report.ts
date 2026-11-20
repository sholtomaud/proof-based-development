// Zero-dependency Proof Report generator.
// Executes or ingests all 4 verification tiers, writes public/data/proof-report.json
// for the Boba Proof Dashboard, optionally bundles Playwright videos/screenshots/traces
// for GitHub Pages deployment, and emits a Markdown summary for GitHub Actions.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeArchitecture } from './arch-check.ts';
import { checkRules } from './check-rules.ts';
import {
  appendProofChangelogEntry,
  loadAndVerifyProofChangelog,
} from './proof-changelog.ts';
import { loadLockfileFromDisk, verifyAgainstLock } from './proof-lock.ts';
import { isRecord } from '../src/shared/contracts.ts';
import type {
  ArchitectureReport,
  BoundaryLayerInfo,
  ProofBuildInfo,
  ProofCheckItem,
  ProofE2EMediaItem,
  ProofIntegrityReport,
  ProofReport,
  ProofStatus,
  ProofTier,
} from '../src/shared/proof-report.ts';

export interface TapSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly testNames: readonly string[];
}

export function parseTapOutput(tapText: string): TapSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;
  const testNames: string[] = [];

  for (const rawLine of tapText.split('\n')) {
    const line = rawLine.trim();
    const passMatch = line.match(/^# pass (\d+)$/);
    if (passMatch) {
      passed = Number.parseInt(passMatch[1], 10);
      continue;
    }
    const failMatch = line.match(/^# fail (\d+)$/);
    if (failMatch) {
      failed = Number.parseInt(failMatch[1], 10);
      continue;
    }
    const skipMatch = line.match(/^# skipped (\d+)$/);
    if (skipMatch) {
      skipped = Number.parseInt(skipMatch[1], 10);
      continue;
    }
    const durationMatch = line.match(/^# duration_ms ([0-9.]+)$/);
    if (durationMatch) {
      durationMs = Math.round(Number.parseFloat(durationMatch[1]));
      continue;
    }
    const subtestMatch = line.match(/^(ok|not ok) \d+ - (.+)$/);
    if (subtestMatch && !line.includes('# SKIP')) {
      testNames.push(subtestMatch[2]);
    }
  }

  return { passed, failed, skipped, durationMs, testNames };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export interface ParsedPlaywrightSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly checks: readonly ProofCheckItem[];
  readonly media: readonly ProofE2EMediaItem[];
}

interface PlaywrightSpecEntry {
  readonly title: string;
  readonly file: string;
  readonly project: string;
  readonly status: ProofStatus;
  readonly durationMs: number;
  readonly attachments: readonly {
    readonly name: string;
    readonly path: string;
  }[];
}

function collectPlaywrightSpecs(
  suites: readonly unknown[],
  parentTitle: string,
  out: PlaywrightSpecEntry[]
): void {
  for (const suite of suites) {
    if (!isRecord(suite)) continue;
    const suiteTitle = typeof suite.title === 'string' ? suite.title : '';
    const file = typeof suite.file === 'string' ? suite.file : '';
    const nextTitle =
      parentTitle && suiteTitle && suiteTitle !== file
        ? `${parentTitle} › ${suiteTitle}`
        : suiteTitle && suiteTitle !== file
          ? suiteTitle
          : parentTitle;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!isRecord(spec) || !Array.isArray(spec.tests)) continue;
        const specTitle = typeof spec.title === 'string' ? spec.title : '';
        const fullTitle = nextTitle ? `${nextTitle} › ${specTitle}` : specTitle;
        const specFile =
          typeof spec.file === 'string' && spec.file.length > 0
            ? spec.file
            : file;

        for (const testItem of spec.tests) {
          if (!isRecord(testItem)) continue;
          const project =
            typeof testItem.projectName === 'string'
              ? testItem.projectName
              : 'chromium';
          const results = Array.isArray(testItem.results)
            ? testItem.results
            : [];
          const lastResult = results.at(-1);
          const rawStatus =
            isRecord(lastResult) && typeof lastResult.status === 'string'
              ? lastResult.status
              : typeof testItem.status === 'string'
                ? testItem.status
                : 'passed';
          const status: ProofStatus =
            rawStatus === 'passed' || rawStatus === 'expected'
              ? 'passed'
              : rawStatus === 'skipped'
                ? 'skipped'
                : 'failed';
          const durationMs =
            isRecord(lastResult) && typeof lastResult.duration === 'number'
              ? Math.round(lastResult.duration)
              : 0;

          const attachments: { name: string; path: string }[] = [];
          if (isRecord(lastResult) && Array.isArray(lastResult.attachments)) {
            for (const att of lastResult.attachments) {
              if (
                isRecord(att) &&
                typeof att.name === 'string' &&
                typeof att.path === 'string'
              ) {
                attachments.push({ name: att.name, path: att.path });
              }
            }
          }

          out.push({
            title: fullTitle,
            file: specFile,
            project,
            status,
            durationMs,
            attachments,
          });
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      collectPlaywrightSpecs(suite.suites, nextTitle, out);
    }
  }
}

export function parsePlaywrightJson(
  payload: unknown,
  bundleMediaDir?: string
): ParsedPlaywrightSummary {
  if (!isRecord(payload) || !Array.isArray(payload.suites)) {
    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      checks: [],
      media: [],
    };
  }

  const entries: PlaywrightSpecEntry[] = [];
  collectPlaywrightSpecs(payload.suites, '', entries);

  const byProject = new Map<
    string,
    {
      passed: number;
      failed: number;
      skipped: number;
      durationMs: number;
      details: string[];
    }
  >();

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDurationMs = 0;
  const media: ProofE2EMediaItem[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.status === 'passed') passed += 1;
    else if (entry.status === 'skipped') skipped += 1;
    else failed += 1;
    totalDurationMs += entry.durationMs;

    const bucket = byProject.get(entry.project) ?? {
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      details: [],
    };
    if (entry.status === 'passed') bucket.passed += 1;
    else if (entry.status === 'skipped') bucket.skipped += 1;
    else bucket.failed += 1;
    bucket.durationMs += entry.durationMs;
    bucket.details.push(`[${entry.status}] ${entry.title}`);
    byProject.set(entry.project, bucket);

    const id = `${slugify(entry.project)}-${slugify(entry.title)}-${i + 1}`;
    let videoPath = '';
    let screenshotPath = '';
    let tracePath = '';

    if (bundleMediaDir) {
      const targetDir = path.join(bundleMediaDir, id);
      const copyIfPresent = (sourcePath: string, targetName: string) => {
        if (!sourcePath || !fs.existsSync(sourcePath)) return '';
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(sourcePath, path.join(targetDir, targetName));
        return `proof-media/${id}/${targetName}`;
      };

      const videoAtt = entry.attachments.find((a) => a.name === 'video');
      const shotAtt = entry.attachments.find((a) => a.name === 'screenshot');
      const traceAtt = entry.attachments.find((a) => a.name === 'trace');

      if (videoAtt) videoPath = copyIfPresent(videoAtt.path, 'video.webm');
      if (shotAtt) {
        screenshotPath = copyIfPresent(shotAtt.path, 'screenshot.png');
      }
      if (traceAtt) tracePath = copyIfPresent(traceAtt.path, 'trace.zip');
    }

    media.push({
      id,
      title: entry.title,
      project: entry.project,
      file: entry.file,
      status: entry.status,
      durationMs: entry.durationMs,
      videoPath,
      screenshotPath,
      tracePath,
    });
  }

  const checks: ProofCheckItem[] = [];
  for (const [project, bucket] of byProject.entries()) {
    checks.push({
      id: `e2e-${slugify(project)}`,
      name: `Playwright (${project})`,
      status: bucket.failed > 0 ? 'failed' : 'passed',
      durationMs: bucket.durationMs,
      summary: `${bucket.passed} passed, ${bucket.failed} failed, ${bucket.skipped} skipped`,
      command: `npx playwright test --project=${project}`,
      details: bucket.details,
    });
  }

  return {
    passed,
    failed,
    skipped,
    durationMs: totalDurationMs,
    checks,
    media,
  };
}

function runCommandTimed(
  root: string,
  cmd: string,
  args: readonly string[]
): { ok: boolean; durationMs: number; output: string } {
  const start = performance.now();
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Math.round(performance.now() - start);
  const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
  return { ok: res.status === 0, durationMs, output };
}

function readGitValue(root: string, args: readonly string[]): string {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

const LAYER_METADATA: readonly {
  readonly layer: string;
  readonly directory: string;
  readonly purpose: string;
  readonly allowedImports: string;
}[] = [
  {
    layer: 'shared',
    directory: 'src/shared/',
    purpose: 'Pure domain types and runtime type guards',
    allowedImports: 'src/shared/ only',
  },
  {
    layer: 'domain',
    directory: 'src/domain/',
    purpose: 'Pure, framework-agnostic state machines & formal invariants',
    allowedImports: 'src/domain/, src/shared/ (zero DOM globals)',
  },
  {
    layer: 'server',
    directory: 'src/server/',
    purpose: 'Isolated backend handlers & server-only logic',
    allowedImports: 'src/server/, src/domain/, src/shared/, node:*',
  },
  {
    layer: 'services',
    directory: 'src/services/',
    purpose: 'DOM-free client I/O adapters (fetch)',
    allowedImports: 'src/services/, src/domain/, src/shared/',
  },
  {
    layer: 'core',
    directory: 'src/core/',
    purpose: 'Boba primitives (BaseComponent, Store, Router)',
    allowedImports: 'src/core/ (router lazy-loads route components)',
  },
  {
    layer: 'components',
    directory: 'src/components/',
    purpose: 'Boba Web Components (.ts, .html, .css)',
    allowedImports:
      'src/core/, src/domain/, src/services/, src/shared/, own ?raw assets',
  },
];

export function renderMarkdownSummary(
  report: ProofReport,
  pagesUrl?: string
): string {
  const icon = report.overallStatus === 'passed' ? 'PASS' : 'FAIL';
  const sealLabel =
    report.integrity.status === 'intact' && report.integrity.changelogChainValid
      ? `SEAL INTACT (\`${report.integrity.rootSha256.slice(0, 16)}…\`)`
      : `TAMPERED (\`${report.integrity.rootSha256.slice(0, 16)}…\`)`;
  const lines: string[] = [
    `# Proof-Based Verification Report (${icon})`,
    '',
    `- **Commit:** \`${report.build.shortCommit}\` (\`${report.build.branch}\`)`,
    `- **Cryptographic Proof Seal:** ${sealLabel} (${report.integrity.harnessFileCount} harness + ${report.integrity.testFileCount} test files locked)`,
    `- **Total Checks:** ${report.totalPassed} passed, ${report.totalFailed} failed, ${report.totalSkipped} skipped`,
    `- **Architecture:** ${report.architecture.totalModules} modules, ${report.architecture.totalEdges} edges, ${report.architecture.cycles} cycles, ${report.architecture.violations} boundary violations`,
  ];

  if (pagesUrl) {
    lines.push(
      `- **Live Proof Dashboard:** ${pagesUrl}`,
      `- **Interactive Playwright Report:** ${pagesUrl}playwright-report/`
    );
  }

  lines.push(
    '',
    '| Tier | Stage | Status | Passed | Failed | Skipped | Duration |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |'
  );

  for (const tier of report.tiers) {
    lines.push(
      `| Tier ${tier.tier} | ${tier.title} | **${tier.status.toUpperCase()}** | ${tier.passedCount} | ${tier.failedCount} | ${tier.skippedCount} | ${tier.durationMs}ms |`
    );
  }

  return `${lines.join('\n')}\n`;
}

export function generateProofReport(options: {
  readonly root: string;
  readonly playwrightJsonPath?: string;
  readonly bundleMediaDir?: string;
  readonly playwrightReportUrl?: string;
}): ProofReport {
  const { root } = options;

  // Tier 1: Static & Zero Escape Hatches
  const tscRun = runCommandTimed(root, 'npx', ['tsc', '-p', '.']);
  const oxlintRun = runCommandTimed(root, 'npx', ['oxlint', '--deny-warnings']);
  const rulesStart = performance.now();
  const ruleViolations = checkRules(root);
  const rulesDuration = Math.round(performance.now() - rulesStart);
  const prettierRun = runCommandTimed(root, 'npx', [
    'prettier',
    '--check',
    '{src,scripts,tests,e2e}/**/*.{ts,js}',
  ]);

  const oxlintSummaryLine =
    oxlintRun.output
      .split('\n')
      .find((line) => line.includes('Found') || line.includes('Finished')) ??
    '0 warnings, 0 errors';

  const tier1Checks: ProofCheckItem[] = [
    {
      id: 'typecheck',
      name: 'TypeScript Strict Check',
      status: tscRun.ok ? 'passed' : 'failed',
      durationMs: tscRun.durationMs,
      summary: tscRun.ok
        ? '0 compiler errors across src/, scripts/, tests/, e2e/'
        : 'Typecheck errors detected',
      command: 'npm run typecheck',
      details: tscRun.ok
        ? ['strict: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true']
        : tscRun.output.split('\n').slice(0, 10),
    },
    {
      id: 'oxlint',
      name: 'Oxlint (Zero Escape Hatches)',
      status: oxlintRun.ok ? 'passed' : 'failed',
      durationMs: oxlintRun.durationMs,
      summary: oxlintSummaryLine,
      command: 'npx oxlint --deny-warnings',
      details: [
        'Bans explicit any, unsafe type assertions (as Type), non-null assertions (!), and @ts-* comments',
      ],
    },
    {
      id: 'check-rules',
      name: 'Deterministic Rule Guard',
      status: ruleViolations.length === 0 ? 'passed' : 'failed',
      durationMs: rulesDuration,
      summary:
        ruleViolations.length === 0
          ? '0 suppression directives, 0 domain DOM leaks, 100% FeatureMap coverage'
          : `${ruleViolations.length} rule violation(s)`,
      command: 'node scripts/check-rules.ts',
      details:
        ruleViolations.length === 0
          ? [
              'no-suppression-comments: verified',
              'no-dom-globals-in-domain: verified',
              'e2e-must-use-feature-map: verified',
            ]
          : ruleViolations.map((v) => `[${v.rule}] ${v.file}:${v.line}`),
    },
    {
      id: 'prettier',
      name: 'Prettier Code Style',
      status: prettierRun.ok ? 'passed' : 'failed',
      durationMs: prettierRun.durationMs,
      summary: prettierRun.ok
        ? 'All source and test files formatted'
        : 'Formatting drift detected',
      command: 'prettier --check "{src,scripts,tests,e2e}/**/*.{ts,js}"',
      details: [
        'Consistent formatting enforced across src, scripts, tests, e2e',
      ],
    },
  ];

  const tier1Passed = tier1Checks.filter((c) => c.status === 'passed').length;
  const tier1Failed = tier1Checks.filter((c) => c.status === 'failed').length;
  const tier1: ProofTier = {
    tier: 1,
    id: 'static',
    title: 'Static & Escape Hatches',
    subtitle:
      'Strict TypeScript, zero explicit any/as/!, zero suppression directives, and code style',
    status: tier1Failed > 0 ? 'failed' : 'passed',
    passedCount: tier1Passed,
    failedCount: tier1Failed,
    skippedCount: 0,
    durationMs: tier1Checks.reduce((sum, c) => sum + c.durationMs, 0),
    checks: tier1Checks,
  };

  // Tier 2: Architectural Boundaries
  const archStart = performance.now();
  const arch = analyzeArchitecture(root);
  const archDuration = Math.round(performance.now() - archStart);

  const layers: BoundaryLayerInfo[] = LAYER_METADATA.map((meta) => {
    const stat = arch.layerStats.get(meta.layer) ?? { modules: 0, edges: 0 };
    return {
      ...meta,
      moduleCount: stat.modules,
      edgeCount: stat.edges,
    };
  });

  const architectureReport: ArchitectureReport = {
    totalModules: arch.totalModules,
    totalEdges: arch.totalEdges,
    cycles: arch.cycles.length,
    violations: arch.violations.length,
    layers,
    rules: arch.ruleNames,
  };

  const tier2Checks: ProofCheckItem[] = [
    {
      id: 'arch-boundaries',
      name: 'Layer Boundary Isolation',
      status: arch.violations.length === 0 ? 'passed' : 'failed',
      durationMs: archDuration,
      summary: `${arch.totalModules} modules, ${arch.totalEdges} import edges, ${arch.violations.length} violations`,
      command: 'npm run arch:check',
      details:
        arch.violations.length === 0
          ? arch.ruleNames.map((name) => `${name}: 0 violations`)
          : arch.violations.map(
              (v) => `[${v.rule}] ${v.file}:${v.line} -> ${v.specifier}`
            ),
    },
    {
      id: 'arch-cycles',
      name: 'Acyclic Dependency Graph',
      status: arch.cycles.length === 0 ? 'passed' : 'failed',
      durationMs: 0,
      summary:
        arch.cycles.length === 0
          ? '0 circular dependencies detected'
          : `${arch.cycles.length} import cycle(s) detected`,
      command: 'npm run arch:check',
      details:
        arch.cycles.length === 0
          ? ['Full DFS cycle detection passed across src/']
          : arch.cycles.map((cycle) => cycle.join(' -> ')),
    },
  ];

  const tier2Failed = tier2Checks.filter((c) => c.status === 'failed').length;
  const tier2: ProofTier = {
    tier: 2,
    id: 'architecture',
    title: 'Architectural Boundaries',
    subtitle:
      'Strict separation of shared, domain, server, services, core, and Web Component layers',
    status: tier2Failed > 0 ? 'failed' : 'passed',
    passedCount: tier2Checks.length - tier2Failed,
    failedCount: tier2Failed,
    skippedCount: 0,
    durationMs: archDuration,
    checks: tier2Checks,
  };

  // Tier 3: Unit & Property-Based Invariant Proofs
  const unitRun = runCommandTimed(root, process.execPath, [
    '--test',
    '--test-reporter=tap',
    '{src,scripts,tests/lib}/**/*.test.ts',
  ]);
  const unitTap = parseTapOutput(unitRun.output);

  const propRun = runCommandTimed(root, process.execPath, [
    '--test',
    '--test-reporter=tap',
    'tests/properties/**/*.test.ts',
  ]);
  const propTap = parseTapOutput(propRun.output);

  const tier3Checks: ProofCheckItem[] = [
    {
      id: 'unit-tests',
      name: 'Node Native Unit Tests',
      status: unitRun.ok && unitTap.failed === 0 ? 'passed' : 'failed',
      durationMs: unitTap.durationMs || unitRun.durationMs,
      summary: `${unitTap.passed} passed, ${unitTap.failed} failed`,
      command: 'npm run test:unit',
      details: unitTap.testNames,
    },
    {
      id: 'property-tests',
      name: 'Property-Based State Machine Invariants',
      status: propRun.ok && propTap.failed === 0 ? 'passed' : 'failed',
      durationMs: propTap.durationMs || propRun.durationMs,
      summary: `${propTap.passed} invariant properties verified across randomized action sequences`,
      command: 'npm run test:properties',
      details: propTap.testNames,
    },
  ];

  const tier3Passed = unitTap.passed + propTap.passed;
  const tier3Failed = unitTap.failed + propTap.failed;
  const tier3Skipped = unitTap.skipped + propTap.skipped;
  const tier3: ProofTier = {
    tier: 3,
    id: 'properties',
    title: 'Unit & Property-Based Proofs',
    subtitle:
      'Deterministic shrinking property tests proving formal state-machine invariants in milliseconds',
    status: tier3Failed > 0 || !unitRun.ok || !propRun.ok ? 'failed' : 'passed',
    passedCount: tier3Passed,
    failedCount: tier3Failed,
    skippedCount: tier3Skipped,
    durationMs:
      (unitTap.durationMs || unitRun.durationMs) +
      (propTap.durationMs || propRun.durationMs),
    checks: tier3Checks,
  };

  // Tier 4: Runtime & Visual Proofs (Playwright)
  let pwSummary: ParsedPlaywrightSummary = {
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    checks: [],
    media: [],
  };
  if (options.playwrightJsonPath && fs.existsSync(options.playwrightJsonPath)) {
    const rawJson: unknown = JSON.parse(
      fs.readFileSync(options.playwrightJsonPath, 'utf8')
    );
    pwSummary = parsePlaywrightJson(rawJson, options.bundleMediaDir);
  }

  const tier4: ProofTier = {
    tier: 4,
    id: 'e2e',
    title: 'Runtime & Visual Proofs (Playwright)',
    subtitle:
      'FeatureMap-driven headless browser specs with zero console/network errors and recorded videos',
    status:
      pwSummary.failed > 0
        ? 'failed'
        : pwSummary.passed > 0
          ? 'passed'
          : 'skipped',
    passedCount: pwSummary.passed,
    failedCount: pwSummary.failed,
    skippedCount: pwSummary.skipped,
    durationMs: pwSummary.durationMs,
    checks: pwSummary.checks,
  };

  const tiers: ProofTier[] = [tier1, tier2, tier3, tier4];
  const totalPassed = tiers.reduce((sum, t) => sum + t.passedCount, 0);
  const totalFailed = tiers.reduce((sum, t) => sum + t.failedCount, 0);
  const totalSkipped = tiers.reduce((sum, t) => sum + t.skippedCount, 0);
  const totalDurationMs = tiers.reduce((sum, t) => sum + t.durationMs, 0);

  const commit =
    process.env.GITHUB_SHA ||
    readGitValue(root, ['rev-parse', 'HEAD']) ||
    'local';
  const shortCommit = commit.slice(0, 7);
  const branch =
    process.env.GITHUB_REF_NAME ||
    readGitValue(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ||
    'main';
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repoSlug =
    process.env.GITHUB_REPOSITORY || 'sholtomaud/proof-based-development';
  const repoUrl = `${serverUrl}/${repoSlug}`;
  const commitUrl =
    commit !== 'local' ? `${repoUrl}/commit/${commit}` : repoUrl;
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';

  const build: ProofBuildInfo = {
    commit,
    shortCommit,
    branch,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    commitUrl,
    runUrl,
    repoUrl,
    playwrightReportUrl: options.playwrightReportUrl ?? '',
  };

  const lockfile = loadLockfileFromDisk(root);
  const changelog = loadAndVerifyProofChangelog(root);
  let integrity: ProofIntegrityReport;
  if (lockfile) {
    const lockCheck = verifyAgainstLock(root, lockfile);
    integrity = {
      status: lockCheck.ok && changelog.valid ? 'intact' : 'tampered',
      rootSha256: lockfile.rootSha256,
      harnessFileCount: lockfile.files.filter((f) => f.zone === 'harness')
        .length,
      testFileCount: lockfile.files.filter((f) => f.zone === 'tests').length,
      metricFloors: lockfile.metricFloors,
      lockedFiles: lockfile.files,
      changelogChainValid: changelog.valid,
      changelogEntries: changelog.entries,
    };
  } else {
    integrity = {
      status: 'tampered',
      rootSha256: '',
      harnessFileCount: 0,
      testFileCount: 0,
      metricFloors: {
        minUnitTests: 0,
        minPropertyTests: 0,
        minE2ETests: 0,
        minArchRules: 0,
        maxSkippedTests: 0,
      },
      lockedFiles: [],
      changelogChainValid: changelog.valid,
      changelogEntries: changelog.entries,
    };
  }

  return {
    schemaVersion: 1,
    overallStatus: totalFailed > 0 ? 'failed' : 'passed',
    totalPassed,
    totalFailed,
    totalSkipped,
    totalDurationMs,
    build,
    tiers,
    architecture: architectureReport,
    e2eMedia: pwSummary.media,
    integrity,
  };
}

function readArg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = process.cwd();
  const outPath = path.resolve(
    root,
    readArg(args, '--out') ?? 'public/data/proof-report.json'
  );
  const playwrightJsonPath = path.resolve(
    root,
    readArg(args, '--playwright-json') ?? 'test-results/playwright-results.json'
  );
  const bundleMediaArg = readArg(args, '--bundle-media-dir');
  const bundleMediaDir = bundleMediaArg
    ? path.resolve(root, bundleMediaArg)
    : undefined;
  const playwrightReportUrl = readArg(args, '--playwright-report-url') ?? '';
  const summaryFile = readArg(args, '--summary-file');
  const pagesUrl = readArg(args, '--pages-url');

  let report = generateProofReport({
    root,
    playwrightJsonPath,
    bundleMediaDir,
    playwrightReportUrl,
  });

  if (args.includes('--append-changelog')) {
    const summary = `${report.totalPassed} passed, ${report.totalFailed} failed, ${report.totalSkipped} skipped (${report.architecture.totalModules} modules, ${report.architecture.cycles} cycles)`;
    const verdict =
      report.overallStatus === 'passed' && report.integrity.status === 'intact'
        ? 'SEAL_INTACT'
        : 'FAILED';
    const entry = appendProofChangelogEntry(root, {
      commit: report.build.shortCommit,
      timestamp: report.build.generatedAt,
      rootSha256: report.integrity.rootSha256,
      summary,
      verdict,
    });
    console.log(
      `Appended hash-chained attestation ${entry.attestationSha256.slice(0, 16)}… to PROOF_CHANGELOG.md.`
    );
    const updatedChangelog = loadAndVerifyProofChangelog(root);
    report = {
      ...report,
      integrity: {
        ...report.integrity,
        changelogChainValid: updatedChangelog.valid,
        changelogEntries: updatedChangelog.entries,
      },
    };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Generated proof report at ${path.relative(root, outPath)} (${report.totalPassed} passed, ${report.totalFailed} failed, ${report.totalSkipped} skipped).`
  );

  if (summaryFile) {
    fs.appendFileSync(summaryFile, renderMarkdownSummary(report, pagesUrl));
  }
}
