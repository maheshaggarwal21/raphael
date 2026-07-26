// The append-only trail's READ story (audit 2026-07-26, theme T4).
//
// The write model was always right — crash-safe, lock-free, auditable — but
// there was no rotation anywhere and 17 call sites parsed the WHOLE file,
// including the session-start injection path. So the cost of a hook fire grew
// with how much the product had been used: exactly backwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logEvent, readEvents, rotateEventsIfLarge, KEEP_SEGMENTS } from '../src/lib/events.js';
import { p } from '../src/lib/paths.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-events-'));
  process.env.RAPHAEL_HOME = dir;
  mkdirSync(path.dirname(p.events()), { recursive: true });
  return dir;
}
function cleanup(home) {
  delete process.env.RAPHAEL_HOME;
  rmSync(home, { recursive: true, force: true });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

test('rotation rolls the hot file and keeps a bounded history', () => {
  const home = sandbox();
  try {
    // under the cap: nothing happens
    logEvent({ event: 'injected', tokens: 5 });
    assert.equal(rotateEventsIfLarge().rotated, false, 'a small log is left alone');
    assert.equal(existsSync(`${p.events()}.1`), false);

    // over the cap: the hot file rolls to .1 and a fresh one starts
    const big = 'x'.repeat(1024);
    for (let i = 0; i < 40; i++) logEvent({ event: 'injected', pad: big });
    const res = rotateEventsIfLarge({ maxBytes: 8 * 1024 });
    assert.equal(res.rotated, true);
    assert.ok(existsSync(`${p.events()}.1`), 'history is preserved, not deleted');
    assert.equal(existsSync(p.events()), false, 'the hot file is gone until the next append');

    // history is still readable through the normal API
    const all = readEvents();
    assert.ok(all.length >= 40, `rotated history must still be readable, got ${all.length}`);

    // repeated rotations shift segments and drop the oldest past the keep limit
    for (let r = 0; r < KEEP_SEGMENTS + 2; r++) {
      for (let i = 0; i < 40; i++) logEvent({ event: 'injected', round: r, pad: big });
      rotateEventsIfLarge({ maxBytes: 8 * 1024 });
    }
    assert.equal(existsSync(`${p.events()}.${KEEP_SEGMENTS + 1}`), false, 'history is bounded');
  } finally {
    cleanup(home);
  }
});

test('readEvents({sinceDays}) returns only the window, and everything without it', () => {
  const home = sandbox();
  try {
    appendFileSync(p.events(), [
      JSON.stringify({ ts: daysAgo(30), event: 'injected', tag: 'old' }),
      JSON.stringify({ ts: daysAgo(3), event: 'injected', tag: 'recent' }),
      JSON.stringify({ ts: daysAgo(0), event: 'injected', tag: 'today' }),
      ''
    ].join('\n'), 'utf8');

    const week = readEvents({ sinceDays: 7 });
    assert.deepEqual(week.map((e) => e.tag), ['recent', 'today'], 'only the window');

    const all = readEvents();
    assert.equal(all.length, 3, 'no window = the whole history (stats needs all-time)');

    // edges: a zero window, and events with no/garbage timestamps
    assert.equal(readEvents({ sinceDays: 0 }).length <= 3, true);
    appendFileSync(p.events(), JSON.stringify({ event: 'injected', tag: 'undated' }) + '\n', 'utf8');
    assert.equal(readEvents().length, 4, 'an undated event still reads back');
    assert.equal(readEvents({ sinceDays: 7 }).some((e) => e.tag === 'undated'), false, 'but is outside every window');
  } finally {
    cleanup(home);
  }
});

test('a corrupt line never takes down a reader, in the hot file or a segment', () => {
  const home = sandbox();
  try {
    writeFileSync(p.events(), `${JSON.stringify({ ts: daysAgo(1), event: 'a' })}\nnot json at all\n{{{\n${JSON.stringify({ ts: daysAgo(1), event: 'b' })}\n`, 'utf8');
    writeFileSync(`${p.events()}.1`, `garbage\n${JSON.stringify({ ts: daysAgo(2), event: 'c' })}\n`, 'utf8');
    const events = readEvents();
    assert.deepEqual(events.map((e) => e.event), ['c', 'a', 'b'], 'oldest segment first, corrupt lines skipped');
  } finally {
    cleanup(home);
  }
});

test('rotation is best-effort: a failure never costs an event', () => {
  const home = sandbox();
  try {
    // no events file at all
    assert.equal(rotateEventsIfLarge().rotated, false);
    // and logging still works afterwards
    logEvent({ event: 'injected' });
    assert.equal(readEvents().length, 1);
  } finally {
    cleanup(home);
  }
});
