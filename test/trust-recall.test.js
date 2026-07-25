// 18.3 (recall dial) + 18.4 (trust at the point of action)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quarantineNotice, quarantineFlags, QUARANTINE_FLOOR } from '../src/lib/trust.js';
import { recallProfile, getRecallLevel, setRecallLevel, RECALL_LEVELS } from '../src/lib/config.js';

function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-tr-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 18.4 trust at the point of action ---------------------------------------

test('quarantineFlags names each distinct reason, worst-first, deduped', () => {
  const flags = quarantineFlags(['W-IMPERATIVE', 'E-DENY', 'E-DENY']);
  assert.equal(flags[0].code, 'E-DENY', 'injection-shaped outranks tone');
  assert.equal(flags[0].flag, 'injection-shaped');
  assert.equal(flags.length, 2, 'duplicates collapse');
  assert.deepEqual(quarantineFlags([]), [], 'no codes = no flags');
});

test('the notice states the floor every time, and names the flag that fired', () => {
  const out = quarantineNotice({ codes: ['W-IMPERATIVE'], ref: 'les_x', path: '/tmp/a.md' });
  assert.match(out, /QUARANTINED/);
  assert.match(out, /agent-directed-voice/);
  for (const guarantee of QUARANTINE_FLOOR) assert.ok(out.includes(guarantee), `missing: ${guarantee}`);
  assert.match(out, /raph show les_x/, 'tells the reader how to inspect it');
});

test('an unclassified quarantine still states the floor rather than going silent (edge)', () => {
  const out = quarantineNotice({ codes: ['SOMETHING-NEW'] });
  assert.match(out, /unclassified/);
  assert.ok(out.includes(QUARANTINE_FLOOR[0]), 'the guarantee must never be dropped');
  // no ref/path supplied -> no dangling "saved:"/"raph show" lines
  assert.ok(!out.includes('saved:'));
  assert.ok(!out.includes('raph show'));
});

// --- 18.3 recall dial ---------------------------------------------------------

test('recall defaults to normal and every level resolves to real knobs', () => {
  withSandbox(() => {
    assert.equal(getRecallLevel(), 'normal');
    const seen = new Set();
    for (const lvl of RECALL_LEVELS) {
      setRecallLevel(lvl);
      const pr = recallProfile();
      assert.equal(pr.level, lvl);
      assert.ok(pr.digestMax > 0 && pr.promptMax > 0 && pr.sessionCap > 0);
      seen.add(`${pr.digestMax}/${pr.promptMax}/${pr.sessionCap}`);
    }
    assert.equal(seen.size, RECALL_LEVELS.length, 'each level must actually differ');
  });
});

test('quiet is strictly quieter than normal, eager strictly louder', () => {
  withSandbox(() => {
    const at = (lvl) => { setRecallLevel(lvl); return recallProfile(); };
    const q = at('quiet'), n = at('normal'), e = at('eager');
    assert.ok(q.digestMax < n.digestMax && n.digestMax < e.digestMax);
    assert.ok(q.sessionCap < n.sessionCap && n.sessionCap < e.sessionCap);
    // a higher threshold means fewer things clear the bar
    assert.ok(q.promptThreshold > n.promptThreshold && n.promptThreshold > e.promptThreshold);
  });
});

test('an invalid level is refused and leaves the setting untouched (failure case)', () => {
  withSandbox(() => {
    setRecallLevel('eager');
    assert.throws(() => setRecallLevel('shouty'), /E-CONFIG/);
    assert.equal(getRecallLevel(), 'eager', 'a bad write must not clobber the good value');
  });
});

test('a garbage recall value in config fails to normal, never to louder (fail-safe)', () => {
  assert.equal(getRecallLevel({ injection: { recall: 'LOUDEST' } }), 'normal');
  assert.equal(getRecallLevel({ injection: {} }), 'normal');
  assert.equal(getRecallLevel({}), 'normal');
});

test('legacy init-written keys do NOT shadow the dial; injection.overrides.* does', () => {
  // regression: those keys were never honored before 18.3, so letting them win
  // would have left the dial dead on arrival for every existing install
  const legacy = { injection: { recall: 'eager', session_start_max: 10, session_cap_tokens: 1200 } };
  assert.equal(recallProfile(legacy).digestMax, 15, 'the dial must win over legacy defaults');
  assert.equal(recallProfile(legacy).sessionCap, 1800);
  const explicit = { injection: { recall: 'eager', overrides: { session_start_max: 2 } } };
  assert.equal(recallProfile(explicit).digestMax, 2, 'a deliberate override still wins');
});
