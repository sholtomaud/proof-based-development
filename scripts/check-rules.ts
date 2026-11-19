// Zero-dependency deterministic rule checker for constraints that linters
// cannot reliably self-enforce (such as banning suppression comments, enforcing
// pure domain globals, and grounding Playwright specs in tests/feature-map.ts).
import fs from 'node:fs';
import path from 'node:path';

export interface RuleViolation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

// Assemble forbidden directive tokens dynamically so this file does not trip
// its own suppression scanner.
const SUPPRESSION_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  {
    name: ['eslint', 'disable'].join('-'),
    regex: new RegExp(`\\b${'eslint'}-disable\\b`),
  },
  {
    name: ['oxlint', 'disable'].join('-'),
    regex: new RegExp(`\\b${'oxlint'}-disable\\b`),
  },
  { name: ['ts', 'ignore'].join('-'), regex: new RegExp(`@${'ts'}-ignore\\b`) },
  {
    name: ['ts', 'expect-error'].join('-'),
    regex: new RegExp(`@${'ts'}-expect-error\\b`),
  },
  {
    name: ['ts', 'nocheck'].join('-'),
    regex: new RegExp(`@${'ts'}-nocheck\\b`),
  },
];

const FORBIDDEN_DOMAIN_GLOBALS =
  /\b(window|document|localStorage|sessionStorage|HTMLElement|HTMLInputElement|HTMLFormElement|customElements|navigator)\b/;

function collectFiles(root: string, dirs: readonly string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const start = path.join(root, dir);
    if (!fs.existsSync(start)) continue;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(start);
  }
  return files.sort();
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function stripStringLiteralsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

export function checkRules(root: string): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const files = collectFiles(root, ['src', 'scripts', 'tests', 'e2e']);

  for (const fileAbs of files) {
    const fileRel = toPosix(path.relative(root, fileAbs));
    const source = fs.readFileSync(fileAbs, 'utf8');
    const lines = source.split('\n');

    // 1. Zero suppression directives anywhere in the codebase.
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index];
      for (const pattern of SUPPRESSION_PATTERNS) {
        if (pattern.regex.test(lineText)) {
          violations.push({
            rule: 'no-suppression-comments',
            file: fileRel,
            line: index + 1,
            message: `Forbidden "${pattern.name}" directive found. Refactor the root type or architecture instead of silencing checks.`,
          });
        }
      }
    }

    // 2. Pure domain modules must never touch browser/DOM globals.
    if (fileRel.startsWith('src/domain/') && !fileRel.endsWith('.test.ts')) {
      for (let index = 0; index < lines.length; index += 1) {
        const codeOnly = stripStringLiteralsAndComments(lines[index]);
        const match = codeOnly.match(FORBIDDEN_DOMAIN_GLOBALS);
        if (match) {
          violations.push({
            rule: 'no-dom-globals-in-domain',
            file: fileRel,
            line: index + 1,
            message: `Domain module references browser global "${match[1]}". Keep src/domain/ pure and pass data in as plain typed arguments.`,
          });
        }
      }
    }

    // 3. E2E specs must import FeatureMap so selectors stay centrally typed.
    if (fileRel.startsWith('e2e/') && /\.spec\.(ts|js)$/.test(fileRel)) {
      if (
        !/import\s+\{[^}]*\bFeatureMap\b[^}]*\}\s+from\s+['"][^'"]*feature-map\.ts['"]/.test(
          source
        )
      ) {
        violations.push({
          rule: 'e2e-must-use-feature-map',
          file: fileRel,
          line: 1,
          message:
            'Playwright E2E specs must import `FeatureMap` from `tests/feature-map.ts` instead of hardcoding ad-hoc routes and selectors.',
        });
      }
    }
  }

  return violations;
}

if (import.meta.main) {
  const violations = checkRules(process.cwd());
  if (violations.length > 0) {
    console.error(
      `Static rule check failed with ${violations.length} violation(s):\n`
    );
    for (const v of violations) {
      console.error(
        `  [${v.rule}] ${v.file}:${v.line}\n    Fix: ${v.message}\n`
      );
    }
    process.exitCode = 1;
  } else {
    console.log('Static rule check passed: zero escape hatches detected.');
  }
}
