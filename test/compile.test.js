import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIndex, verifyIndex, loadIndex } from '../src/lib/compile.js';
import { makeLesson, writeActiveLesson } from './helpers.js';
import { atomicWrite } from '../src/lib/files.js';
import { p } from '../src/lib/paths.js';

async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-compile-'));
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

test('buildIndex indexes active lessons, skips invalid ones, ignores non-active', async () => {
  await withSandbox(async () => {
    writeActiveLesson({ slug: 'good-one' });
    // schema-valid but chokepoint-rejected (URL in lesson text)
    atomicWrite(
      path.join(p.lessons(), 'tooling', 'bad-one.XXXXXXXX.md'),
      makeLesson({ slug: 'bad-one', lesson: 'See https://example.com for the fix to this recurring problem in builds.' })
    );
    // valid but not an active/probation status → seen, not indexed, not an error
    atomicWrite(
      path.join(p.lessons(), 'tooling', 'cand-one.XXXXXXXX.md'),
      makeLesson({ slug: 'cand-one', status: 'candidate' })
    );

    const { count, skipped } = buildIndex();
    assert.equal(count, 1);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0].codes.includes('E-URL'));

    const index = JSON.parse(readFileSync(p.compiledIndex(), 'utf8'));
    assert.equal(index.schema, 'raphael/index/v1');
    assert.equal(index.lessons.length, 1);
    assert.equal(index.lessons[0].slug, 'good-one');
    assert.ok(index.lessons[0].hash.length === 64); // sha256 hex
    assert.equal(index.built_files.length, 3); // all seen files remembered
    assert.ok(verifyIndex(index));
  });
});

test('loadIndex builds on first use and does not rebuild when nothing changed', async () => {
  await withSandbox(async () => {
    writeActiveLesson();
    assert.equal(existsSync(p.compiledIndex()), false);
    const first = loadIndex();
    assert.equal(first.rebuilt, true);
    assert.equal(first.lessons.length, 1);
    const second = loadIndex();
    assert.equal(second.rebuilt, false);
  });
});

test('a hand-edited lesson file is detected by content hash and re-indexed', async () => {
  await withSandbox(async () => {
    const { file } = writeActiveLesson({ slug: 'edit-me' });
    loadIndex(); // build
    const edited = readFileSync(file, 'utf8').replace(
      'no event-id dedup',
      'no dedup at all anywhere'
    );
    writeFileSync(file, edited, 'utf8'); // deliberately not atomicWrite: simulates a hand edit
    const { lessons, rebuilt } = loadIndex();
    assert.equal(rebuilt, true);
    assert.ok(lessons[0].injection.headline.includes('no dedup at all anywhere'));
  });
});

test('adding or deleting a lesson file forces a rebuild', async () => {
  await withSandbox(async () => {
    const a = writeActiveLesson({ slug: 'first-one' });
    loadIndex();
    writeActiveLesson({ slug: 'second-one' });
    const afterAdd = loadIndex();
    assert.equal(afterAdd.rebuilt, true);
    assert.equal(afterAdd.lessons.length, 2);

    rmSync(a.file, { force: true });
    const afterDelete = loadIndex();
    assert.equal(afterDelete.rebuilt, true);
    assert.equal(afterDelete.lessons.length, 1);
    assert.equal(afterDelete.lessons[0].slug, 'second-one');
  });
});

test('a skipped-invalid file does not cause a rebuild loop, but fixing it is detected', async () => {
  await withSandbox(async () => {
    const badPath = path.join(p.lessons(), 'tooling', 'was-bad.XXXXXXXX.md');
    atomicWrite(
      badPath,
      makeLesson({ slug: 'was-bad', lesson: 'See https://example.com for the fix to this recurring problem in builds.' })
    );
    loadIndex(); // builds, skips the bad file
    const stable = loadIndex();
    assert.equal(stable.rebuilt, false); // no loop

    atomicWrite(badPath, makeLesson({ slug: 'was-bad' })); // fixed by hand
    const fixed = loadIndex();
    assert.equal(fixed.rebuilt, true);
    assert.ok(fixed.lessons.some((l) => l.slug === 'was-bad'));
  });
});

test('a corrupt compiled.json silently rebuilds', async () => {
  await withSandbox(async () => {
    writeActiveLesson();
    loadIndex();
    writeFileSync(p.compiledIndex(), '{ not json', 'utf8');
    const { lessons, rebuilt } = loadIndex();
    assert.equal(rebuilt, true);
    assert.equal(lessons.length, 1);
  });
});
