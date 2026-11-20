import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateProofLockfile,
  verifyAgainstLock,
  verifyFloorRatchet,
} from './proof-lock.ts';
import type { MetricFloors } from '../src/shared/proof-report.ts';

const DEFAULT_FLOORS: MetricFloors = {
  minUnitTests: 10,
  minPropertyTests: 4,
  minE2ETests: 5,
  minArchRules: 8,
  maxSkippedTests: 1,
};

describe('proof-lock tamper detection', () => {
  let root: string;

  const writeFile = (rel: string, content: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-lock-'));
    writeFile(
      'package.json',
      JSON.stringify({ name: 'demo', scripts: { verify: 'echo ok' } }, null, 2)
    );
    writeFile('.oxlintrc.json', '{"rules":{}}\n');
    writeFile('src/domain/calc.test.ts', 'export const ok = true;\n');
    writeFile('e2e/app.spec.ts', 'export const e2e = true;\n');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('passes when locked harness and tests are untouched', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    const result = verifyAgainstLock(root, lock);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.violations, []);
  });

  test('allows adding brand-new test files without tripping tamper gate', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    writeFile('src/domain/new-feature.test.ts', 'export const added = true;\n');
    const result = verifyAgainstLock(root, lock);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.addedTestFiles, [
      'src/domain/new-feature.test.ts',
    ]);
  });

  test('detects modified existing test file unless explicitly authorized', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    writeFile('src/domain/calc.test.ts', 'export const weakened = false;\n');

    const blocked = verifyAgainstLock(root, lock);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.violations[0].code, 'modified-test-file');

    const authorized = verifyAgainstLock(root, lock, { allowTestChange: true });
    assert.strictEqual(authorized.ok, true);
    assert.strictEqual(authorized.authorizedChanges.length, 1);
  });

  test('detects deleted existing test file', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    fs.rmSync(path.join(root, 'e2e/app.spec.ts'));

    const blocked = verifyAgainstLock(root, lock);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.violations[0].code, 'deleted-test-file');
  });

  test('detects modified harness config and package.json scripts tampering', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    writeFile(
      'package.json',
      JSON.stringify({ name: 'demo', scripts: { verify: 'true' } }, null, 2)
    );
    writeFile('.oxlintrc.json', '{"rules":{"off":0}}\n');

    const blocked = verifyAgainstLock(root, lock, { allowTestChange: true });
    assert.strictEqual(blocked.ok, false);
    const codes = blocked.violations.map((v) => v.code);
    assert.ok(codes.every((code) => code === 'modified-harness-file'));
    assert.strictEqual(blocked.violations.length, 2);

    const authorized = verifyAgainstLock(root, lock, {
      allowHarnessChange: true,
    });
    assert.strictEqual(authorized.ok, true);
  });

  test('detects focused (.only) and unconditional skipped (.skip) tests even in new test files', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    const skipCall = `${['test', 'skip'].join('.')}('bypassed', () => {});`;
    const onlyCall = `${['test', 'only'].join('.')}('focused', () => {});`;
    writeFile('src/domain/sneaky.test.ts', `${skipCall}\n${onlyCall}\n`);

    const blocked = verifyAgainstLock(root, lock);
    assert.strictEqual(blocked.ok, false);
    assert.ok(
      blocked.violations.every((v) => v.code === 'weakened-test-directive')
    );
    assert.strictEqual(blocked.violations.length, 2);
  });

  test('enforces monotonic metric floors and skip ceiling', () => {
    const lock = generateProofLockfile(root, DEFAULT_FLOORS);
    const regressed = verifyAgainstLock(root, lock, {
      observedMetrics: {
        unitTests: 9,
        propertyTests: 4,
        e2eTests: 4,
        archRules: 8,
        skippedTests: 2,
      },
    });
    assert.strictEqual(regressed.ok, false);
    const codes = regressed.violations.map((v) => v.code);
    assert.ok(codes.includes('metric-floor-regression'));
    assert.ok(codes.includes('skip-ceiling-exceeded'));

    const ratchetViolations = verifyFloorRatchet(DEFAULT_FLOORS, {
      ...DEFAULT_FLOORS,
      minUnitTests: 5,
    });
    assert.strictEqual(ratchetViolations.length, 1);
  });
});
