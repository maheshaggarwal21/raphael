// Phase 17.5 — one-time onboarding envelope + weekly digest + arise --autopilot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { onboardingBlock, weeklyDigestBlock, safeInject, estTokens, WEEKLY_DIGEST_BUDGET } = await import('../src/lib/inject.js');
const { loadConfig, saveConfig, setMode, setConsentScope, getMode, hasConsent } = await import('../src/lib/config.js');
const { dialLevel } = await import('../src/lib/autoapprove.js');
const { logEvent, readEvents } = await import('../src/lib/events.js');
const { p } = await import('../src/lib/paths.js');
const arise = (await import('../src/commands/arise.js')).default;

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-onb-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

// silence arise's prints inside tests
async function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
}

// ---------- onboarding ----------

test('onboarding fires exactly once on a fresh install, never after setup', () => {
  const home = sandbox();
  try {
    const first = onboardingBlock();
    assert.match(first, /<raphael-onboarding>/);
    assert.match(first, /arise --autopilot/);
    // second call: marker exists — silent even though still unconfigured
    assert.equal(onboardingBlock(), '');
  } finally {
    cleanup(home);
  }
});

test('onboarding never fires when config already exists', () => {
  const home = sandbox();
  try {
    setMode('curator'); // writes config.yaml
    assert.equal(onboardingBlock(), '');
    assert.equal(existsSync(path.join(p.state(), 'onboarding.json')), false);
  } finally {
    cleanup(home);
  }
});

test('safeInject session-start delivers the onboarding envelope on a fresh brain', () => {
  const home = sandbox();
  try {
    const out = safeInject('session-start', { session_id: 'onb-test' });
    assert.match(out.text, /<raphael-onboarding>/);
    assert.ok(out.tokens > 0);
    // and only once
    const again = safeInject('session-start', { session_id: 'onb-test-2' });
    assert.equal(again.text, '');
  } finally {
    cleanup(home);
  }
});

// ---------- weekly digest ----------

test('weekly digest: autopilot-only, 7-day throttle, silent on an empty week, ≤150 tokens', () => {
  const home = sandbox();
  try {
    // curator mode -> silent
    setMode('curator');
    logEvent({ event: 'machine-curated', slug: 'x', category: 'security' });
    assert.equal(weeklyDigestBlock(), '');

    // autopilot + activity -> speaks once
    setMode('autopilot');
    logEvent({ event: 'injected', tokens: 300 });
    const d = weeklyDigestBlock();
    assert.match(d, /<raphael-digest>/);
    assert.match(d, /1 security/);
    assert.ok(estTokens(d) <= WEEKLY_DIGEST_BUDGET);
    // the show is recorded...
    assert.equal(readEvents().filter((e) => e.event === 'digest-shown').length, 1);
    // ...and throttles the next 7 days
    assert.equal(weeklyDigestBlock(), '');
  } finally {
    cleanup(home);
  }
});

test('weekly digest stays silent when the week had no activity', () => {
  const home = sandbox();
  try {
    setMode('autopilot');
    assert.equal(weeklyDigestBlock(), '');
    assert.equal(readEvents().filter((e) => e.event === 'digest-shown').length, 0);
  } finally {
    cleanup(home);
  }
});

test('weekly digest mentions a self-update even in an otherwise quiet week', () => {
  const home = sandbox();
  try {
    setMode('autopilot');
    logEvent({ event: 'self-update', from: '0.2.1', to: '0.2.2' });
    const d = weeklyDigestBlock();
    assert.match(d, /updated to v0\.2\.2/);
  } finally {
    cleanup(home);
  }
});

// ---------- arise --autopilot ----------

test('arise --autopilot records all three permissions in one shot', async () => {
  const home = sandbox();
  try {
    const code = await quiet(() => arise(['--autopilot', '--contribute']));
    assert.equal(code, 0);
    const cfg = loadConfig();
    assert.equal(getMode(cfg), 'autopilot');
    assert.equal(dialLevel(cfg), 'full');
    assert.equal(cfg.consent.scope, 'all');
    assert.equal(cfg.contribute.enabled, true);
    assert.equal(hasConsent(cfg, path.join(home, 'any', 'project')), true);
  } finally {
    cleanup(home);
  }
});

// Owner decision 2026-07-18: contribution is ON by default at autopilot setup
// (bundles still only STAGE locally; sending is always the user's own action).
// --no-contribute is the opt-out.
test('arise --autopilot grants sharing by default; --no-contribute opts out', async () => {
  const home = sandbox();
  try {
    await quiet(() => arise(['--autopilot']));
    const cfg = loadConfig();
    assert.equal(getMode(cfg), 'autopilot');
    assert.equal(cfg.contribute.enabled, true);
  } finally {
    cleanup(home);
  }
  const home2 = sandbox();
  try {
    await quiet(() => arise(['--autopilot', '--no-contribute']));
    const cfg = loadConfig();
    assert.equal(getMode(cfg), 'autopilot');
    assert.equal(cfg.contribute.enabled, false);
  } finally {
    cleanup(home2);
  }
});

test('plain arise stays curator (manual path unchanged)', async () => {
  const home = sandbox();
  try {
    await quiet(() => arise([]));
    const cfg = loadConfig();
    assert.equal(getMode(cfg), 'curator');
    assert.equal(dialLevel(cfg), 'off');
  } finally {
    cleanup(home);
  }
});
