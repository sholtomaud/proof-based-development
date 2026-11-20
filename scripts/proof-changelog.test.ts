import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  GENESIS_ATTESTATION,
  createChangelogEntry,
  formatProofChangelogMarkdown,
  verifyProofChangelogMarkdown,
} from './proof-changelog.ts';

describe('proof-changelog hash chain', () => {
  test('verifies a valid multi-entry hash chain', () => {
    const first = createChangelogEntry({
      commit: '1111111',
      timestamp: '2026-11-19T12:00:00.000Z',
      rootSha256: 'aaaa',
      summary: '88 passed, 0 failed',
      verdict: 'SEAL_INTACT',
      previousAttestation: GENESIS_ATTESTATION,
    });
    const second = createChangelogEntry({
      commit: '2222222',
      timestamp: '2026-11-19T13:00:00.000Z',
      rootSha256: 'bbbb',
      summary: '95 passed, 0 failed',
      verdict: 'SEAL_INTACT',
      previousAttestation: first.attestationSha256,
    });

    const markdown = formatProofChangelogMarkdown([first, second]);
    const verified = verifyProofChangelogMarkdown(markdown);
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.entries.length, 2);
    assert.deepStrictEqual(verified.errors, []);
  });

  test('detects tampering with any historical entry', () => {
    const first = createChangelogEntry({
      commit: '1111111',
      timestamp: '2026-11-19T12:00:00.000Z',
      rootSha256: 'aaaa',
      summary: '88 passed, 0 failed',
      verdict: 'SEAL_INTACT',
      previousAttestation: GENESIS_ATTESTATION,
    });
    const markdown = formatProofChangelogMarkdown([first]).replace(
      '88 passed, 0 failed',
      '999 passed, 0 failed'
    );
    const verified = verifyProofChangelogMarkdown(markdown);
    assert.strictEqual(verified.valid, false);
    assert.match(verified.errors[0], /tampered attestationSha256/);
  });
});
