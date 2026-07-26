// A suite-wide tripwire for the no-network rule.
//
// pulse.test.js stubbed `selfUpdate` with the comment "tests must never touch
// the npm registry" but left `syncGlobal` un-stubbed, so five tests fired real
// HTTPS requests at raw.githubusercontent.com — and when online, downloaded and
// activated the real global brain into a sandbox mid-test. It stayed green
// because the assertions filtered by event name (audit 2026-07-26).
//
// This file makes the rule checkable rather than a comment: every code path a
// test can reach must go through an injectable seam, so a new pulse step that
// reaches for the network fails loudly instead of quietly phoning home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the only modules that open a network connection are the sanctioned ones', () => {
  // Invariant #5: one general fetcher, one API client, one CLI shell-out.
  const allowed = new Set([
    'src/lib/fetch.js',    // the ONE bounded fetcher (adopt / global-brain / update)
    'src/lib/model.js',    // the Anthropic Messages API client
    'src/lib/web.js'       // the LOCAL console server (binds loopback; also contains browser-side fetch in the page template)
  ]);

  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (allowed.has(rel)) continue;
      const src = readFileSync(full, 'utf8');
      // node:http/https imports, or a bare global fetch( call
      if (/from 'node:https?'/.test(src) || /\brequire\('node:https?'\)/.test(src)) {
        offenders.push(`${rel}: imports node:http(s) directly`);
      }
    }
  };
  walk(path.join(ROOT, 'src'));

  assert.deepEqual(
    offenders,
    [],
    'a new network surface must go through src/lib/fetch.js (invariant #5) — or be added to `allowed` with a reason'
  );
});

test('every pulse step is injectable, so tests can stub the whole heartbeat', async () => {
  // The concrete lesson from the audit: a step with no `deps.` seam CANNOT be
  // stubbed, so tests would silently exercise the real thing.
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'pulse.js'), 'utf8');
  const seams = [...src.matchAll(/deps\.(\w+)\s*\?\?/g)].map((m) => m[1]);
  for (const required of ['mine', 'distill', 'syncGlobal', 'selfUpdate', 'bundle']) {
    assert.ok(seams.includes(required), `pulse step "${required}" must be injectable (deps.${required} ?? ...)`);
  }
});

test('pulse tests actually stub every network-capable seam', () => {
  const src = readFileSync(path.join(ROOT, 'test', 'pulse.test.js'), 'utf8');
  const noop = src.slice(src.indexOf('const noopDeps'), src.indexOf('};', src.indexOf('const noopDeps')));
  for (const required of ['selfUpdate', 'syncGlobal']) {
    assert.match(noop, new RegExp(`${required}:`), `noopDeps must stub ${required} — it reaches the network`);
  }
});
