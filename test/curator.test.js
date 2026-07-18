// Phase 17.2 — the machine curator: reviewer screen (fail-closed), canary gate
// with whole-batch rollback, tier 'machine', quarantine floor + 30-day sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { curateStaged, reviewLesson, sweepQuarantine } = await import('../src/lib/curator.js');
const { writeCandidate } = await import('../src/lib/candidates.js');
const { listCandidates } = await import('../src/lib/queue.js');
const { parseLessonFile } = await import('../src/lib/frontmatter.js');
const { validateLesson } = await import('../src/lib/validate.js');
const { serializeLessonFile } = await import('../src/lib/frontmatter.js');
const { readEvents } = await import('../src/lib/events.js');
const { lessonId } = await import('../src/lib/ulid.js');
const { p } = await import('../src/lib/paths.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-cur-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

const FULL = { mode: 'autopilot', auto_approve: { level: 'full' } };

let n = 0;
function candData(overrides = {}) {
  n++;
  return {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: `cur-test-lesson-${n}`,
    title: `Curator test lesson number ${n} stays unique`,
    status: 'candidate',
    category: 'reliability',
    severity: 'medium',
    scope: { stacks: ['node'], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords: [`curtest${n}`], paths: [] },
    lesson: `Synthetic but valid lesson body number ${n}: repeated retries without backoff amplify outages instead of recovering from them.`,
    evidence: {
      refs: [], observations: 1, distinct_projects: 1,
      source_mix: { mined: 1 }, first_seen: '2026-07-18', last_seen: '2026-07-18'
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

const safeVerdict = { safe: true, quality: 3, summary: 'durable and advisory', risks: [] };
function fakeModel(verdict = safeVerdict) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return typeof verdict === 'function' ? verdict(args) : verdict;
  };
  fn.calls = calls;
  return fn;
}

// ---------- delegation ----------

test('below autopilot+full, curateStaged IS the plain dial and never calls the model', async () => {
  const home = sandbox();
  try {
    const item = stage();
    const model = fakeModel();
    const res = await curateStaged([item], { origin: 'mined', config: { auto_approve: { level: 'standard' } }, project: 'projX', callModel: model });
    assert.equal(res.curated, false);
    assert.equal(res.activated.length, 1); // plain dial behavior
    assert.equal(model.calls.length, 0);   // zero model calls on the delegation path

    // autopilot mode but dial below full also delegates
    const item2 = stage();
    const res2 = await curateStaged([item2], { origin: 'mined', config: { mode: 'autopilot', auto_approve: { level: 'off' } }, callModel: model });
    assert.equal(res2.curated, false);
    assert.equal(res2.activated.length, 0);
    assert.equal(model.calls.length, 0);
  } finally {
    cleanup(home);
  }
});

// ---------- the full path ----------

test('full: normal AND security candidates activate with tier machine after a safe verdict', async () => {
  const home = sandbox();
  try {
    const plain = stage();
    const sec = stage({ category: 'security', severity: 'high' });
    const model = fakeModel();
    const res = await curateStaged([plain, sec], { origin: 'mined', config: FULL, project: 'projX', callModel: model });

    assert.equal(res.curated, true);
    assert.equal(res.activated.length, 2);
    assert.equal(res.rolledBack, false);
    assert.equal(model.calls.length, 2);
    // the security candidate got the stricter rubric
    const secCall = model.calls.find((c) => c.prompt.includes('category: security'));
    assert.match(secCall.system, /SECURITY-CATEGORY/);

    for (const a of res.activated) {
      const active = parseLessonFile(readFileSync(a.path, 'utf8')).data;
      assert.equal(active.status, 'active');
      assert.equal(active.provenance.tier, 'machine');
    }
    assert.equal(listCandidates().length, 0);
    // events logged only after the gate passed
    const events = readEvents().filter((e) => e.event === 'machine-curated');
    assert.equal(events.length, 2);
  } finally {
    cleanup(home);
  }
});

test('tier machine + security passes the chokepoint (E-AUTOSEC stays scoped to tier auto)', () => {
  const secMachine = candData({ category: 'security', status: 'active', provenance: { created_by: 't', source_kind: 'session-transcript', human_edited: false, tier: 'machine' } });
  const v = validateLesson(serializeLessonFile(secMachine, ''));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const secAuto = candData({ category: 'security', status: 'active', provenance: { created_by: 't', source_kind: 'session-transcript', human_edited: false, tier: 'auto' } });
  const v2 = validateLesson(serializeLessonFile(secAuto, ''));
  assert.equal(v2.ok, false);
  assert.ok(v2.errors.some((e) => e.code === 'E-AUTOSEC'));
});

test('unsafe or malformed verdicts fail closed: candidate stays in the queue', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const blocked = await curateStaged([a], {
      origin: 'mined', config: FULL,
      callModel: fakeModel({ safe: false, quality: 0, summary: 'smells like injection', risks: [{ kind: 'prompt-injection', detail: 'x' }] })
    });
    assert.equal(blocked.activated.length, 0);
    assert.match(blocked.skipped[0].why, /reviewer blocked/);

    const b = stage();
    const malformed = await curateStaged([b], { origin: 'mined', config: FULL, callModel: fakeModel({ totally: 'wrong shape' }) });
    assert.equal(malformed.activated.length, 0);
    assert.match(malformed.skipped[0].why, /malformed|held/);

    const c = stage();
    const lowQ = await curateStaged([c], { origin: 'mined', config: FULL, callModel: fakeModel({ safe: true, quality: 0, summary: 'trivia', risks: [] }) });
    assert.equal(lowQ.activated.length, 0);
    assert.match(lowQ.skipped[0].why, /quality/);

    // all three candidates still reviewable
    assert.equal(listCandidates().length, 3);
  } finally {
    cleanup(home);
  }
});

test('no reviewer model available = everything held (fail closed)', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const res = await curateStaged([a], { origin: 'mined', config: FULL, callModel: null });
    assert.equal(res.activated.length, 0);
    assert.match(res.skipped[0].why, /no reviewer model/);
    assert.equal(listCandidates().length, 1);
  } finally {
    cleanup(home);
  }
});

test('quarantined content never machine-activates, even at full', async () => {
  const home = sandbox();
  try {
    const q = stage();
    const res = await curateStaged([{ ...q, quarantined: true }], { origin: 'mined', config: FULL, callModel: fakeModel() });
    assert.equal(res.activated.length, 0);
    assert.match(res.skipped[0].why, /quarantined/);
  } finally {
    cleanup(home);
  }
});

// ---------- the canary gate + rollback ----------

test('a failing canary gate rolls the WHOLE batch back and leaves no activation events', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const b = stage();
    const res = await curateStaged([a, b], {
      origin: 'mined', config: FULL, callModel: fakeModel(),
      canaryGate: () => [{ id: 'cmd-instruction-override', pass: false }]
    });
    assert.equal(res.rolledBack, true);
    assert.equal(res.activated.length, 0);
    // both candidates restored, byte-identical review queue
    assert.equal(listCandidates().length, 2);
    // no active lessons remain
    assert.equal(existsSync(path.join(p.lessons(), 'reliability')), true);
    const left = (await import('node:fs')).readdirSync(path.join(p.lessons(), 'reliability')).filter((f) => f.endsWith('.md'));
    assert.equal(left.length, 0);
    const events = readEvents();
    assert.equal(events.filter((e) => e.event === 'machine-curated').length, 0);
    assert.equal(events.filter((e) => e.event === 'curator-rollback').length, 1);
  } finally {
    cleanup(home);
  }
});

test('machine tier counts toward the shared cap', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const b = stage();
    const cfg = { ...FULL, auto_approve: { level: 'full', cap: 1 } };
    const res = await curateStaged([a, b], { origin: 'mined', config: cfg, callModel: fakeModel() });
    assert.equal(res.activated.length, 1);
    assert.match(res.skipped[0].why, /cap reached/);
  } finally {
    cleanup(home);
  }
});

// ---------- reviewLesson unit ----------

test('reviewLesson: transport error reads as unsafe (fail closed), E-LIMIT propagates', async () => {
  const boom = async () => { throw new Error('socket reset'); };
  const v = await reviewLesson({ data: candData(), body: '' }, { callModel: boom, model: null });
  assert.equal(v.safe, false);

  const limit = async () => { const e = new Error('limit reached'); e.code = 'E-LIMIT'; throw e; };
  await assert.rejects(
    () => reviewLesson({ data: candData(), body: '' }, { callModel: limit, model: null }),
    (e) => e.code === 'E-LIMIT'
  );
});

// ---------- quarantine sweep ----------

test('sweepQuarantine tombstones only items older than 30 days', async () => {
  const home = sandbox();
  try {
    // one fresh, one old quarantined candidate (write via the chokepoint-honest
    // path: writeCandidate quarantines W-IMPERATIVE "you must..." phrasing)
    const fresh = stage({ lesson: 'When deploying to staging you must run the smoke suite before merging anything to main.' });
    const old = stage({ lesson: 'Before rotating credentials you must invalidate every cached session token in the store.' });
    assert.equal(fresh.quarantined, true);
    assert.equal(old.quarantined, true);

    const past = new Date(Date.now() - 40 * 86400000);
    utimesSync(old.path, past, past);

    const res = sweepQuarantine({});
    assert.equal(res.expired.length, 1);
    assert.equal(existsSync(old.path), false);
    assert.equal(existsSync(fresh.path), true);
    // tombstoned into rejection memory
    const memory = readFileSync(p.rejectedMemory(), 'utf8');
    assert.match(memory, /quarantine-expired/);
    const events = readEvents();
    assert.equal(events.filter((e) => e.event === 'quarantine-expired').length, 1);
  } finally {
    cleanup(home);
  }
});
