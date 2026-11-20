// Zero-dependency cryptographic verification lockfile & tamper-detection gate.
// Computes SHA-256 hashes across three trust zones:
//   Zone A (harness): verification scripts, linter/tsconfig/Playwright configs, CI workflow, CODEOWNERS, package.json scripts
//   Zone B (tests):   FeatureMap, unit tests, property tests, Playwright E2E specs
//   Zone C (floors):  monotonic minimum test/rule counts & max skip ceiling
//
// Local mode (`npm run proof:check`): verifies working tree against proof-lock.json.
// PR mode (`--verify-pr-base origin/main`): loads proof-lock.json from the trusted base branch
// so an agent cannot bypass verification by rewriting proof-lock.json in the same PR.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from '../src/shared/contracts.ts';
import {
  isLockedFileEntry,
  isMetricFloors,
  type LockedFileEntry,
  type MetricFloors,
  type ProofLockZone,
} from '../src/shared/proof-report.ts';

export interface ProofLockfile {
  readonly schemaVersion: 1;
  readonly rootSha256: string;
  readonly metricFloors: MetricFloors;
  readonly files: readonly LockedFileEntry[];
}

export interface TamperViolation {
  readonly code:
    | 'invalid-lockfile'
    | 'root-hash-mismatch'
    | 'modified-harness-file'
    | 'deleted-harness-file'
    | 'modified-test-file'
    | 'deleted-test-file'
    | 'weakened-test-directive'
    | 'metric-floor-regression'
    | 'skip-ceiling-exceeded';
  readonly path: string;
  readonly message: string;
}

export interface LockVerificationResult {
  readonly ok: boolean;
  readonly rootSha256: string;
  readonly violations: readonly TamperViolation[];
  readonly addedTestFiles: readonly string[];
  readonly authorizedChanges: readonly string[];
}

export interface ObservedMetrics {
  readonly unitTests: number;
  readonly propertyTests: number;
  readonly e2eTests: number;
  readonly archRules: number;
  readonly skippedTests: number;
}

export const HARNESS_FILES: readonly string[] = [
  '.github/CODEOWNERS',
  '.github/workflows/verify.yml',
  '.oxlintrc.json',
  'package.json#scripts',
  'playwright.config.js',
  'scripts/arch-check.ts',
  'scripts/check-rules.ts',
  'scripts/proof-changelog.ts',
  'scripts/proof-lock.ts',
  'tests/lib/property.ts',
  'e2e/fixtures.ts',
  'tsconfig.json',
];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function sha256Text(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function hashVirtualOrFile(root: string, entryPath: string): string | null {
  if (entryPath === 'package.json#scripts') {
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!isRecord(raw) || !isRecord(raw.scripts)) return null;
    const sortedEntries = Object.entries(raw.scripts)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
      .sort(([a], [b]) => a.localeCompare(b));
    return sha256Text(JSON.stringify(Object.fromEntries(sortedEntries)));
  }

  const fullPath = path.join(root, entryPath);
  if (!fs.existsSync(fullPath)) return null;
  return sha256Text(fs.readFileSync(fullPath, 'utf8'));
}

function walkMatching(
  root: string,
  dirRel: string,
  matcher: (relPosix: string) => boolean
): string[] {
  const start = path.join(root, dirRel);
  if (!fs.existsSync(start)) return [];
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = toPosix(path.relative(root, full));
        if (matcher(rel)) results.push(rel);
      }
    }
  };
  walk(start);
  return results.sort();
}

export function discoverTestFiles(root: string): string[] {
  const discovered = new Set<string>();
  const featureMap = 'tests/feature-map.ts';
  if (fs.existsSync(path.join(root, featureMap))) {
    discovered.add(featureMap);
  }
  for (const dir of ['src', 'scripts', 'tests']) {
    for (const file of walkMatching(root, dir, (rel) =>
      rel.endsWith('.test.ts')
    )) {
      discovered.add(file);
    }
  }
  for (const file of walkMatching(root, 'e2e', (rel) =>
    rel.endsWith('.spec.ts')
  )) {
    discovered.add(file);
  }
  return [...discovered].sort();
}

export function computeRootSha256(
  files: readonly LockedFileEntry[],
  metricFloors: MetricFloors
): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const payload = [
    ...sorted.map((f) => `${f.zone}:${f.path}:${f.sha256}`),
    `floors:${JSON.stringify({
      minUnitTests: metricFloors.minUnitTests,
      minPropertyTests: metricFloors.minPropertyTests,
      minE2ETests: metricFloors.minE2ETests,
      minArchRules: metricFloors.minArchRules,
      maxSkippedTests: metricFloors.maxSkippedTests,
    })}`,
  ].join('\n');
  return sha256Text(payload);
}

export function isProofLockfile(value: unknown): value is ProofLockfile {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.rootSha256 === 'string' &&
    isMetricFloors(value.metricFloors) &&
    Array.isArray(value.files) &&
    value.files.every(isLockedFileEntry)
  );
}

export function generateProofLockfile(
  root: string,
  metricFloors: MetricFloors
): ProofLockfile {
  const files: LockedFileEntry[] = [];

  for (const harnessPath of HARNESS_FILES) {
    const hash = hashVirtualOrFile(root, harnessPath);
    if (hash !== null) {
      files.push({ path: harnessPath, zone: 'harness', sha256: hash });
    }
  }

  for (const testPath of discoverTestFiles(root)) {
    const hash = hashVirtualOrFile(root, testPath);
    if (hash !== null) {
      files.push({ path: testPath, zone: 'tests', sha256: hash });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const rootSha256 = computeRootSha256(files, metricFloors);

  return {
    schemaVersion: 1,
    rootSha256,
    metricFloors,
    files,
  };
}

const WEAKENING_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  {
    name: 'focused test (.only)',
    regex: /\b(?:test|it|describe)\.only\s*\(/,
  },
  {
    name: 'unconditional skipped test (.skip)',
    regex: /\b(?:test|it|describe)\.skip\s*\(\s*['"`]/,
  },
];

function scanTestWeakening(
  root: string,
  testPaths: readonly string[]
): TamperViolation[] {
  const violations: TamperViolation[] = [];
  for (const rel of testPaths) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const code = lines[i].replace(/\/\/.*$/, '');
      for (const pattern of WEAKENING_PATTERNS) {
        if (pattern.regex.test(code)) {
          violations.push({
            code: 'weakened-test-directive',
            path: `${rel}:${i + 1}`,
            message: `Detected ${pattern.name}. Unsupervised edits may not skip or focus tests to bypass verification.`,
          });
        }
      }
    }
  }
  return violations;
}

export function verifyMetricsAgainstFloors(
  metrics: ObservedMetrics,
  floors: MetricFloors
): TamperViolation[] {
  const violations: TamperViolation[] = [];
  if (metrics.unitTests < floors.minUnitTests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'metricFloors.minUnitTests',
      message: `Unit test count regressed: observed ${metrics.unitTests} < locked floor ${floors.minUnitTests}.`,
    });
  }
  if (metrics.propertyTests < floors.minPropertyTests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'metricFloors.minPropertyTests',
      message: `Property test count regressed: observed ${metrics.propertyTests} < locked floor ${floors.minPropertyTests}.`,
    });
  }
  if (metrics.e2eTests < floors.minE2ETests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'metricFloors.minE2ETests',
      message: `E2E test count regressed: observed ${metrics.e2eTests} < locked floor ${floors.minE2ETests}.`,
    });
  }
  if (metrics.archRules < floors.minArchRules) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'metricFloors.minArchRules',
      message: `Architecture rule count regressed: observed ${metrics.archRules} < locked floor ${floors.minArchRules}.`,
    });
  }
  if (metrics.skippedTests > floors.maxSkippedTests) {
    violations.push({
      code: 'skip-ceiling-exceeded',
      path: 'metricFloors.maxSkippedTests',
      message: `Skipped tests exceeded ceiling: observed ${metrics.skippedTests} > locked max ${floors.maxSkippedTests}.`,
    });
  }
  return violations;
}

export interface VerifyOptions {
  readonly allowTestChange?: boolean;
  readonly allowHarnessChange?: boolean;
  readonly observedMetrics?: ObservedMetrics;
}

export function verifyAgainstLock(
  root: string,
  lock: ProofLockfile,
  options: VerifyOptions = {}
): LockVerificationResult {
  const violations: TamperViolation[] = [];
  const authorizedChanges: string[] = [];

  const expectedRoot = computeRootSha256(lock.files, lock.metricFloors);
  if (expectedRoot !== lock.rootSha256) {
    violations.push({
      code: 'root-hash-mismatch',
      path: 'proof-lock.json',
      message: `Lockfile rootSha256 mismatch (expected ${expectedRoot}, found ${lock.rootSha256}).`,
    });
  }

  const lockedPaths = new Set<string>();
  for (const entry of lock.files) {
    lockedPaths.add(entry.path);
    const actualHash = hashVirtualOrFile(root, entry.path);
    const zone: ProofLockZone = entry.zone;

    if (actualHash === null) {
      if (zone === 'tests' && options.allowTestChange) {
        authorizedChanges.push(`deleted test (authorized): ${entry.path}`);
      } else if (zone === 'harness' && options.allowHarnessChange) {
        authorizedChanges.push(`deleted harness (authorized): ${entry.path}`);
      } else {
        violations.push({
          code:
            zone === 'harness' ? 'deleted-harness-file' : 'deleted-test-file',
          path: entry.path,
          message:
            zone === 'harness'
              ? `Locked verification harness file "${entry.path}" was deleted. Requires human review + "allow-harness-change" PR label.`
              : `Locked test/spec file "${entry.path}" was deleted. Agents may not delete existing tests; requires human review + "allow-test-change" PR label.`,
        });
      }
      continue;
    }

    if (actualHash !== entry.sha256) {
      if (zone === 'tests' && options.allowTestChange) {
        authorizedChanges.push(`modified test (authorized): ${entry.path}`);
      } else if (zone === 'harness' && options.allowHarnessChange) {
        authorizedChanges.push(`modified harness (authorized): ${entry.path}`);
      } else {
        violations.push({
          code:
            zone === 'harness' ? 'modified-harness-file' : 'modified-test-file',
          path: entry.path,
          message:
            zone === 'harness'
              ? `Locked verification harness file "${entry.path}" was modified (expected ${entry.sha256.slice(0, 12)}, got ${actualHash.slice(0, 12)}). Requires human review + "allow-harness-change" PR label.`
              : `Locked test/spec file "${entry.path}" was modified (expected ${entry.sha256.slice(0, 12)}, got ${actualHash.slice(0, 12)}). Fix the implementation rather than editing existing tests, or request human "allow-test-change" PR label.`,
        });
      }
    }
  }

  const currentTestFiles = discoverTestFiles(root);
  const addedTestFiles = currentTestFiles.filter((p) => !lockedPaths.has(p));

  // Scan ALL current test files (existing + newly added) for test-weakening directives.
  violations.push(...scanTestWeakening(root, currentTestFiles));

  if (options.observedMetrics) {
    violations.push(
      ...verifyMetricsAgainstFloors(options.observedMetrics, lock.metricFloors)
    );
  }

  return {
    ok: violations.length === 0,
    rootSha256: lock.rootSha256,
    violations,
    addedTestFiles,
    authorizedChanges,
  };
}

export function loadLockfileFromDisk(root: string): ProofLockfile | null {
  const lockPath = path.join(root, 'proof-lock.json');
  if (!fs.existsSync(lockPath)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  return isProofLockfile(parsed) ? parsed : null;
}

export function loadLockfileFromGitRef(
  root: string,
  gitRef: string
): ProofLockfile | null {
  const res = spawnSync('git', ['show', `${gitRef}:proof-lock.json`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.status !== 0 || !res.stdout) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    return isProofLockfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function verifyFloorRatchet(
  baseFloors: MetricFloors,
  headFloors: MetricFloors
): TamperViolation[] {
  const violations: TamperViolation[] = [];
  if (headFloors.minUnitTests < baseFloors.minUnitTests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'proof-lock.json#metricFloors.minUnitTests',
      message: `PR lowered minUnitTests floor from ${baseFloors.minUnitTests} to ${headFloors.minUnitTests}.`,
    });
  }
  if (headFloors.minPropertyTests < baseFloors.minPropertyTests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'proof-lock.json#metricFloors.minPropertyTests',
      message: `PR lowered minPropertyTests floor from ${baseFloors.minPropertyTests} to ${headFloors.minPropertyTests}.`,
    });
  }
  if (headFloors.minE2ETests < baseFloors.minE2ETests) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'proof-lock.json#metricFloors.minE2ETests',
      message: `PR lowered minE2ETests floor from ${baseFloors.minE2ETests} to ${headFloors.minE2ETests}.`,
    });
  }
  if (headFloors.minArchRules < baseFloors.minArchRules) {
    violations.push({
      code: 'metric-floor-regression',
      path: 'proof-lock.json#metricFloors.minArchRules',
      message: `PR lowered minArchRules floor from ${baseFloors.minArchRules} to ${headFloors.minArchRules}.`,
    });
  }
  if (headFloors.maxSkippedTests > baseFloors.maxSkippedTests) {
    violations.push({
      code: 'skip-ceiling-exceeded',
      path: 'proof-lock.json#metricFloors.maxSkippedTests',
      message: `PR raised maxSkippedTests ceiling from ${baseFloors.maxSkippedTests} to ${headFloors.maxSkippedTests}.`,
    });
  }
  return violations;
}

function readFlagValue(
  args: readonly string[],
  flag: string
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function extractMetricsFromReportFile(
  reportPath: string
): ObservedMetrics | null {
  if (!fs.existsSync(reportPath)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.tiers) ||
    !isRecord(parsed.architecture)
  ) {
    return null;
  }

  let unitTests = 0;
  let propertyTests = 0;
  let e2eTests = 0;
  const skippedTests =
    typeof parsed.totalSkipped === 'number' ? parsed.totalSkipped : 0;
  const archRules = Array.isArray(parsed.architecture.rules)
    ? parsed.architecture.rules.length
    : 0;

  for (const tier of parsed.tiers) {
    if (!isRecord(tier)) continue;
    if (tier.id === 'properties' && Array.isArray(tier.checks)) {
      for (const check of tier.checks) {
        if (!isRecord(check) || typeof check.summary !== 'string') continue;
        const match = check.summary.match(/^(\d+)/);
        const count = match ? Number.parseInt(match[1], 10) : 0;
        if (check.id === 'unit-tests') unitTests = count;
        if (check.id === 'property-tests') propertyTests = count;
      }
    }
    if (tier.id === 'e2e' && typeof tier.passedCount === 'number') {
      e2eTests = tier.passedCount;
    }
  }

  return { unitTests, propertyTests, e2eTests, archRules, skippedTests };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = process.cwd();
  const allowTestChange = args.includes('--allow-test-change');
  const allowHarnessChange = args.includes('--allow-harness-change');

  if (args.includes('--update')) {
    const existing = loadLockfileFromDisk(root);
    const reportArg = readFlagValue(args, '--from-report');
    const observed = reportArg
      ? extractMetricsFromReportFile(path.resolve(root, reportArg))
      : null;

    const floors: MetricFloors = observed
      ? {
          minUnitTests: Math.max(
            existing?.metricFloors.minUnitTests ?? 0,
            observed.unitTests
          ),
          minPropertyTests: Math.max(
            existing?.metricFloors.minPropertyTests ?? 0,
            observed.propertyTests
          ),
          minE2ETests: Math.max(
            existing?.metricFloors.minE2ETests ?? 0,
            observed.e2eTests
          ),
          minArchRules: Math.max(
            existing?.metricFloors.minArchRules ?? 0,
            observed.archRules
          ),
          maxSkippedTests:
            existing?.metricFloors.maxSkippedTests ?? observed.skippedTests,
        }
      : (existing?.metricFloors ?? {
          minUnitTests: 39,
          minPropertyTests: 12,
          minE2ETests: 31,
          minArchRules: 10,
          maxSkippedTests: 1,
        });

    const nextLock = generateProofLockfile(root, floors);
    fs.writeFileSync(
      path.join(root, 'proof-lock.json'),
      `${JSON.stringify(nextLock, null, 2)}\n`
    );
    console.log(
      `Updated proof-lock.json (${nextLock.files.length} locked files, rootSha256=${nextLock.rootSha256.slice(0, 16)}…).`
    );
  } else {
    const prBaseRef = readFlagValue(args, '--verify-pr-base');
    const metricsReport = readFlagValue(args, '--verify-metrics');
    const observedMetrics = metricsReport
      ? (extractMetricsFromReportFile(path.resolve(root, metricsReport)) ??
        undefined)
      : undefined;

    const lock = prBaseRef
      ? loadLockfileFromGitRef(root, prBaseRef)
      : loadLockfileFromDisk(root);

    if (!lock) {
      if (prBaseRef) {
        console.log(
          `No proof-lock.json found on base ref "${prBaseRef}" (bootstrap PR); falling back to local lockfile check.`
        );
      }
      const localLock = loadLockfileFromDisk(root);
      if (!localLock) {
        console.error(
          'Proof lock check failed: proof-lock.json is missing or invalid.'
        );
        process.exitCode = 1;
      } else {
        const res = verifyAgainstLock(root, localLock, {
          allowTestChange,
          allowHarnessChange,
          observedMetrics,
        });
        if (!res.ok) {
          for (const v of res.violations) {
            console.error(`  [TAMPER:${v.code}] ${v.path}\n    ${v.message}`);
          }
          process.exitCode = 1;
        } else {
          console.log(
            `Proof lock intact (${localLock.files.length} files, rootSha256=${localLock.rootSha256.slice(0, 16)}…).`
          );
        }
      }
    } else {
      const result = verifyAgainstLock(root, lock, {
        allowTestChange,
        allowHarnessChange,
        observedMetrics,
      });

      const allViolations = [...result.violations];
      if (prBaseRef && !allowHarnessChange) {
        const headLock = loadLockfileFromDisk(root);
        if (headLock) {
          allViolations.push(
            ...verifyFloorRatchet(lock.metricFloors, headLock.metricFloors)
          );
        }
      }

      if (result.addedTestFiles.length > 0) {
        console.log(
          `Additive new test file(s) detected (allowed): ${result.addedTestFiles.join(', ')}`
        );
      }
      if (result.authorizedChanges.length > 0) {
        console.log(
          `Authorized changes:\n  ${result.authorizedChanges.join('\n  ')}`
        );
      }

      if (allViolations.length > 0) {
        console.error(
          `PROOF TAMPER CHECK FAILED with ${allViolations.length} violation(s):\n`
        );
        for (const v of allViolations) {
          console.error(`  [${v.code}] ${v.path}\n    ${v.message}\n`);
        }
        process.exitCode = 1;
      } else {
        const source = prBaseRef
          ? `base ${prBaseRef}`
          : 'local proof-lock.json';
        console.log(
          `Proof lock INTACT against ${source} (${lock.files.length} locked entries, rootSha256=${lock.rootSha256.slice(0, 16)}…).`
        );
      }
    }
  }
}
