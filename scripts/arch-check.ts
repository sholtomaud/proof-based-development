// Zero-dependency architectural boundary and cycle checker.
// Enforces Boba + Proof-Based Development layer isolation with actionable
// instructions on every failure.
import fs from 'node:fs';
import path from 'node:path';

export interface ArchViolation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly message: string;
}

interface BoundaryRule {
  readonly name: string;
  readonly from: RegExp;
  readonly forbidSpecifier?: RegExp;
  readonly forbidResolved?: RegExp;
  readonly guidance: string;
}

const BOUNDARY_RULES: readonly BoundaryRule[] = [
  {
    name: 'no-client-to-server',
    from: /^src\/(components|core|services|main\.ts)/,
    forbidResolved: /^src\/server\//,
    guidance:
      'Client UI, core, and services must never import server-only modules in src/server/. Expose typed contracts in src/shared/ and call an HTTP/API boundary instead.',
  },
  {
    name: 'no-node-builtins-in-client',
    from: /^src\/(components|core|services|domain|shared|main\.ts)/,
    forbidSpecifier: /^node:/,
    guidance:
      'Browser/domain code must not import Node.js built-ins (node:*). Keep Node I/O isolated inside src/server/ or scripts/.',
  },
  {
    name: 'pure-domain-core',
    from: /^src\/domain\//,
    forbidResolved: /^src\/(components|core|services|server|styles|main\.ts)/,
    guidance:
      'src/domain/ must remain a pure, framework-agnostic state model so invariants can be property-tested in milliseconds without a browser. Import only from src/domain/ or src/shared/.',
  },
  {
    name: 'no-assets-in-domain',
    from: /^src\/domain\//,
    forbidSpecifier: /(\?raw|\.(html|css|svg))$/,
    guidance:
      'src/domain/ cannot import UI templates, stylesheets, or raw assets. Keep presentation in src/components/.',
  },
  {
    name: 'pure-shared-contracts',
    from: /^src\/shared\//,
    forbidResolved:
      /^src\/(components|core|domain|services|server|styles|main\.ts)/,
    guidance:
      'src/shared/ holds pure domain types and runtime guards only. It must not depend on any higher layer.',
  },
  {
    name: 'no-server-to-ui',
    from: /^src\/server\//,
    forbidResolved: /^src\/(components|core|styles|main\.ts)/,
    guidance:
      'Server modules in src/server/ must not import browser UI components or core DOM primitives.',
  },
  {
    name: 'dom-free-services',
    from: /^src\/services\//,
    forbidResolved: /^src\/(components|styles|main\.ts)/,
    guidance:
      'Services in src/services/ must stay DOM-free so they can be unit-tested in Node. Do not import components or styles.',
  },
  {
    name: 'no-cross-component-coupling',
    from: /^src\/components\//,
    forbidResolved: /^src\/components\//,
    guidance:
      'Components must not directly import other component files. Communicate through the Router, Store, shared contracts (src/shared/), or domain state machines (src/domain/).',
  },
];

const IMPORT_PATTERNS: readonly RegExp[] = [
  /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function stripComments(source: string): string {
  // Preserve line counts so reported line numbers remain exact.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

export function extractImports(
  source: string
): Array<{ specifier: string; line: number }> {
  const cleaned = stripComments(source);
  const found: Array<{ specifier: string; line: number }> = [];
  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of cleaned.matchAll(regex)) {
      const specifier = match[1];
      if (!specifier) continue;
      const line = lineNumberAt(cleaned, match.index);
      found.push({ specifier, line });
    }
  }
  return found;
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function resolveRelative(
  root: string,
  fromAbs: string,
  specifier: string
): string | null {
  if (!specifier.startsWith('.')) return null;
  const cleanSpec = specifier.split('?')[0];
  const resolvedAbs = path.resolve(path.dirname(fromAbs), cleanSpec);
  return toPosix(path.relative(root, resolvedAbs));
}

function isSameComponentDir(fromRel: string, targetRel: string): boolean {
  const fromParts = fromRel.split('/');
  const targetParts = targetRel.split('/');
  return (
    fromParts[0] === 'src' &&
    fromParts[1] === 'components' &&
    targetParts[0] === 'src' &&
    targetParts[1] === 'components' &&
    fromParts[2] === targetParts[2]
  );
}

function detectCycles(
  adjacency: ReadonlyMap<string, readonly string[]>
): string[][] {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenSignatures = new Set<string>();

  function dfs(node: string): void {
    visited.add(node);
    active.add(node);
    stack.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const next of neighbors) {
      if (!adjacency.has(next)) continue;
      if (active.has(next)) {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next];
        const signature = cycle.slice(0, -1).sort().join('|');
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          cycles.push(cycle);
        }
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }

    stack.pop();
    active.delete(node);
  }

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) dfs(node);
  }
  return cycles;
}

export interface ArchitectureAnalysis {
  readonly violations: readonly ArchViolation[];
  readonly totalModules: number;
  readonly totalEdges: number;
  readonly cycles: readonly string[][];
  readonly layerStats: ReadonlyMap<
    string,
    { readonly modules: number; readonly edges: number }
  >;
  readonly ruleNames: readonly string[];
}

function classifyLayer(fileRel: string): string {
  const parts = fileRel.split('/');
  if (parts[0] === 'src' && parts.length >= 3) {
    return parts[1];
  }
  return 'root';
}

export function analyzeArchitecture(root: string): ArchitectureAnalysis {
  const violations: ArchViolation[] = [];
  const srcFiles = collectSourceFiles(path.join(root, 'src'));
  const adjacency = new Map<string, string[]>();
  const layerCounts = new Map<string, { modules: number; edges: number }>();

  for (const fileAbs of srcFiles) {
    const fileRel = toPosix(path.relative(root, fileAbs));
    const isTestFile = fileRel.endsWith('.test.ts');
    const source = fs.readFileSync(fileAbs, 'utf8');
    const imports = extractImports(source);
    const edges: string[] = [];

    for (const { specifier, line } of imports) {
      const resolved = resolveRelative(root, fileAbs, specifier);

      if (resolved && !isTestFile) {
        edges.push(resolved);
      }

      // Enforce explicit `.ts` extension on relative code imports.
      if (
        specifier.startsWith('.') &&
        !/(\.(ts|js|css|html|svg|json)(\?raw)?)$/.test(specifier)
      ) {
        violations.push({
          rule: 'explicit-ts-extension',
          file: fileRel,
          line,
          specifier,
          message:
            'Relative TypeScript imports must include the explicit `.ts` extension so Node.js native type stripping works without a bundler.',
        });
      }

      // Apply boundary rules to non-test source modules.
      if (isTestFile) continue;

      for (const rule of BOUNDARY_RULES) {
        if (!rule.from.test(fileRel)) continue;

        if (rule.forbidSpecifier && rule.forbidSpecifier.test(specifier)) {
          violations.push({
            rule: rule.name,
            file: fileRel,
            line,
            specifier,
            message: rule.guidance,
          });
        }

        if (
          rule.forbidResolved &&
          resolved &&
          rule.forbidResolved.test(resolved)
        ) {
          if (
            rule.name === 'no-cross-component-coupling' &&
            isSameComponentDir(fileRel, resolved)
          ) {
            continue;
          }
          violations.push({
            rule: rule.name,
            file: fileRel,
            line,
            specifier,
            message: rule.guidance,
          });
        }
      }
    }

    if (!isTestFile) {
      adjacency.set(fileRel, edges);
      const layer = classifyLayer(fileRel);
      const current = layerCounts.get(layer) ?? { modules: 0, edges: 0 };
      layerCounts.set(layer, {
        modules: current.modules + 1,
        edges: current.edges + edges.length,
      });
    }
  }

  const cycles = detectCycles(adjacency);
  for (const cycle of cycles) {
    violations.push({
      rule: 'no-circular-dependencies',
      file: cycle[0],
      line: 1,
      specifier: cycle.join(' -> '),
      message:
        'Circular import cycle detected. Extract shared types into src/shared/ or invert the dependency through a pure domain module in src/domain/.',
    });
  }

  let totalEdges = 0;
  for (const list of adjacency.values()) {
    totalEdges += list.length;
  }

  return {
    violations,
    totalModules: adjacency.size,
    totalEdges,
    cycles,
    layerStats: layerCounts,
    ruleNames: [
      ...BOUNDARY_RULES.map((rule) => rule.name),
      'explicit-ts-extension',
      'no-circular-dependencies',
    ],
  };
}

export function checkArchitecture(root: string): ArchViolation[] {
  return [...analyzeArchitecture(root).violations];
}

if (import.meta.main) {
  const violations = checkArchitecture(process.cwd());
  if (violations.length > 0) {
    console.error(
      `Architecture check failed with ${violations.length} violation(s):\n`
    );
    for (const v of violations) {
      console.error(
        `  [${v.rule}] ${v.file}:${v.line} -> "${v.specifier}"\n    Fix: ${v.message}\n`
      );
    }
    process.exitCode = 1;
  } else {
    console.log('Architecture check passed: all directory boundaries intact.');
  }
}
