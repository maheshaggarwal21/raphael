import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWeekly, renderWeekly, DEFAULT_DAYS } from '../src/lib/report.js';

const NOW = new Date('2026-07-17T12:00:00Z');
const IN = '2026-07-15T10:00:00Z';   // inside the 7-day window
const OUT = '2026-07-01T10:00:00Z';  // outside it

function state(over = {}) {
  return {
    project: 'demo',
    status: 'in-progress',
    milestones: [],
    current: { milestone: 'M2', step: 'building', next_action: 'ship M2' },
    log: [
      { at: OUT, note: 'ancient history' },
      { at: IN, note: 'M1 complete' }
    ],
    tests: { count: 19, at: IN },
    ...over
  };
}

test('computeWeekly windows events + checkpoints and keeps misses all-time', () => {
  const events = [
    { ts: IN, event: 'approved' },
    { ts: IN, event: 'approved' },
    { ts: OUT, event: 'approved' },                 // outside — not counted
    { ts: IN, event: 'auto-approved' },
    { ts: IN, event: 'rejected' },
    { ts: IN, event: 'adopted' },
    { ts: IN, event: 'injected', session_id: 's1', tokens: 400, lessons: [{ id: 'L1' }] },
    { ts: IN, event: 'injected', session_id: 's1', tokens: 100, cap_reached: true, lessons: [] },
    { ts: OUT, event: 'injected', session_id: 's0', tokens: 999, lessons: [{ id: 'L2' }] }
  ];
  const r = computeWeekly({
    states: [state(), state({ project: 'quiet', log: [{ at: OUT, note: 'old' }] })],
    events,
    adoptions: [
      { id: 'adp_1', ts: IN, source: 'x.md', kind: 'skill', status: 'adopted', taken: [{ type: 'lesson', id: 'a' }, { type: 'skill-draft', id: 'b' }] },
      { id: 'adp_0', ts: OUT, source: 'y.md', kind: 'url', status: 'adopted', taken: [] }
    ],
    activeLessons: [{ id: 'L1', slug: 'fired' }, { id: 'L2', slug: 'fired-long-ago' }, { id: 'L3', slug: 'never-fired' }],
    now: NOW
  });

  assert.equal(r.window.days, DEFAULT_DAYS);
  // only the project with a note in-window shows as build activity
  assert.equal(r.builds.length, 1);
  assert.equal(r.builds[0].project, 'demo');
  assert.equal(r.builds[0].notesInWindow, 1);
  assert.equal(r.builds[0].latestNote, 'M1 complete');

  assert.deepEqual(r.brain, { approved: 2, autoApproved: 1, rejected: 1, suppressed: 0, adopted: 1, adoptBlocked: 0, adoptRevoked: 0 });
  assert.deepEqual(r.recall, { injections: 2, tokens: 500, sessions: 1, capHits: 1 });

  // misses are all-time: L2 fired outside the window but it FIRED — only L3 misses
  assert.equal(r.misses.neverFired, 1);
  assert.deepEqual(r.misses.sample, ['never-fired']);

  assert.equal(r.adoptions.length, 1);
  assert.deepEqual(r.adoptions[0], { id: 'adp_1', source: 'x.md', kind: 'skill', status: 'adopted', lessons: 1, skills: 1 });

  // both non-done projects appear under next, windowed or not
  assert.equal(r.next.length, 2);
  assert.equal(r.next[0].next, 'ship M2');
});

test('boundaries surface as owner asks; done projects drop out of next', () => {
  const r = computeWeekly({
    states: [
      state({ project: 'blocked', status: 'blocked-boundary', boundary: { reason: 'publish to npm', at: IN } }),
      state({ project: 'finished', status: 'done' })
    ],
    now: NOW
  });
  assert.equal(r.next.length, 1);
  assert.equal(r.next[0].boundary, 'publish to npm');
  const text = renderWeekly(r);
  assert.match(text, /OWNER: publish to npm/);
});

test('renderWeekly stays honest on an empty week', () => {
  const text = renderWeekly(computeWeekly({ now: NOW }));
  assert.match(text, /no academy checkpoints this window/);
  assert.match(text, /no injections this window/);
  assert.match(text, /all academy projects are done — pick the next build/);
});
