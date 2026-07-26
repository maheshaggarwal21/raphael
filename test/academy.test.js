import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startProject,
  readState,
  checkpoint,
  recordBoundary,
  recordLimit,
  listProjects,
  parseMilestones,
  renderStatus,
  STATUSES
} from '../src/lib/academy.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-academy-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

test('parseMilestones turns a spec string into ordered milestone objects', () => {
  const ms = parseMilestones('M1:Scaffold, M2:Keeper ,M3:Docs');
  assert.deepEqual(ms, [
    { id: 'M1', title: 'Scaffold', done: false },
    { id: 'M2', title: 'Keeper', done: false },
    { id: 'M3', title: 'Docs', done: false }
  ]);
  assert.deepEqual(parseMilestones(''), []);
});

test('startProject is idempotent and never clobbers a live build', () => {
  const dir = sandbox();
  try {
    const a = startProject('repo-keeper', { title: 'Repo Keeper', workspace: 'C:/x', milestones: parseMilestones('M1:Scaffold') });
    assert.equal(a.status, 'in-progress');
    assert.equal(a.current.milestone, 'M1');
    checkpoint('repo-keeper', { step: 'built the scanner' });
    const b = startProject('repo-keeper', { title: 'DIFFERENT' }); // must not reset
    assert.equal(b.title, 'Repo Keeper');
    assert.equal(b.current.step, 'built the scanner');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkpoint advances state and marks milestones done', () => {
  const dir = sandbox();
  try {
    startProject('p', { milestones: parseMilestones('M1:A,M2:B') });
    checkpoint('p', { milestone: 'M1', step: 'scaffold done', next: 'build keeper', done: 'M1', note: 'M1 complete' });
    const s = readState('p');
    assert.equal(s.milestones.find((m) => m.id === 'M1').done, true);
    assert.equal(s.current.next_action, 'build keeper');
    assert.ok(s.log.some((l) => l.note === 'M1 complete'));
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkpoint --tried records dead ends and status surfaces them (16.8c)', () => {
  const dir = sandbox();
  try {
    startProject('p');
    checkpoint('p', { tried: 'regex-based CSV parse — breaks on embedded newlines' });
    checkpoint('p', { tried: 'in-memory only — loses state across the limit reset' });
    const s = readState('p');
    assert.equal(s.tried.length, 2);
    assert.equal(s.tried[0].note, 'regex-based CSV parse — breaks on embedded newlines');
    const text = renderStatus(s);
    assert.match(text, /TRIED \(dead ends/);
    assert.match(text, /in-memory only/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plain checkpoint clears a prior limit block (we are running again)', () => {
  const dir = sandbox();
  try {
    startProject('p');
    recordLimit('p', { resetAt: 'midnight' });
    assert.equal(readState('p').status, 'blocked-limit');
    checkpoint('p', { step: 'resumed after reset' });
    assert.equal(readState('p').status, 'in-progress');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordBoundary stops the build and names the owner action', () => {
  const dir = sandbox();
  try {
    startProject('p');
    recordBoundary('p', 'push repo-keeper to GitHub');
    const s = readState('p');
    assert.equal(s.status, 'blocked-boundary');
    assert.match(s.current.next_action, /OWNER ACTION NEEDED/);
    assert.equal(s.boundary.reason, 'push repo-keeper to GitHub');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkpoint rejects an unknown status', () => {
  const dir = sandbox();
  try {
    startProject('p');
    assert.throws(() => checkpoint('p', { status: 'vibes' }), /E-ACADEMY/);
    for (const st of STATUSES) checkpoint('p', { status: st }); // all valid
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listProjects and renderStatus surface the resume picture', () => {
  const dir = sandbox();
  try {
    startProject('repo-keeper', { title: 'Repo Keeper', milestones: parseMilestones('M1:Scaffold') });
    assert.deepEqual(listProjects(), ['repo-keeper']);
    const text = renderStatus(readState('repo-keeper'));
    assert.match(text, /Repo Keeper/);
    assert.match(text, /NEXT:/);
    assert.match(text, /0\/1 milestones/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

// REGRESSION (audit 2026-07-26, finding 3.8): readState returned null for BOTH
// "no such project" and "corrupt file", and startProject treats null as nothing
// there — so a truncated state file was silently overwritten with a blank
// project, destroying the milestones, log, `tried` list and driver record that
// the entire resume design exists to protect.
test('a corrupt state file is preserved and reported, never silently overwritten', () => {
  const home = sandbox();
  try {
    startProject('kit', { title: 'Kit', milestones: parseMilestones('M1:Scaffold,M2:Ship') });
    checkpoint('kit', { step: 'halfway through M2', tried: 'the regex approach — dead end' });
    const before = readState('kit');
    assert.equal(before.tried.length, 1);
    assert.equal(before.log.length >= 1, true);

    // simulate an interrupted write: truncate the file to half its bytes
    const fp = path.join(home, 'academy', 'kit', 'state.json');
    const full = readFileSync(fp, 'utf8');
    writeFileSync(fp, full.slice(0, Math.floor(full.length / 2)), 'utf8');

    // reading it must THROW rather than report "no project"
    assert.throws(() => readState('kit'), /E-ACADEMY.*unreadable/);

    // the damaged bytes were preserved for recovery
    const kept = readdirSync(path.join(home, 'academy', 'kit')).filter((n) => n.includes('.corrupt-'));
    assert.equal(kept.length, 1, 'the damaged file is kept aside');
    assert.ok(readFileSync(path.join(home, 'academy', 'kit', kept[0]), 'utf8').length > 0);

    // and read-only aggregations can still skip it instead of failing
    assert.equal(readState('kit', { onCorrupt: 'null' }), null);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('readState: missing project is still null, and a non-object payload is corrupt', () => {
  const home = sandbox();
  try {
    assert.equal(readState('never-existed'), null, 'missing stays null (not an error)');

    startProject('kit2', { title: 'Kit2' });
    const fp = path.join(home, 'academy', 'kit2', 'state.json');
    writeFileSync(fp, '"just a string"', 'utf8'); // valid JSON, wrong shape
    assert.throws(() => readState('kit2'), /E-ACADEMY/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
