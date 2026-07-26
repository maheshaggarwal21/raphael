// The headless model probe (2026-07-26). `raph doctor` reported "healthy" while
// every model call Raphael makes was failing HTTP 429 — because having the CLI
// installed is not the same as being able to CALL a model with it. The probe
// closes that gap; spawn is injected so the tests cost nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeHeadlessModel } from '../src/commands/doctor.js';

const envelope = (obj) => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });

test('probeHeadlessModel: a successful call passes', () => {
  const r = probeHeadlessModel({ spawn: () => envelope({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }) });
  assert.equal(r.ok, true);
  assert.equal(r.hint, '');
});

test('probeHeadlessModel: the real 429 is reported with actionable wording', () => {
  const r = probeHeadlessModel({
    spawn: () => ({ status: 1, stdout: JSON.stringify({ subtype: 'success', is_error: true, api_error_status: 429, result: 'Usage credits are required for this model.' }) })
  });
  assert.equal(r.ok, false);
  assert.match(r.hint, /HTTP 429/);
  assert.match(r.hint, /Usage credits are required/);
  assert.match(r.hint, /--model/, 'the fix has to be in the message, not in a maintainer’s head');
});

test('probeHeadlessModel: spawn failure, garbage output, and other API errors all fail closed', () => {
  const spawnErr = probeHeadlessModel({ spawn: () => ({ error: new Error('ENOENT') }) });
  assert.equal(spawnErr.ok, false);
  assert.match(spawnErr.hint, /could not run the claude CLI/);

  const garbage = probeHeadlessModel({ spawn: () => ({ status: 1, stdout: 'not json' }) });
  assert.equal(garbage.ok, false);
  assert.match(garbage.hint, /no parseable output/);

  const other = probeHeadlessModel({ spawn: () => envelope({ subtype: 'error_max_turns', is_error: true }) });
  assert.equal(other.ok, false);
  assert.match(other.hint, /error_max_turns/);

  // a thrown spawn must not take the whole doctor down
  const boom = probeHeadlessModel({ spawn: () => { throw new Error('exploded'); } });
  assert.equal(boom.ok, false);
  assert.match(boom.hint, /probe failed: exploded/);
});

test('probeHeadlessModel pins an explicit model rather than inheriting the CLI default', () => {
  let seen = null;
  probeHeadlessModel({ spawn: (bin, args) => { seen = args; return envelope({ subtype: 'success', is_error: false }); } });
  const i = seen.indexOf('--model');
  assert.ok(i >= 0, 'the probe must pass --model — inheriting is the bug it exists to catch');
  assert.equal(seen[i + 1], 'haiku');
  assert.equal(seen.includes('--tools'), true, 'the probe needs no tools');
});
