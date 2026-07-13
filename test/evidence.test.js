import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeEvidence, readEvidence } from '../src/lib/evidence.js';

function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-ev-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('write + read roundtrip, sharded by year/month', () => {
  withSandbox(() => {
    const { id, path: filePath } = writeEvidence({
      kind: 'mistake-observed',
      observed_at: '2026-07-13T10:00:00Z',
      project: 'shopclone',
      source: { type: 'claude-session', session_id: 'sess-abc', line_span: [120, 188] },
      excerpt: 'agent committed the env file before adding an ignore rule',
      notes: 'classic first-commit leak'
    });
    assert.match(id, /^ev_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.ok(filePath.includes(path.join('2026', '07')));
    const back = readEvidence(id, '2026-07-13T10:00:00Z');
    assert.equal(back.project, 'shopclone');
    assert.equal(back.excerpt_redacted, false);
  });
});

test('excerpts are secret-scrubbed at write time', () => {
  withSandbox(() => {
    const { id } = writeEvidence({
      kind: 'fix-applied',
      observed_at: '2026-07-13',
      project: 'billing-svc',
      source: { type: 'git', commit: 'abcdef1234567' },
      excerpt: 'the leaked key was AKIAIOSFODNN7EXAMPLE and had to be rotated'
    });
    const back = readEvidence(id, '2026-07-13');
    assert.ok(!back.excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(back.excerpt.includes('<SECRET:aws-key>'));
    assert.equal(back.excerpt_redacted, true);
  });
});

test('invalid kind is rejected with a coded error', () => {
  withSandbox(() => {
    assert.throws(
      () =>
        writeEvidence({
          kind: 'vibes',
          observed_at: '2026-07-13',
          project: 'x',
          source: { type: 'manual' }
        }),
      /E-EVIDENCE/
    );
  });
});

test('overlong excerpt is rejected', () => {
  withSandbox(() => {
    assert.throws(
      () =>
        writeEvidence({
          kind: 'mistake-observed',
          observed_at: '2026-07-13',
          project: 'x',
          source: { type: 'manual' },
          excerpt: 'y'.repeat(1501)
        }),
      /E-EVIDENCE/
    );
  });
});
