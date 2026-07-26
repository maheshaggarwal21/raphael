// Phase 17.2 — the machine curator: reviewer screen (fail-closed), canary gate
// with whole-batch rollback, tier 'machine', quarantine floor + 30-day sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
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

// Each generated candidate must be a GENUINELY different lesson, not the same
// sentence with a different number — the curator now holds near-duplicates, so
// fixtures that restate one another would (correctly) be held instead of activated.
const TOPICS = [
  { slug: 'retry-backoff', title: 'Retry storms without backoff amplify an outage', body: 'Repeated retries fired without exponential backoff multiply load against an already-failing dependency and turn a brief blip into a sustained outage.' },
  { slug: 'utc-timestamps', title: 'Store timestamps in UTC and convert only at the edge', body: 'Persisting local times makes every comparison depend on the writer machine, so daylight-saving shifts silently reorder records; UTC in storage keeps ordering stable.' },
  { slug: 'bounded-queues', title: 'Give background queues a bounded size', body: 'An unbounded work queue absorbs a producer spike until memory runs out and the process dies, losing everything queued; a bounded queue sheds load in a way you can observe.' },
  { slug: 'idempotent-migrations', title: 'Make data migrations idempotent', body: 'A migration that cannot be re-run safely blocks recovery, because a partial failure leaves no path forward except manual repair of half-migrated rows.' },
  { slug: 'pin-ci-images', title: 'Pin CI base images to a digest', body: 'A floating image tag lets the build environment change underneath a green pipeline, so a build that passed yesterday fails today for reasons absent from the diff.' },
  { slug: 'close-file-handles', title: 'Close file handles on the error path too', body: 'A handle leaked when an exception skips the close call exhausts the descriptor limit under sustained failure, which then breaks unrelated parts of the process.' }
];
let n = 0;
function candData(overrides = {}) {
  const topic = TOPICS[n % TOPICS.length];
  n++;
  return {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: `cur-${topic.slug}-${n}`,
    title: `${topic.title} (case ${n})`,
    status: 'candidate',
    category: 'reliability',
    severity: 'medium',
    scope: { stacks: ['node'], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords: [`curtest${n}`], paths: [] },
    lesson: topic.body,
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

// REGRESSION (audit 2026-07-26, finding 3.1b): reviewLesson rethrows E-LIMIT and
// curateStaged had NO try/catch, so a limit mid-batch escaped the function. Items
// already activated in that batch were live in the brain having skipped the canary
// gate, the 'machine-curated' events AND the commit — the exact opposite of the
// module's contract — and the throw exited the CLI 2 (crash) instead of 4 (limit).
test('full: a limit mid-batch still gates the partial batch, logs it, and reports limited', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const b = stage();
    const c = stage();
    let call = 0;
    const model = async () => {
      call++;
      if (call === 2) { const e = new Error('E-LIMIT: session limit reached'); e.code = 'E-LIMIT'; e.resetText = '5pm'; throw e; }
      return safeVerdict;
    };

    // must NOT throw: the limit is a reported outcome, not a crash
    const res = await curateStaged([a, b, c], { origin: 'mined', config: FULL, project: 'projX', callModel: model });

    assert.equal(res.limited, true, 'the limit is reported to the caller');
    assert.equal(res.limit.resetText, '5pm');
    assert.equal(res.activated.length, 1, 'the first candidate activated and stands');
    assert.equal(res.rolledBack, false, 'the canary gate passed for the partial batch');
    assert.equal(call, 2, 'no further reviewer calls after the limit');

    // the activated lesson exists AND has its audit event (the hole was an
    // active lesson with no event and no gate)
    const active = res.activated[0];
    assert.ok(existsSync(active.path), 'activated lesson is on disk');
    const events = readEvents().filter((e) => e.event === 'machine-curated');
    assert.equal(events.length, 1, 'exactly one audit event for the one activation');
    assert.equal(events[0].id, active.id);

    // the un-reviewed candidates are still candidates — nothing was dropped
    const remaining = listCandidates().map((x) => x.data.slug);
    assert.ok(remaining.includes(b.slug), 'the limited candidate stays in the queue');
    assert.ok(remaining.includes(c.slug), 'candidates after the limit stay in the queue');
    assert.equal(remaining.includes(a.slug), false, 'the activated one left the queue');
  } finally {
    cleanup(home);
  }
});

test('full: a limit on the FIRST candidate activates nothing and still reports limited', async () => {
  const home = sandbox();
  try {
    const a = stage();
    const model = async () => { const e = new Error('E-LIMIT: weekly limit'); e.code = 'E-LIMIT'; throw e; };
    const res = await curateStaged([a], { origin: 'mined', config: FULL, callModel: model });
    assert.equal(res.limited, true);
    assert.equal(res.activated.length, 0);
    assert.equal(res.rolledBack, false);
    assert.equal(readEvents().filter((e) => e.event === 'machine-curated').length, 0);
    assert.ok(listCandidates().some((x) => x.data.slug === a.slug), 'nothing lost');
  } finally {
    cleanup(home);
  }
});

test('full: a non-limit reviewer throw is NOT swallowed as a limit', async () => {
  const home = sandbox();
  try {
    const a = stage();
    // a coded non-limit error must still surface (reviewLesson catches plain
    // transport errors itself; a programming error must not be mistaken for a limit)
    const model = async () => { const e = new TypeError('bad arguments'); e.code = 'E-BUG'; throw e; };
    const res = await curateStaged([a], { origin: 'mined', config: FULL, callModel: model });
    assert.equal(res.limited, false, 'not a limit');
    assert.equal(res.activated.length, 0, 'fail-closed: held, not activated');
    assert.match(res.skipped[0].why, /reviewer/);
  } finally {
    cleanup(home);
  }
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

    // Both carry their own quarantined_at stamp. Age the OLD one by rewriting
    // that stamp — not the file mtime, which is what the sweep used to trust.
    const stamped = readFileSync(old.path, 'utf8');
    assert.match(stamped, /quarantined_at:/, 'a quarantined candidate records when it was quarantined');
    const past = new Date(Date.now() - 40 * 86400000);
    writeFileSync(old.path, stamped.replace(/quarantined_at: .*/, `quarantined_at: '${past.toISOString()}'`), 'utf8');

    // REGRESSION (audit 2026-07-26): touching the FRESH file's mtime — which a
    // backup, a cloud-sync client or a git checkout does routinely — must no
    // longer age it. Under the old mtime rule this alone expired it.
    utimesSync(fresh.path, past, past);

    const res = sweepQuarantine({});
    assert.equal(res.expired.length, 1, 'only the genuinely old one expires');
    assert.equal(existsSync(old.path), false);
    assert.equal(existsSync(fresh.path), true, 'an old mtime is not evidence of an old quarantine');
    // tombstoned into rejection memory
    const memory = readFileSync(p.rejectedMemory(), 'utf8');
    assert.match(memory, /quarantine-expired/);
    const events = readEvents();
    assert.equal(events.filter((e) => e.event === 'quarantine-expired').length, 1);
  } finally {
    cleanup(home);
  }
});

// --- near-duplicate gate on the UNATTENDED path -------------------------------
// This is the path the real duplicate slipped through: autopilot activates with no
// human watching, so a re-worded restatement of an existing lesson must be HELD.

test('curator HOLDS a re-worded duplicate of an already-active lesson (never auto-activates it)', async () => {
  const home = sandbox();
  try {
    const first = stage({
      slug: 'engines-node-floor-is-a-minimum',
      title: 'Treat an engines.node floor as a minimum, not a pin',
      lesson: 'A package.json engines.node range like >=18 is a minimum floor, not a pin: it still allows current Node, so an end-of-life floor is a nudge to raise the minimum rather than a hard failure.'
    });
    const r1 = await curateStaged([first], { origin: 'mined', config: FULL, project: 'projX', callModel: fakeModel() });
    assert.equal(r1.activated.length, 1, 'the first one activates normally');

    // same rule, different words and slug — exactly what the trigram dedupe misses
    const twin = stage({
      slug: 'open-floor-treated-as-hard-eol-pin',
      title: 'Open floor version constraint treated as hard EOL pin',
      lesson: 'A version constraint like engines.node >=18 declares a minimum floor, not a pinned release. Flagging >=18 as a failure because 18 is EOL overlooks that the constraint still allows supported versions above 18.'
    });
    const model = fakeModel();
    const r2 = await curateStaged([twin], { origin: 'mined', config: FULL, project: 'projX', callModel: model });

    assert.equal(r2.activated.length, 0, 'the duplicate must NOT be machine-activated');
    assert.equal(r2.skipped.length, 1);
    assert.match(r2.skipped[0].why, /near-duplicate/);
    assert.equal(r2.skipped[0].duplicates[0].slug, 'engines-node-floor-is-a-minimum');
    // held BEFORE the reviewer call — a duplicate should not even cost a model round-trip
    assert.equal(model.calls.length, 0, 'no reviewer tokens spent on a known duplicate');
    // and it survives as a candidate for a human to judge, not silently deleted
    assert.equal(existsSync(twin.path), true, 'the held candidate stays on disk');
  } finally {
    cleanup(home);
  }
});

test('curator still activates a genuinely distinct lesson alongside an existing one', async () => {
  const home = sandbox();
  try {
    await curateStaged([stage()], { origin: 'mined', config: FULL, project: 'projX', callModel: fakeModel() });
    const res = await curateStaged([stage()], { origin: 'mined', config: FULL, project: 'projX', callModel: fakeModel() });
    assert.equal(res.activated.length, 1, 'a different lesson must not be held');
  } finally {
    cleanup(home);
  }
});

// REGRESSION (audit 2026-07-26, finding 3.11): the schema defines
// counter_indications as a STRING and the curator called .join() on it. The
// TypeError was swallowed by the fail-closed catch and logged as "reviewer call
// failed", so autopilot could never machine-activate ANY candidate carrying the
// boundary field the extraction prompt explicitly solicits — and misattributed it
// to a transport failure. No fixture carried the field, so nothing caught it.
test('full: a candidate WITH counter_indications activates, and the reviewer sees them', async () => {
  const home = sandbox();
  try {
    const item = stage({
      counter_indications: 'Not for single-process scripts where the queue never outlives the run.'
    });
    const model = fakeModel();
    const res = await curateStaged([item], { origin: 'mined', config: FULL, project: 'projX', callModel: model });

    assert.equal(res.activated.length, 1, 'counter_indications must not block activation');
    assert.equal(res.skipped.length, 0);
    assert.match(model.calls[0].prompt, /counter_indications: Not for single-process scripts/);
  } finally {
    cleanup(home);
  }
});

test('reviewLesson: counter_indications as string, array, empty, and absent', async () => {
  const seen = [];
  const model = async (args) => { seen.push(args.prompt); return safeVerdict; };

  await reviewLesson({ data: candData({ counter_indications: 'a string boundary' }), body: '' }, { callModel: model, model: null });
  assert.match(seen.at(-1), /counter_indications: a string boundary/);

  // an array is tolerated rather than throwing (this text only feeds a prompt)
  await reviewLesson({ data: candData({ counter_indications: ['one', 'two'] }), body: '' }, { callModel: model, model: null });
  assert.match(seen.at(-1), /counter_indications: one; two/);

  // empty / absent add no line at all
  await reviewLesson({ data: candData({ counter_indications: '   ' }), body: '' }, { callModel: model, model: null });
  assert.equal(/counter_indications/.test(seen.at(-1)), false);
  await reviewLesson({ data: candData(), body: '' }, { callModel: model, model: null });
  assert.equal(/counter_indications/.test(seen.at(-1)), false);
});
