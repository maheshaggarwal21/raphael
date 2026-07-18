// Self-update (owner decision 2026-07-18): keep the npm-installed CLI current
// without the user ever running an npm command. Invariant #5(d): the ONLY
// network here is a bounded https GET of the npm registry's version document
// for THIS package, and the upgrade itself is `npm install -g raphael-brain@
// latest` — the exact command the user ran to install, with npm's own sha512
// integrity check as the supply-chain gate. Autopilot-gated, daily-throttled,
// fail-open: a broken check can never break the brain or the session.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchUrl } from './fetch.js';
import { atomicWrite } from './files.js';
import { logEvent } from './events.js';
import { p } from './paths.js';

export const PACKAGE_NAME = 'raphael-brain';
export const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // check at most daily
const NPM_TIMEOUT_MS = 180_000;

export function currentVersion() {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

// Plain numeric semver compare: -1 (a < b), 0, 1. Pre-release tags are ignored
// on purpose — the registry's `latest` tag never points at one of ours.
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

export function updateStateFile() {
  return path.join(p.state(), 'update.json');
}

export function readUpdateState() {
  try {
    return JSON.parse(readFileSync(updateStateFile(), 'utf8'));
  } catch {
    return { last_check: 0, last_result: null };
  }
}

function writeUpdateState(state) {
  atomicWrite(updateStateFile(), JSON.stringify(state));
}

// One registry check. { current, latest, behind } — throws on network trouble
// (callers decide whether that is fatal; the pulse treats it as fail-open).
export async function checkForUpdate({ fetch = fetchUrl, current = currentVersion() } = {}) {
  const res = await fetch(REGISTRY_URL);
  const info = JSON.parse(res.text);
  const latest = String(info.version ?? '');
  if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('E-UPDATE: registry answer had no valid version');
  return { current, latest, behind: compareVersions(current, latest) < 0 };
}

// The actual upgrade — the same command the user installed with. npm verifies
// the tarball's sha512 integrity itself; we add nothing to the trust chain.
export function runNpmUpgrade({ timeoutMs = NPM_TIMEOUT_MS } = {}) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '-g', `${PACKAGE_NAME}@latest`], {
    timeout: timeoutMs,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32' // npm.cmd needs a shell on Windows
  });
  if (r.error) return { ok: false, why: r.error.message };
  if (r.status !== 0) {
    const tail = String(r.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' ');
    return { ok: false, why: `npm exited ${r.status}${tail ? ` — ${tail}` : ''}` };
  }
  return { ok: true };
}

// The pulse step: daily throttle -> registry check -> upgrade when behind.
// Every outcome is recorded in state; a real upgrade also logs an event so
// stats and the weekly digest can mention it. Fail-open end to end.
export async function maybeSelfUpdate({
  now = Date.now(), fetch = fetchUrl, upgrade = runNpmUpgrade,
  current = currentVersion(), log = () => {}
} = {}) {
  const state = readUpdateState();
  if (now - (state.last_check ?? 0) < UPDATE_INTERVAL_MS) {
    return { checked: false, why: 'checked within the last day' };
  }
  let check;
  try {
    check = await checkForUpdate({ fetch, current });
  } catch (err) {
    // offline or registry hiccup — advance the clock so we don't hammer it
    writeUpdateState({ ...state, last_check: now, last_result: `check failed: ${err.message}` });
    return { checked: true, updated: false, why: `check failed (${err.message}) — will retry tomorrow` };
  }
  if (!check.behind) {
    writeUpdateState({ ...state, last_check: now, last_result: `current (${check.current})` });
    return { checked: true, updated: false, current: check.current, latest: check.latest, why: 'already current' };
  }
  log(`  [update] ${check.current} -> ${check.latest} — upgrading via npm`);
  const r = upgrade();
  writeUpdateState({
    ...state, last_check: now,
    last_result: r.ok ? `updated ${check.current} -> ${check.latest}` : `upgrade failed: ${r.why}`
  });
  if (r.ok) {
    try {
      logEvent({ event: 'self-update', from: check.current, to: check.latest });
    } catch { /* the event log must never break the update */ }
    return { checked: true, updated: true, current: check.current, latest: check.latest };
  }
  return { checked: true, updated: false, current: check.current, latest: check.latest, why: r.why };
}

// Is state dir available (a brain exists)? `raph update` works without one,
// but the pulse's throttle state needs somewhere to live.
export function hasBrain() {
  return existsSync(p.home());
}
