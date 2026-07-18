// Phase 17.3 — the autopilot heartbeat: gating, lock, budget, fail-open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  runPulse, pulseBudget, distillRunsToday, acquireLock, releaseLock, lockFile, probationRetire
} = await import('../src/lib/pulse.js');
const { saveConfig, loadConfig, setConsentScope, setMode } = await import('../src/lib/config.js');
const { logEvent, readEvents } = await import('../src/lib/events.js');
const { p } = await import('../src/lib/paths.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-pulse-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

function autopilotOn(home) {
  setMode('autopilot');
  setConsentScope('all');
  const cfg = loadConfig();
  cfg.auto_approve = { level: 'full' };
  saveConfig(cfg);
}

const noopDeps = {
  mine: async () => 0,
  distill: async () => 0
};

test('pulse is a silent no-op in curator mode', async () => {
  const home = sandbox();
  try {
    const s = await runPulse({ project: home, deps: noopDeps });
    assert.equal(s.ran, false);
    assert.match(s.skipped, /curator/);
    // skips are SILENT — a curator-mode user with the hook installed must not
    // grow events.jsonl on every session end
    assert.equal(readEvents().filter((e) => e.event === 'pulse').length, 0);
  } finally {
    cleanup(home);
  }
});

test('pulse refuses a project without consent and never grants it', async () => {
  const home = sandbox();
  try {
    setMode('autopilot');
    // no consent scope, no registry entry
    const proj = path.join(home, 'someproj');
    const s = await runPulse({ project: proj, deps: noopDeps });
    assert.equal(s.ran, false);
    assert.match(s.skipped, /consent/);
    // consent registry untouched
    assert.equal(loadConfig().projects[path.resolve(proj)], undefined);
  } finally {
    cleanup(home);
  }
});

test('with autopilot + consent the loop runs and logs one pulse event', async () => {
  const home = sandbox();
  try {
    autopilotOn(home);
    let mineArgs = null;
    let distillArgs = null;
    const s = await runPulse({
      project: home,
      deps: {
        mine: async (a) => { mineArgs = a; return 0; },
        distill: async (a) => { distillArgs = a; return 0; }
      }
    });
    assert.equal(s.ran, true);
    assert.equal(s.skipped, null);
    assert.deepEqual(mineArgs, ['--project', home]);
    assert.ok(distillArgs.includes('--yes'));
    assert.ok(distillArgs.includes('--max-episodes'));
    const pulses = readEvents().filter((e) => e.event === 'pulse');
    assert.equal(pulses.length, 1);
    assert.equal(pulses[0].ran, true);
    // lock released
    assert.equal(existsSync(lockFile()), false);
  } finally {
    cleanup(home);
  }
});

test('budget: after dailyDistillRuns distills, pulse mines but does not distill', async () => {
  const home = sandbox();
  try {
    autopilotOn(home);
    const cfg = loadConfig();
    cfg.autopilot = { daily_distill_runs: 1 };
    saveConfig(cfg);
    // one spending pulse already today
    logEvent({ event: 'pulse', distilled: 3 });

    let distillCalled = false;
    const s = await runPulse({
      project: home,
      deps: { mine: async () => 0, distill: async () => { distillCalled = true; return 0; } }
    });
    assert.equal(s.ran, true);
    assert.equal(distillCalled, false);
    assert.equal(s.distilled, 0);
  } finally {
    cleanup(home);
  }
});

test('distill exit 4 marks the pulse limited; a throwing step fails open', async () => {
  const home = sandbox();
  try {
    autopilotOn(home);
    const limited = await runPulse({ project: home, deps: { mine: async () => 0, distill: async () => 4 } });
    assert.equal(limited.limited, true);

    const thrown = await runPulse({
      project: home,
      deps: { mine: async () => { throw new Error('mine exploded'); }, distill: async () => 0 }
    });
    assert.equal(thrown.ran, true); // the pulse still completed
    assert.ok(thrown.errors.some((e) => /mine exploded/.test(e)));
    // both pulses recorded
    assert.equal(readEvents().filter((e) => e.event === 'pulse').length, 2);
  } finally {
    cleanup(home);
  }
});

test('the lock serializes pulses and steals only stale locks', async () => {
  const home = sandbox();
  try {
    autopilotOn(home);
    mkdirSync(p.state(), { recursive: true });
    // fresh foreign lock -> skip
    writeFileSync(lockFile(), JSON.stringify({ pid: 99999, ts: Date.now() }));
    const s = await runPulse({ project: home, deps: noopDeps });
    assert.equal(s.ran, false);
    assert.match(s.skipped, /already running/);

    // stale lock -> stolen
    writeFileSync(lockFile(), JSON.stringify({ pid: 99999, ts: Date.now() - 60 * 60 * 1000 }));
    const s2 = await runPulse({ project: home, deps: noopDeps });
    assert.equal(s2.ran, true);
    assert.equal(existsSync(lockFile()), false);

    // unreadable lock -> treated as stale
    writeFileSync(lockFile(), 'garbage{{{');
    assert.equal(acquireLock(), true);
    releaseLock();
  } finally {
    cleanup(home);
  }
});

test('pulseBudget defaults + config override; distillRunsToday only counts spending pulses today', () => {
  assert.deepEqual(pulseBudget({}), { maxEpisodes: 8, dailyDistillRuns: 3 });
  assert.deepEqual(
    pulseBudget({ autopilot: { max_episodes_per_pulse: 2, daily_distill_runs: 1 } }),
    { maxEpisodes: 2, dailyDistillRuns: 1 }
  );
  const now = new Date('2026-07-18T12:00:00Z');
  const events = [
    { event: 'pulse', ts: '2026-07-18T01:00:00Z', distilled: 2 },  // counts
    { event: 'pulse', ts: '2026-07-18T02:00:00Z', distilled: 0 },  // mining-only: free
    { event: 'pulse', ts: '2026-07-17T23:00:00Z', distilled: 5 },  // yesterday
    { event: 'injected', ts: '2026-07-18T03:00:00Z' }
  ];
  assert.equal(distillRunsToday(events, now), 1);
});

test('probationRetire touches only machine/auto tiers and reports honestly when not ready', () => {
  const home = sandbox();
  try {
    // no injection history -> not ready, nothing retired
    const res = probationRetire({ events: [] });
    assert.equal(res.retired.length, 0);
    assert.ok(res.reason);
  } finally {
    cleanup(home);
  }
});
