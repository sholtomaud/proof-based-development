// Hash-chained Proof Attestation Changelog (PROOF_CHANGELOG.md).
// Each verified commit entry cryptographically links to the previous entry's
// attestationSha256, making historical proof records tamper-evident.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ProofChangelogEntry } from '../src/shared/proof-report.ts';

export const GENESIS_ATTESTATION =
  '0000000000000000000000000000000000000000000000000000000000000000';

export function computeAttestationSha256(
  fields: Omit<ProofChangelogEntry, 'attestationSha256'>
): string {
  const canonical = JSON.stringify({
    commit: fields.commit,
    timestamp: fields.timestamp,
    rootSha256: fields.rootSha256,
    summary: fields.summary,
    verdict: fields.verdict,
    previousAttestation: fields.previousAttestation,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function createChangelogEntry(
  fields: Omit<ProofChangelogEntry, 'attestationSha256'>
): ProofChangelogEntry {
  return {
    ...fields,
    attestationSha256: computeAttestationSha256(fields),
  };
}

export function formatProofChangelogMarkdown(
  entries: readonly ProofChangelogEntry[]
): string {
  const lines: string[] = [
    '# Proof Attestation Changelog',
    '',
    'This append-only ledger records cryptographic proof attestations for verified commits. Each entry chains its `attestationSha256` to the previous entry so editing or removing historical proof records breaks the chain.',
    '',
  ];

  for (const entry of entries) {
    lines.push(
      `## ${entry.timestamp} — \`${entry.commit}\` (${entry.verdict})`,
      '',
      `- **Commit:** \`${entry.commit}\``,
      `- **Timestamp:** \`${entry.timestamp}\``,
      `- **Proof Lock Root SHA-256:** \`${entry.rootSha256}\``,
      `- **Verdict:** \`${entry.verdict}\``,
      `- **Summary:** ${entry.summary}`,
      `- **Previous Attestation:** \`${entry.previousAttestation}\``,
      `- **Attestation SHA-256:** \`${entry.attestationSha256}\``,
      ''
    );
  }

  return `${lines.join('\n')}`;
}

export function parseProofChangelogMarkdown(
  markdown: string
): ProofChangelogEntry[] {
  const sections = markdown.split(/\n(?=## )/).slice(1);
  const entries: ProofChangelogEntry[] = [];

  for (const section of sections) {
    const readCode = (label: string): string => {
      const match = section.match(
        new RegExp(`- \\*\\*${label}:\\*\\* \`([^\`]+)\``)
      );
      return match ? match[1].trim() : '';
    };
    const summaryMatch = section.match(/- \*\*Summary:\*\* (.+)/);
    const entry: ProofChangelogEntry = {
      commit: readCode('Commit'),
      timestamp: readCode('Timestamp'),
      rootSha256: readCode('Proof Lock Root SHA-256'),
      verdict: readCode('Verdict'),
      summary: summaryMatch ? summaryMatch[1].trim() : '',
      previousAttestation: readCode('Previous Attestation'),
      attestationSha256: readCode('Attestation SHA-256'),
    };
    if (entry.commit && entry.attestationSha256) {
      entries.push(entry);
    }
  }

  return entries;
}

export interface ChangelogVerificationResult {
  readonly valid: boolean;
  readonly entries: readonly ProofChangelogEntry[];
  readonly errors: readonly string[];
}

export function verifyProofChangelogMarkdown(
  markdown: string
): ChangelogVerificationResult {
  const entries = parseProofChangelogMarkdown(markdown);
  const errors: string[] = [];

  let expectedPrevious = GENESIS_ATTESTATION;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.previousAttestation !== expectedPrevious) {
      errors.push(
        `Entry #${i + 1} (${entry.commit}) broken chain: expected previousAttestation ${expectedPrevious}, found ${entry.previousAttestation}`
      );
    }
    const recomputed = computeAttestationSha256({
      commit: entry.commit,
      timestamp: entry.timestamp,
      rootSha256: entry.rootSha256,
      summary: entry.summary,
      verdict: entry.verdict,
      previousAttestation: entry.previousAttestation,
    });
    if (recomputed !== entry.attestationSha256) {
      errors.push(
        `Entry #${i + 1} (${entry.commit}) tampered attestationSha256: expected ${recomputed}, found ${entry.attestationSha256}`
      );
    }
    expectedPrevious = entry.attestationSha256;
  }

  return {
    valid: errors.length === 0,
    entries,
    errors,
  };
}

export function loadAndVerifyProofChangelog(
  root: string
): ChangelogVerificationResult {
  const filePath = path.join(root, 'PROOF_CHANGELOG.md');
  if (!fs.existsSync(filePath)) {
    return { valid: true, entries: [], errors: [] };
  }
  const markdown = fs.readFileSync(filePath, 'utf8');
  return verifyProofChangelogMarkdown(markdown);
}

export function appendProofChangelogEntry(
  root: string,
  fields: Omit<ProofChangelogEntry, 'previousAttestation' | 'attestationSha256'>
): ProofChangelogEntry {
  const current = loadAndVerifyProofChangelog(root);
  if (!current.valid) {
    throw new Error(
      `Cannot append to tampered PROOF_CHANGELOG.md: ${current.errors.join('; ')}`
    );
  }
  const previousAttestation =
    current.entries.at(-1)?.attestationSha256 ?? GENESIS_ATTESTATION;
  const nextEntry = createChangelogEntry({
    ...fields,
    previousAttestation,
  });
  const nextMarkdown = formatProofChangelogMarkdown([
    ...current.entries,
    nextEntry,
  ]);
  fs.writeFileSync(path.join(root, 'PROOF_CHANGELOG.md'), nextMarkdown);
  return nextEntry;
}

if (import.meta.main) {
  const root = process.cwd();
  const result = loadAndVerifyProofChangelog(root);
  if (!result.valid) {
    console.error('PROOF_CHANGELOG.md hash-chain verification FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `PROOF_CHANGELOG.md hash chain valid (${result.entries.length} attested entry/entries).`
    );
  }
}
