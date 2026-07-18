// Self-update (invariant #5d): registry check, semver compare, throttle,
// fail-open. NO test here ever touches the network or runs real npm — the
// fetch and upgrade are always injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  compareVersions, checkForUpdate, maybeSelfUpdate, currentVersion,
  readUpdateState, updateStateFile, REGISTRY_URL, UPDATE_INTERVAL_MS
} = await import('../src/lib/update.js');
const { readEvents } = await import('../src/lib/events.js');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-upd-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

const fakeFetch = (version) => async (url) => {
  assert.equal(url, REGISTRY_URL); // only ever the pinned registry document
  return { text: JSON.stringify({ name: 'raphael-brain', version }) };
};

test('compareVersions: numeric fields, missing parts read as 0, pre-release ignored', () => {
  assert.equal(compareVersions('0.2.1', '0.2.2'), -1);
  assert.equal(compareVersions('0.2.2', '0.2.2'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), 0);
});

test('checkForUpdate: behind only when the registry is truly newer; junk answers refused', async () => {
  const behind = await checkForUpdate({ fetch: fakeFetch('9.9.9'), current: '0.2.2' });
  assert.equal(behind.behind, true);
  assert.equal(behind.latest, '9.9.9');

  const same = await checkForUpdate({ fetch: fakeFetch('0.2.2'), current: '0.2.2' });
  assert.equal(same.behind, false);

  // a dev tree ahead of the registry must NOT "upgrade" backwards
  const ahead = await checkForUpdate({ fetch: fakeFetch('0.2.1'), current: '0.2.2' });
  assert.equal(ahead.behind, false);

  await assert.rejects(
    () => checkForUpdate({ fetch: async () => ({ text: '{"version":"not-a-version"}' }), current: '0.2.2' }),
    /E-UPDATE/
  );

  assert.match(currentVersion(), /^\d+\.\d+\.\d+$/);
});

test('maybeSelfUpdate: upgrade runs only when behind, event logged, state recorded', async () => {
  const home = sandbox();
  try {
    let upgraded = 0;
    const r = await maybeSelfUpdate({
      now: Date.now(),
      fetch: fakeFetch('9.9.9'),
      current: '0.2.2',
      upgrade: () => { upgraded++; return { ok: true }; }
    });
    assert.equal(r.updated, true);
    assert.equal(upgraded, 1);
    assert.ok(existsSync(updateStateFile()));
    assert.match(readUpdateState().last_result, /updated 0\.2\.2 -> 9\.9\.9/);
    const ev = readEvents().filter((e) => e.event === 'self-update');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].to, '9.9.9');
  } finally {
    cleanup(home);
  }
});

test('maybeSelfUpdate: daily throttle, already-current no-op, failed npm recorded not thrown', async () => {
  const home = sandbox();
  try {
    let upgrades = 0;
    const upgrade = () => { upgrades++; return { ok: true }; };
    const t0 = Date.now();

    // current -> no upgrade, but the check is recorded
    let r = await maybeSelfUpdate({ now: t0, fetch: fakeFetch('0.2.2'), current: '0.2.2', upgrade });
    assert.equal(r.updated, false);
    assert.equal(upgrades, 0);

    // one hour later: throttled — the registry is not asked again
    r = await maybeSelfUpdate({
      now: t0 + 3600_000, current: '0.2.2', upgrade,
      fetch: async () => { throw new Error('should not be called'); }
    });
    assert.equal(r.checked, false);

    // a day later: checked again; a FAILING npm is recorded, never thrown
    r = await maybeSelfUpdate({
      now: t0 + UPDATE_INTERVAL_MS + 1, fetch: fakeFetch('9.9.9'), current: '0.2.2',
      upgrade: () => ({ ok: false, why: 'EACCES' })
    });
    assert.equal(r.updated, false);
    assert.match(r.why, /EACCES/);
    assert.match(readUpdateState().last_result, /upgrade failed/);
  } finally {
    cleanup(home);
  }
});

test('maybeSelfUpdate: offline check fails open and advances the clock', async () => {
  const home = sandbox();
  try {
    const t0 = Date.now();
    const r = await maybeSelfUpdate({
      now: t0, current: '0.2.2',
      fetch: async () => { throw new Error('ENOTFOUND registry.npmjs.org'); },
      upgrade: () => { throw new Error('must not run'); }
    });
    assert.equal(r.updated, false);
    assert.match(r.why, /check failed/);
    // the clock advanced — no hammering the registry on every pulse
    assert.ok(readUpdateState().last_check >= t0);
  } finally {
    cleanup(home);
  }
});
