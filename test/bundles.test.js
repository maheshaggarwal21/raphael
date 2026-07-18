// Phase 17.7 — contribution bundles: permission gate, scrub pipeline, curated
// exclusion, throttle, local-stage-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  buildBundle, maybeBundleContributions, listBundles, eligibleForBundle,
  contributionEnabled, readContributedState
} = await import('../src/lib/contribute.js');
const { seedGlobalBrain } = await import('../src/lib/globalbrain.js');
const { writeActiveLesson } = await import('./helpers.js');
const { readEvents } = await import('../src/lib/events.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-bun-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

const GRANTED = { contribute: { enabled: true } };

let n = 0;
function localLesson(overrides = {}) {
  n++;
  return writeActiveLesson({
    slug: `bundle-local-lesson-${n}`,
    title: `Locally learned lesson number ${n} for bundling`,
    lesson: `Synthetic but valid local lesson ${n}: connection pools sized above the database limit cause cascading refusals under load.`,
    injection: { headline: `Oversized connection pools cascade refusals under load (case ${n}).`, tokens: 14 },
    provenance: { created_by: 'test', source_kind: 'session-transcript', human_edited: false, tier: 'user' },
    ...overrides
  });
}

test('permission #2 off (default) = buildBundle refuses; nothing staged, ever', () => {
  const home = sandbox();
  try {
    localLesson(); localLesson(); localLesson();
    assert.equal(contributionEnabled({}), false);
    const res = buildBundle({ config: {} });
    assert.ok(res.refused);
    assert.equal(listBundles().length, 0);
  } finally {
    cleanup(home);
  }
});

test('a bundle stages scrubbed local lessons; curated (global) lessons are excluded', () => {
  const home = sandbox();
  try {
    seedGlobalBrain(); // 26 curated lessons — must NOT be bundled back up
    localLesson({ scope: { stacks: ['node'], task_kinds: [], projects: ['secret-client-project'], agents: [] } });
    localLesson();
    localLesson();

    const eligible = eligibleForBundle();
    assert.equal(eligible.length, 3); // only the local three

    const res = buildBundle({ config: GRANTED });
    assert.equal(res.count, 3);
    const bundle = JSON.parse(readFileSync(res.staged, 'utf8'));
    assert.equal(bundle.schema, 'raphael/contribution-bundle/v1');
    assert.equal(bundle.lessons.length, 3);
    // local traces stripped by the export pipeline
    for (const l of bundle.lessons) {
      assert.deepEqual(l.scope.projects, []);
      assert.equal(l.evidence?.refs, undefined);
    }
    assert.ok(readEvents().some((e) => e.event === 'bundle-staged'));

    // already-bundled lessons never re-bundle
    const again = buildBundle({ config: GRANTED });
    assert.ok(again.refused);
    assert.equal(eligibleForBundle().length, 0);
  } finally {
    cleanup(home);
  }
});

test('maybeBundleContributions: weekly throttle + minimum size', () => {
  const home = sandbox();
  try {
    localLesson(); localLesson();
    // only 2 lessons: below the minimum
    const small = maybeBundleContributions({ config: GRANTED });
    assert.equal(small.built, false);

    localLesson();
    const first = maybeBundleContributions({ config: GRANTED });
    assert.equal(first.built, true);

    // three more lessons, but the throttle holds for a week
    localLesson(); localLesson(); localLesson();
    const throttled = maybeBundleContributions({ config: GRANTED });
    assert.equal(throttled.built, false);
    assert.match(throttled.why, /recently/);

    // a week later it builds again
    const later = maybeBundleContributions({ config: GRANTED, now: Date.now() + 8 * 86400000 });
    assert.equal(later.built, true);
    assert.equal(later.count, 3);
  } finally {
    cleanup(home);
  }
});

test('a lesson that fails the export chokepoint is skipped, not fatal', () => {
  const home = sandbox();
  try {
    localLesson(); localLesson();
    // a lesson whose body will trip the scrub->validate path: embed a fake AWS key
    localLesson({ lesson: 'Deploy tokens like AKIA' + 'IOSFODNN7EXAMPLE embedded in code leak on push; rotation is the only fix after exposure.' });
    const res = buildBundle({ config: GRANTED });
    // the clean two ship; the dirty one is either scrubbed-clean or skipped — never raw
    const bundle = JSON.parse(readFileSync(res.staged, 'utf8'));
    for (const l of bundle.lessons) assert.ok(!/AKIA[A-Z0-9]{16}/.test(JSON.stringify(l)), 'no raw key may leave');
    assert.equal(res.count + res.skipped.length, 3);
  } finally {
    cleanup(home);
  }
});
