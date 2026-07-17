import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPortfolio, readPortfolio, renderPortfolio } from '../src/lib/portfolio.js';
import { startProject, checkpoint, readState, parseMilestones, renderStatus } from '../src/lib/academy.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-portfolio-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

function state(over = {}) {
  return {
    project: 'demo',
    title: 'Demo',
    workspace: 'C:/x/demo',
    status: 'done',
    milestones: [
      { id: 'M1', title: 'a', done: true },
      { id: 'M2', title: 'b', done: true }
    ],
    tests: { count: 41, at: '2026-07-14T00:00:00Z' },
    lessons: { count: 3, at: '2026-07-14T00:00:00Z' },
    current: { milestone: 'M2', step: 'shipped', next_action: 'none' },
    boundary: null,
    updated_at: '2026-07-14T12:00:00Z',
    ...over
  };
}

test('buildPortfolio aggregates states + recall events into the project table', () => {
  const states = [
    state(),
    state({
      project: 'live',
      title: 'Live',
      status: 'in-progress',
      milestones: [{ id: 'M1', title: 'a', done: true }, { id: 'M2', title: 'b', done: false }],
      tests: undefined,
      lessons: undefined,
      current: { milestone: 'M2', step: 'building', next_action: 'ship M2' },
      updated_at: '2026-07-16T12:00:00Z'
    })
  ];
  const events = [
    { event: 'injected', project: 'demo', tokens: 300 },
    { event: 'injected', project: 'demo', tokens: 200 },
    { event: 'injected', project: 'other', tokens: 999 }, // not ours
    { event: 'approved', project: 'demo' } // not an injection
  ];

  const pf = buildPortfolio({ states, events });
  assert.equal(pf.projects.length, 2);
  // newest updated_at first
  assert.equal(pf.projects[0].project, 'live');

  const demo = pf.projects.find((x) => x.project === 'demo');
  assert.deepEqual(demo.milestones, { done: 2, total: 2 });
  assert.equal(demo.tests, 41);
  assert.equal(demo.lessonsWritten, 3);
  assert.deepEqual(demo.recall, { injections: 2, tokens: 500 });
  assert.equal(demo.next, null); // done projects carry no next action

  const live = pf.projects.find((x) => x.project === 'live');
  assert.equal(live.tests, null); // never recorded — shown honestly, not 0
  assert.equal(live.next, 'ship M2');

  assert.deepEqual(pf.totals, {
    projects: 2, done: 1, inProgress: 1, blocked: 0,
    tests: 41, lessonsWritten: 3, recallTokens: 500
  });
});

test('renderPortfolio prints the table, boundaries, and honest dashes', () => {
  const pf = buildPortfolio({
    states: [state({ status: 'blocked-boundary', boundary: { reason: 'publish to npm', at: 'x' }, tests: undefined })],
    events: []
  });
  const text = renderPortfolio(pf);
  assert.match(text, /demo/);
  assert.match(text, /BOUNDARY: publish to npm/);
  assert.match(text, /—/); // unrecorded tests render as a dash
  assert.match(text, /1 project\(s\)/);
  assert.match(renderPortfolio(buildPortfolio({})), /no academy projects yet/);
});

test('checkpoint --tests/--lessons record and readPortfolio reads them from disk', () => {
  const dir = sandbox();
  try {
    startProject('kit', { title: 'Kit', milestones: parseMilestones('M1:A') });
    checkpoint('kit', { done: 'M1', tests: '19', lessons: 2 }); // string form = CLI flag path
    const s = readState('kit');
    assert.equal(s.tests.count, 19);
    assert.equal(s.lessons.count, 2);
    assert.match(renderStatus(s), /19 green/);

    const pf = readPortfolio();
    assert.equal(pf.projects.length, 1);
    assert.equal(pf.projects[0].tests, 19);
    assert.equal(pf.projects[0].lessonsWritten, 2);

    // junk is refused, never silently written
    assert.throws(() => checkpoint('kit', { tests: 'lots' }), /E-ACADEMY/);
    assert.throws(() => checkpoint('kit', { lessons: -1 }), /E-ACADEMY/);
    assert.equal(readState('kit').tests.count, 19);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});
