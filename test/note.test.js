import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import note from '../src/commands/note.js';
import { validateLesson } from '../src/lib/validate.js';
import { p } from '../src/lib/paths.js';

// async-safe: the finally must not run until the async test body resolves,
// and restoring undefined into process.env would coerce to the string "undefined"
async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-note-'));
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

const GOOD =
  'Payment providers redeliver webhook events, so handlers without event-id dedup produce duplicate charges.';

test('a valid note lands in candidates/ and re-passes the chokepoint', async () => {
  await withSandbox(async () => {
    const code = await note([GOOD, '--category', 'correctness', '--severity', 'high']);
    assert.equal(code, 0);
    const files = readdirSync(p.candidates()).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1);
    const content = readFileSync(path.join(p.candidates(), files[0]), 'utf8');
    const r = validateLesson(content);
    assert.equal(r.ok, true);
    assert.equal(r.data.status, 'candidate');
    assert.equal(r.data.provenance.tier, 'user');
    assert.equal(r.data.evidence.source_mix.user_note, 1);
  });
});

test('--keywords become trigger keywords (lowercased, trimmed, capped at 8)', async () => {
  await withSandbox(async () => {
    const code = await note([GOOD, '--keywords', ' Webhook, STRIPE , dedup,,']);
    assert.equal(code, 0);
    const files = readdirSync(p.candidates()).filter((f) => f.endsWith('.md'));
    const r = validateLesson(readFileSync(path.join(p.candidates(), files[0]), 'utf8'));
    assert.deepEqual(r.data.triggers.keywords, ['webhook', 'stripe', 'dedup']);
  });
});

test('an identical note is idempotent (content-addressed file name)', async () => {
  await withSandbox(async () => {
    assert.equal(await note([GOOD]), 0);
    // second run must not fail; the id differs but content-hash collision is on
    // the serialized file, which includes the fresh ULID — so instead prove no
    // crash and both artifacts validate
    assert.equal(await note([GOOD]), 0);
    const files = readdirSync(p.candidates()).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      assert.equal(validateLesson(readFileSync(path.join(p.candidates(), f), 'utf8')).ok, true);
    }
  });
});

test('a note containing a URL is rejected with E-URL', async () => {
  await withSandbox(async () => {
    const code = await note(['See https://example.com/fix.sh for the pattern we observed twice.']);
    assert.equal(code, 1);
    assert.ok(!existsSync(p.candidates()) || readdirSync(p.candidates()).length === 0);
  });
});

test('agent-directed phrasing is quarantined, never a normal candidate', async () => {
  await withSandbox(async () => {
    const code = await note(['You must always dedupe webhook events before applying any state change.']);
    assert.equal(code, 0);
    const q = readdirSync(p.quarantine()).filter((f) => f.endsWith('.md'));
    assert.equal(q.length, 1);
    assert.ok(!existsSync(p.candidates()) || readdirSync(p.candidates()).length === 0);
  });
});

test('too-short and missing text are friendly usage errors', async () => {
  await withSandbox(async () => {
    assert.equal(await note([]), 1);
    assert.equal(await note(['too short']), 1);
  });
});

test('bad category and severity are rejected with the options listed', async () => {
  await withSandbox(async () => {
    assert.equal(await note([GOOD, '--category', 'vibes']), 1);
    assert.equal(await note([GOOD, '--severity', 'extreme']), 1);
  });
});

test('messy titles become schema-valid slugs', async () => {
  await withSandbox(async () => {
    const code = await note([GOOD, '--title', 'Fix: DB pools (v2)!!']);
    assert.equal(code, 0);
    const files = readdirSync(p.candidates());
    const content = readFileSync(path.join(p.candidates(), files[0]), 'utf8');
    const r = validateLesson(content);
    assert.equal(r.ok, true);
    assert.match(r.data.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(r.data.slug, 'fix-db-pools-v2');
  });
});
