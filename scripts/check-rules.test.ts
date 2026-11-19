import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRules } from './check-rules.ts';

describe('check-rules', () => {
  let root: string;

  const writeFile = (rel: string, content: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-rules-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('passes for clean code adhering to all rules', () => {
    writeFile(
      'src/domain/pure.ts',
      'export const double = (n: number) => n * 2;\n'
    );
    writeFile(
      'e2e/sample.spec.ts',
      "import { FeatureMap } from '../tests/feature-map.ts';\nexport const route = FeatureMap.home.route;\n"
    );
    assert.deepStrictEqual(checkRules(root), []);
  });

  test('rejects suppression directives', () => {
    const directive = `// ${'eslint'}-disable-next-line\nexport const x = 1;\n`;
    writeFile('src/domain/bad.ts', directive);
    const violations = checkRules(root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].rule, 'no-suppression-comments');
  });

  test('rejects DOM globals inside src/domain/', () => {
    writeFile(
      'src/domain/leaky.ts',
      'export const read = () => localStorage.getItem("k");\n'
    );
    const violations = checkRules(root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].rule, 'no-dom-globals-in-domain');
  });

  test('requires E2E specs to import FeatureMap', () => {
    writeFile(
      'e2e/unmapped.spec.ts',
      "import { test } from '@playwright/test';\ntest('x', async () => {});\n"
    );
    const violations = checkRules(root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].rule, 'e2e-must-use-feature-map');
  });
});
