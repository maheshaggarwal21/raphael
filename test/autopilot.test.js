// Phase 17.1 — mode + global consent + the FULL dial level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  loadConfig, saveConfig, getMode, setMode, hasConsent, setConsentScope, setProjectConsent
} = await import('../src/lib/config.js');
const { DIAL_LEVELS, dialLevel, setDial, autoApproveStaged } = await import('../src/lib/autoapprove.js');
const { writeCandidate } = await import('../src/lib/candidates.js');
const { listCandidates } = await import('../src/lib/queue.js');
const { lessonId } = await import('../src/lib/ulid.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-ap-'));
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
    slug: `ap-test-lesson-${n}`,
    title: `Autopilot test lesson number ${n} stays unique`,
    status: 'candidate',
    category: 'reliability',
    severity: 'medium',
    scope: { stacks: ['node'], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords: [`aptest${n}`], paths: [] },
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

// ---------- mode ----------

test('getMode fails closed to curator; setMode validates and persists', () => {
  const home = sandbox();
  try {
    assert.equal(getMode({}), 'curator');
    assert.equal(getMode({ mode: 'banana' }), 'curator');
    assert.equal(getMode({ mode: 'autopilot' }), 'autopilot');

    setMode('autopilot');
    assert.equal(getMode(loadConfig()), 'autopilot');
    setMode('curator');
    assert.equal(getMode(loadConfig()), 'curator');
    assert.throws(() => setMode('yolo'), /E-CONFIG/);
  } finally {
    cleanup(home);
  }
});

// ---------- global consent ----------

test('hasConsent: scope all grants unregistered projects; ignore list blocks subtrees', () => {
  const home = sandbox();
  try {
    const proj = path.join(home, 'work', 'appA');
    const secret = path.join(home, 'private', 'diary');
    const secretChild = path.join(secret, 'sub', 'deep');

    // no scope, no registry -> undefined (caller must ask)
    assert.equal(hasConsent(loadConfig(), proj), undefined);

    setConsentScope('all', { ignore: [secret] });
    const cfg = loadConfig();
    assert.equal(hasConsent(cfg, proj), true);
    assert.equal(hasConsent(cfg, secret), false);
    assert.equal(hasConsent(cfg, secretChild), false); // subtree blocked

    // a sibling that merely PREFIXES the ignored name is NOT blocked
    assert.equal(hasConsent(cfg, secret + 'x'), true);
  } finally {
    cleanup(home);
  }
});

test('hasConsent: an explicit per-project answer beats the global grant', () => {
  const home = sandbox();
  try {
    const refused = path.join(home, 'work', 'no-thanks');
    setConsentScope('all');
    setProjectConsent(refused, false);
    const cfg = loadConfig();
    assert.equal(hasConsent(cfg, refused), false);
    assert.equal(hasConsent(cfg, path.join(home, 'work', 'other')), true);
  } finally {
    cleanup(home);
  }
});

test('setConsentScope validates input and records the grant date', () => {
  const home = sandbox();
  try {
    assert.throws(() => setConsentScope('everything'), /E-CONFIG/);
    assert.throws(() => setConsentScope('all', { ignore: [42] }), /E-CONFIG/);
    setConsentScope('all');
    const cfg = loadConfig();
    assert.equal(cfg.consent.scope, 'all');
    assert.match(cfg.consent.granted, /^\d{4}-\d{2}-\d{2}$/);
    // scope registered = back to per-project asking
    setConsentScope('registered');
    assert.equal(hasConsent(loadConfig(), path.join(home, 'x')), undefined);
  } finally {
    cleanup(home);
  }
});

// ---------- the FULL dial level ----------

test('full is a valid dial level; adopted rides at full; security/quarantine still skip the plain dial', () => {
  const home = sandbox();
  try {
    assert.ok(DIAL_LEVELS.includes('full'));
    const cfg = {};
    setDial(cfg, { level: 'full' });
    assert.equal(dialLevel(cfg), 'full');

    // adopted-origin candidates activate at full (as at wide)
    const plain = stage();
    const go = autoApproveStaged([plain], { origin: 'adopted', config: cfg });
    assert.equal(go.activated.length, 1);

    // security still never rides the PLAIN dial — it belongs to the curator path
    const sec = stage({ category: 'security', severity: 'high' });
    const held = autoApproveStaged([sec], { origin: 'mined', config: cfg, project: 'projX' });
    assert.equal(held.activated.length, 0);
    assert.match(held.skipped[0].why, /machine-curator/);
    assert.equal(listCandidates().some((c) => c.data.slug === sec.slug), true);

    // quarantined: never, at any level
    const q = stage();
    const heldQ = autoApproveStaged([{ ...q, quarantined: true }], { origin: 'mined', config: cfg, project: 'projX' });
    assert.equal(heldQ.activated.length, 0);
    assert.match(heldQ.skipped[0].why, /quarantined/);
  } finally {
    cleanup(home);
  }
});

test('config roundtrip: mode + consent + dial coexist with unrelated keys', () => {
  const home = sandbox();
  try {
    setMode('autopilot');
    setConsentScope('all', { ignore: [path.join(home, 'ignored')] });
    const cfg = loadConfig();
    setDial(cfg, { level: 'full' });
    cfg.thresholds = { promote: 3 };
    saveConfig(cfg);
    const back = loadConfig();
    assert.equal(getMode(back), 'autopilot');
    assert.equal(back.consent.scope, 'all');
    assert.equal(dialLevel(back), 'full');
    assert.deepEqual(back.thresholds, { promote: 3 });
    assert.ok(readFileSync(path.join(home, 'config.yaml'), 'utf8').includes('autopilot'));
  } finally {
    cleanup(home);
  }
});

// ---------- applyDial: the dial+mode coupling, shared by CLI and console ----------

test('applyDial couples dial and mode: full=autopilot, sub-full=curator, manual steps full down', async () => {
  const home = sandbox();
  try {
    const { applyDial } = await import('../src/lib/autoapprove.js');
    const cfg = loadConfig();

    const up = applyDial(cfg, { level: 'full' });
    assert.equal(up.mode, 'autopilot');
    assert.equal(cfg.mode, 'autopilot');
    assert.equal(dialLevel(cfg), 'full');

    // an explicit sub-full level drops back to curator
    const down = applyDial(cfg, { level: 'wide' });
    assert.equal(down.mode, 'curator');
    assert.equal(dialLevel(cfg), 'wide');

    // 'manual' from autopilot: curator + full stepped down to standard
    applyDial(cfg, { level: 'full' });
    const man = applyDial(cfg, { level: 'manual' });
    assert.equal(man.mode, 'curator');
    assert.equal(dialLevel(cfg), 'standard');

    assert.throws(() => applyDial(cfg, { level: 'yolo' }), /E-DIAL/);
  } finally {
    cleanup(home);
  }
});

// ---------- setContribution + the arise default ----------

test('setContribution is the one grant writer; arise --autopilot grants by default, --no-contribute opts out', async () => {
  const { setContribution, contributionEnabled } = await import('../src/lib/contribute.js');
  const arise = (await import('../src/commands/arise.js')).default;

  let home = sandbox();
  try {
    const on = setContribution(true);
    assert.equal(on.enabled, true);
    assert.match(on.granted, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(contributionEnabled(loadConfig()), true);
    const off = setContribution(false);
    assert.equal(off.enabled, false);
    assert.equal(contributionEnabled(loadConfig()), false);
    assert.throws(() => setContribution('yes'), /E-CONFIG/);
  } finally {
    cleanup(home);
  }

  // arise --autopilot: contribution ON by default (owner decision 2026-07-18)
  home = sandbox();
  try {
    assert.equal(await arise(['--autopilot']), 0);
    const cfg = loadConfig();
    assert.equal(contributionEnabled(cfg), true);
    assert.equal(getMode(cfg), 'autopilot');
    assert.equal(dialLevel(cfg), 'full');
  } finally {
    cleanup(home);
  }

  // --no-contribute opts out; everything else unchanged
  home = sandbox();
  try {
    assert.equal(await arise(['--autopilot', '--no-contribute']), 0);
    const cfg = loadConfig();
    assert.equal(contributionEnabled(cfg), false);
    assert.equal(getMode(cfg), 'autopilot');
  } finally {
    cleanup(home);
  }
});
