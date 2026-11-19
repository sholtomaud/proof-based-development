import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkArchitecture } from './arch-check.ts';

describe('arch-check', () => {
  let root: string;

  const writeFile = (rel: string, content: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-check-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('passes for valid layered imports', () => {
    writeFile('src/shared/types.ts', 'export interface Item { id: number; }\n');
    writeFile(
      'src/domain/item-machine.ts',
      "import type { Item } from '../shared/types.ts';\nexport const make = (id: number): Item => ({ id });\n"
    );
    writeFile(
      'src/components/item-page/item-page.ts',
      "import { make } from '../../domain/item-machine.ts';\nimport html from './item-page.html?raw';\nexport const x = [make(1), html];\n"
    );
    assert.deepStrictEqual(checkArchitecture(root), []);
  });

  test('forbids domain importing UI components or core', () => {
    writeFile('src/core/store.ts', 'export class Store {}\n');
    writeFile(
      'src/domain/bad.ts',
      "import { Store } from '../core/store.ts';\nexport const s = new Store();\n"
    );
    const violations = checkArchitecture(root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].rule, 'pure-domain-core');
  });

  test('forbids client UI importing server modules or node built-ins', () => {
    writeFile('src/server/db.ts', 'export const secret = 1;\n');
    writeFile(
      'src/components/bad-page/bad-page.ts',
      "import { secret } from '../../server/db.ts';\nimport fs from 'node:fs';\nexport const x = [secret, fs];\n"
    );
    const rules = checkArchitecture(root).map((v) => v.rule);
    assert.ok(rules.includes('no-client-to-server'));
    assert.ok(rules.includes('no-node-builtins-in-client'));
  });

  test('forbids cross-component imports across different component folders', () => {
    writeFile('src/components/a-card/a-card.ts', 'export const a = 1;\n');
    writeFile(
      'src/components/b-card/b-card.ts',
      "import { a } from '../a-card/a-card.ts';\nexport const b = a;\n"
    );
    const violations = checkArchitecture(root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].rule, 'no-cross-component-coupling');
  });

  test('detects circular dependencies', () => {
    writeFile(
      'src/domain/a.ts',
      "import { b } from './b.ts';\nexport const a = () => b;\n"
    );
    writeFile(
      'src/domain/b.ts',
      "import { a } from './a.ts';\nexport const b = () => a;\n"
    );
    const violations = checkArchitecture(root);
    assert.ok(violations.some((v) => v.rule === 'no-circular-dependencies'));
  });

  test('requires explicit .ts extensions on relative imports', () => {
    writeFile('src/shared/types.ts', 'export const x = 1;\n');
    writeFile(
      'src/domain/item.ts',
      "import { x } from '../shared/types';\nexport const y = x;\n"
    );
    const violations = checkArchitecture(root);
    assert.ok(violations.some((v) => v.rule === 'explicit-ts-extension'));
  });
});
