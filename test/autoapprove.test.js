import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { dialLevel, dialCaps, autoApproveStaged, countAutoTier } = await import('../src/lib/autoapprove.js');
const { writeCandidate } = await import('../src/lib/candidates.js');
const { validateLesson } = await import('../src/lib/validate.js');
const { serializeLessonFile, parseLessonFile } = await import('../src/lib/frontmatter.js');
const { listCandidates } = await import('../src/lib/queue.js');
const { lessonId } = await import('../src/lib/ulid.js');
const { p } = await import('../src/lib/paths.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-auto-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

let n = 0;
function candData(overrides = {}) {
  n++;
  return {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: `dial-test-lesson-${n}`,
    title: `Dial test lesson number ${n} stays unique`,
    status: 'candidate',
    category: 'reliability',
    severity: 'medium',
    scope: { stacks: ['node'], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords: [`dialtest${n}`], paths: [] },
    lesson: `Synthetic but valid lesson body number ${n}: repeated retries without backoff amplify outages instead of recovering from them.`,
    evidence: {
      refs: [], observations: 1, distinct_projects: 1,
      source_mix: { mined: 1 }, first_seen: '2026-07-16', last_seen: '2026-07-16'
    },
    provenance: { created_by: 'test', source_kind: 'session-transcript', human_edited: false, tier: 'user' },
    injection: { headline: `Retry storms without backoff amplify outages (case ${n}).`, tokens: 12 },
    ...overrides
  };
}

function stage(overrides) {
  const data = candData(overrides);
  const w = writeCandidate(data);
  return { path: w.path, slug: data.slug, quarantined: w.quarantined };
}

test('dialLevel fails closed; caps default sanely', () => {
  assert.equal(dialLevel({}), 'off');
  assert.equal(dialLevel({ auto_approve: { level: 'banana' } }), 'off');
  assert.equal(dialLevel({ auto_approve: { level: 'wide' } }), 'wide');
  assert.deepEqual(dialCaps({}), { cap: 30, dailyCap: 10 });
  assert.deepEqual(dialCaps({ auto_approve: { cap: 5, daily_cap: 2 } }), { cap: 5, dailyCap: 2 });
});

test('off: nothing activates; standard: mined yes, adopted no', () => {
  const home = sandbox();
  try {
    const a = stage();
    const off = autoApproveStaged([a], { origin: 'mined', config: {} });
    assert.equal(off.activated.length, 0);
    assert.equal(listCandidates().length, 1);

    const std = { auto_approve: { level: 'standard' } };
    const adoptedHeld = autoApproveStaged([a], { origin: 'adopted', config: std });
    assert.equal(adoptedHeld.activated.length, 0); // adopted needs wide

    const minedGo = autoApproveStaged([a], { origin: 'mined', config: std, project: 'projX' });
    assert.equal(minedGo.activated.length, 1);
    assert.equal(listCandidates().length, 0);

    const active = parseLessonFile(readFileSync(minedGo.activated[0].path, 'utf8')).data;
    assert.equal(active.status, 'active');
    assert.equal(active.provenance.tier, 'auto');           // tagged, filterable
    assert.deepEqual(active.scope.projects, ['projX']);      // §9: this-project scope
    assert.equal(countAutoTier(), 1);
  } finally {
    cleanup(home);
  }
});

test('wide activates adopted material and records the adoption id', () => {
  const home = sandbox();
  try {
    const a = stage();
    const wide = { auto_approve: { level: 'wide' } };
    const r = autoApproveStaged([a], { origin: 'adopted', config: wide, adoption: 'adp_TEST' });
    assert.equal(r.activated.length, 1);
    const events = readFileSync(p.events(), 'utf8');
    const ev = events.split('\n').filter(Boolean).map(JSON.parse).find((e) => e.event === 'auto-approved');
    assert.equal(ev.origin, 'adopted');
    assert.equal(ev.adoption, 'adp_TEST');
  } finally {
    cleanup(home);
  }
});

test('the floor: security candidates never ride the dial, even at wide', () => {
  const home = sandbox();
  try {
    const sec = stage({ category: 'security', severity: 'critical' });
    const r = autoApproveStaged([sec], { origin: 'mined', config: { auto_approve: { level: 'wide' } } });
    assert.equal(r.activated.length, 0);
    assert.match(r.skipped[0].why, /security-category/);
    assert.equal(listCandidates().length, 1); // still waiting for a human

    // and the chokepoint backstop: tier auto + security is structurally invalid
    const forced = serializeLessonFile(candData({ category: 'security', status: 'active', provenance: { created_by: 't', source_kind: 'session-transcript', human_edited: false, tier: 'auto' } }));
    const check = validateLesson(forced);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.code === 'E-AUTOSEC'));
  } finally {
    cleanup(home);
  }
});

test('quarantined candidates are outside the dial', () => {
  const home = sandbox();
  try {
    const q = stage();
    const r = autoApproveStaged([{ ...q, quarantined: true }], { origin: 'mined', config: { auto_approve: { level: 'standard' } } });
    assert.equal(r.activated.length, 0);
    assert.match(r.skipped[0].why, /quarantined/);
  } finally {
    cleanup(home);
  }
});

test('caps: auto-tier cap halts activation visibly; adopted daily cap holds the flood', () => {
  const home = sandbox();
  try {
    const cfg = { auto_approve: { level: 'wide', cap: 1 } };
    const r = autoApproveStaged([stage(), stage()], { origin: 'mined', config: cfg });
    assert.equal(r.activated.length, 1);
    assert.match(r.skipped[0].why, /cap reached \(1\)/);

    const daily = { auto_approve: { level: 'wide', cap: 30, daily_cap: 0 } };
    const r2 = autoApproveStaged([stage()], { origin: 'adopted', config: daily });
    assert.equal(r2.activated.length, 0);
    assert.match(r2.skipped[0].why, /daily adopted-auto cap/);
  } finally {
    cleanup(home);
  }
});
