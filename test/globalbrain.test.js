// Phase 17.6 — the global brain: seed from the packaged copy, weekly down-sync
// from the pinned manifest, hash verification, local-wins dedupe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  seedGlobalBrain, syncGlobalBrain, activateGlobalLessons, readPackagedGlobalBrain,
  packagedGlobalBrainDir, readSyncState
} = await import('../src/lib/globalbrain.js');
const { readActiveLessons } = await import('../src/lib/freshness.js');
const { readEvents } = await import('../src/lib/events.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-gb-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}
const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

test('the packaged global brain is valid and self-consistent (manifest hashes match)', () => {
  const { manifest, lessons } = readPackagedGlobalBrain();
  assert.equal(manifest.schema, 'raphael/global-brain/v1');
  assert.ok(manifest.version >= 1);
  assert.equal(manifest.count, lessons.length);
  assert.ok(lessons.length >= 26);
  const bySlug = new Map(manifest.lessons.map((e) => [e.slug, e]));
  for (const l of lessons) {
    assert.equal(sha(l), bySlug.get(l.slug).sha256, `hash mismatch for ${l.slug}`);
  }
});

test('seed activates the whole global brain as curated ACTIVE lessons; reseeding is a no-op', () => {
  const home = sandbox();
  try {
    const first = seedGlobalBrain();
    assert.ok(first.activated.length >= 26);
    assert.equal(first.skipped.length, 0);
    const active = readActiveLessons();
    assert.equal(active.length, first.activated.length);
    assert.ok(active.every((l) => l.provenance.tier === 'curated' && l.status === 'active'));
    // security lessons seeded active WITHOUT tier auto — E-AUTOSEC untouched
    assert.ok(active.some((l) => l.category === 'security'));
    // state recorded
    assert.ok(readSyncState().version >= 1);
    assert.ok(readSyncState().seeded_at);

    const again = seedGlobalBrain();
    assert.equal(again.activated.length, 0);
    assert.ok(again.skipped.every((s) => /local brain/.test(s.why)));
  } finally {
    cleanup(home);
  }
});

test('a tampered lesson is refused by the manifest hash', () => {
  const home = sandbox();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-gbfix-'));
  try {
    const { manifest, lessons } = readPackagedGlobalBrain();
    const tampered = lessons.map((l, i) => i === 0 ? { ...l, lesson: l.lesson + ' EVIL ADDITION' } : l);
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify(tampered));
    const res = seedGlobalBrain({ dir });
    assert.equal(res.activated.length, lessons.length - 1);
    const refused = res.skipped.find((s) => /hash mismatch/.test(s.why));
    assert.ok(refused);
    assert.equal(refused.slug, lessons[0].slug);
  } finally {
    cleanup(home);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('down-sync: newer remote version activates only NEW lessons; throttle + malformed refusals hold', async () => {
  const home = sandbox();
  try {
    seedGlobalBrain(); // v1 in place
    const { manifest, lessons } = readPackagedGlobalBrain();

    // remote v2 adds one lesson (a copy with new slug/id, altered text)
    const extra = {
      ...lessons[0],
      slug: 'brand-new-global-lesson',
      id: 'les_01KXSXTESTTESTTESTTESTTEST',
      title: 'A brand new lesson arriving via down-sync only',
      lesson: 'A framework upgrade note that only exists in version two of the global brain, for sync testing.',
      injection: { headline: 'A v2-only global lesson used to verify the weekly down-sync path.', tokens: 14 }
    };
    const v2lessons = [...lessons, extra];
    const v2manifest = {
      ...manifest,
      version: manifest.version + 1,
      count: v2lessons.length,
      lessons: v2lessons.map((l) => ({ slug: l.slug, id: l.id, category: l.category, severity: l.severity, sha256: sha(l) }))
    };
    const fetcher = async (url) => ({ text: url.includes('manifest') ? JSON.stringify(v2manifest) : JSON.stringify(v2lessons) });

    const res = await syncGlobalBrain({ fetcher });
    assert.equal(res.updated, true);
    assert.equal(res.activated.length, 1); // ONLY the new lesson; existing 26 skipped (local wins)
    assert.equal(res.activated[0].slug, 'brand-new-global-lesson');
    assert.equal(readSyncState().version, v2manifest.version);
    assert.ok(readEvents().some((e) => e.event === 'global-brain-sync'));

    // throttle: immediate re-check is refused
    const again = await syncGlobalBrain({ fetcher });
    assert.equal(again.checked, false);

    // 8 days later: up-to-date short-circuit (no bundle fetch needed)
    let bundleFetched = false;
    const fetcher2 = async (url) => {
      if (url.includes('lessons')) bundleFetched = true;
      return { text: JSON.stringify(v2manifest) };
    };
    const later = await syncGlobalBrain({ now: Date.now() + 8 * 86400000, fetcher: fetcher2 });
    assert.equal(later.updated, false);
    assert.equal(bundleFetched, false);
  } finally {
    cleanup(home);
  }
});

test('down-sync fails open on fetch errors and refuses malformed manifests', async () => {
  const home = sandbox();
  try {
    const boom = async () => { throw new Error('offline'); };
    const res = await syncGlobalBrain({ fetcher: boom });
    assert.equal(res.checked, true);
    assert.equal(res.updated, false);
    assert.match(res.why, /offline/);
    // last_check still advanced — no hammering while offline
    assert.ok(readSyncState().last_check > 0);

    const malformed = await syncGlobalBrain({ now: Date.now() + 8 * 86400000, fetcher: async () => ({ text: '{"schema":"nope"}' }) });
    assert.equal(malformed.updated, false);
    assert.match(malformed.why, /malformed/);
  } finally {
    cleanup(home);
  }
});

test('activateGlobalLessons refuses lessons missing from the manifest', () => {
  const home = sandbox();
  try {
    const { manifest, lessons } = readPackagedGlobalBrain();
    const smuggled = { ...lessons[0], slug: 'smuggled-lesson', id: 'les_01KXSXSMUGGLEDSMUGGLEDSMUG' };
    const res = activateGlobalLessons({ manifest, lessons: [smuggled] }, { origin: 'sync' });
    assert.equal(res.activated.length, 0);
    assert.match(res.skipped[0].why, /not in the manifest/);
  } finally {
    cleanup(home);
  }
});
