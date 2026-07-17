import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
