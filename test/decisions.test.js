import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordDecision, readDecisions, activeDecisions, decisionsDigest, renderDecisions } from '../src/lib/decisions.js';
import decide from '../src/commands/decide.js';
import { p } from '../src/lib/paths.js';

async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-dec-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('record + read a decision, with rationale and tags', async () => {
  await withSandbox(() => {
    const rec = recordDecision({ title: 'Deterministic graph over embeddings', rationale: 'zero-dep, auditable, no network', tags: ['atlas', 'architecture'] });
    assert.match(rec.id, /^dec_/);
    const all = readDecisions();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'Deterministic graph over embeddings');
    assert.deepEqual(all[0].tags, ['atlas', 'architecture']);
  });
});

test('supersede retires the earlier decision from the active set (history kept)', async () => {
  await withSandbox(() => {
    const a = recordDecision({ title: 'Use API provider by default' });
    recordDecision({ title: 'Use subscription provider by default', rationale: 'fixed price', supersedes: [a.id] });
    const active = activeDecisions();
    assert.equal(active.length, 1);
    assert.equal(active[0].title, 'Use subscription provider by default');
    assert.equal(readDecisions().length, 2); // both persist — append-only
  });
});

test('secrets in decision text are scrubbed before storage', async () => {
  await withSandbox(() => {
    recordDecision({ title: 'Rotate the key', rationale: 'old was AKIAIOSFODNN7EXAMPLE, now in a vault' });
    const raw = readFileSync(p.decisionsLedger(), 'utf8');
    assert.ok(!raw.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(raw.includes('<SECRET:'));
  });
});

test('decisionsDigest is empty with none, compact with some (capability-check)', async () => {
  await withSandbox(() => {
    assert.equal(decisionsDigest(), '');
    recordDecision({ title: 'Keep security lessons human-approved', rationale: 'security floor' });
    const dg = decisionsDigest();
    assert.match(dg, /Keep security lessons human-approved/);
    assert.match(dg, /security floor/);
  });
});

test('empty title is refused', async () => {
  await withSandbox(() => {
    assert.throws(() => recordDecision({ title: '   ' }), /E-DECISION/);
  });
});

test('the decide command records and lists', async () => {
  await withSandbox(async () => {
    assert.equal(await decide(['Ship console as localhost-only', '--why', 'no hosted attack surface', '--tag', 'console,security']), 0);
    assert.equal(await decide(['list']), 0);
    const active = activeDecisions();
    assert.equal(active.length, 1);
    assert.deepEqual(active[0].tags, ['console', 'security']);
    assert.match(renderDecisions(), /Ship console as localhost-only/);
  });
});

test('decide with no args is a usage error', async () => {
  await withSandbox(async () => {
    assert.equal(await decide([]), 1);
  });
});
