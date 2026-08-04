// What a stage actually RECEIVES: the project map and the lessons.
//
// Three gaps found by auditing a live run, all of them silent — every one
// produced a plausible-looking prompt that was missing or wrong, so nothing
// failed and nothing looked broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CODE_BEARING_KINDS, agentForKind, policyKinds } from '../src/lib/policy.js';
import { workspaceAtlasDigest, lessonMatchesFor } from '../src/lib/driver.js';
import { loadAtlasDoc, buildAndSaveAtlas } from '../src/lib/atlas.js';
import { writeActiveLesson } from './helpers.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-stagectx-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

// A workspace with real, importable code so the scanner finds nodes.
function workspace(root, files) {
  const dir = path.join(root, 'ws');
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

// ---- A2: which kinds get the map ---------------------------------------------

test('every kind that READS the workspace gets the project map, not only the ones that write', () => {
  // The set name says "code-bearing", but review and security have always been
  // in it and write nothing — the real criterion is reads-the-workspace. Three
  // kinds were missing on that criterion and had to find code by groping.
  for (const kind of ['design', 'critique', 'deploy-prep', 'architect']) {
    assert.ok(CODE_BEARING_KINDS.has(kind), `"${kind}" reads the workspace and needs the map`);
  }
  // and the ones that were already right
  for (const kind of ['develop', 'frontend', 'review', 'debug', 'test', 'security']) {
    assert.ok(CODE_BEARING_KINDS.has(kind));
  }
});

test('plan is deliberately excluded — it is the one kind that runs before code exists', () => {
  assert.equal(CODE_BEARING_KINDS.has('plan'), false);
  // Every member must be a real policy kind, or the set silently claims
  // coverage for a stage that can never run.
  const kinds = new Set(policyKinds());
  for (const k of CODE_BEARING_KINDS) assert.ok(kinds.has(k), `"${k}" is not a policy kind`);
});

// ---- A3: the map an agent QUERIES must be the map it was shown ----------------

test('the digest a stage is shown is also SAVED, so raph atlas where answers from the same graph', () => {
  const home = sandbox();
  try {
    const ws = workspace(home, {
      'src/core.js': 'export function core() { return 1; }\n',
      'src/app.js': 'import { core } from "./core.js";\nexport function app() { return core(); }\n'
    });

    assert.equal(loadAtlasDoc(ws), null, 'nothing cached yet');
    const digest = workspaceAtlasDigest(ws);
    assert.ok(digest.length > 0, 'a repo with code produces a digest');

    const cached = loadAtlasDoc(ws);
    assert.ok(cached, 'the digest must leave a cache behind — that is the whole fix');
    assert.ok(cached.nodes.some((n) => n.id.includes('core.js')), 'and it must be THIS workspace');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('regression: a cache from an earlier node is superseded as the build writes code', () => {
  // The live failure: an atlas captured at ONE file during `plan` stayed
  // cached for the whole run, because a build grows code without commits so
  // git HEAD never moves. Every later stage that followed the digest's own
  // pointer queried a graph from before the code existed.
  const home = sandbox();
  try {
    const ws = workspace(home, { 'src/one.js': 'export function one() { return 1; }\n' });
    buildAndSaveAtlas(ws, { previous: null });
    const before = loadAtlasDoc(ws).counts.files;
    assert.equal(before, 1);

    // a later node writes more code, with no commit
    writeFileSync(path.join(ws, 'src/two.js'), 'export function two() { return 2; }\n');
    writeFileSync(path.join(ws, 'src/three.js'), 'export function three() { return 3; }\n');

    workspaceAtlasDigest(ws);

    assert.equal(loadAtlasDoc(ws).counts.files, 3, 'the cached graph must have caught up');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('failure/edge: an empty or missing workspace yields no map and never throws', () => {
  const home = sandbox();
  try {
    // No code yet: the capability check must still hold, so an early node is
    // never handed a phantom map.
    const empty = workspace(home, {});
    assert.equal(workspaceAtlasDigest(empty), '');

    assert.equal(workspaceAtlasDigest(path.join(home, 'does-not-exist')), '');
    assert.equal(workspaceAtlasDigest(null), '');
    assert.equal(workspaceAtlasDigest(''), '');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

// ---- A5: lessons must reach the stage they were written for -------------------

test('agentForKind resolves each node to its roster audience, null when it has none', () => {
  assert.equal(agentForKind('security'), 'security');
  assert.equal(agentForKind('frontend'), 'frontend');
  assert.equal(agentForKind('develop'), 'developer');
  assert.equal(agentForKind('deploy-prep'), 'deployer');
  // Kinds with no roster agent, and an unknown kind, both resolve to null
  // rather than throwing — retrieval must never be able to kill a build.
  assert.equal(agentForKind('test'), null);
  assert.equal(agentForKind('not-a-kind'), null);
});

// Seeded through the REAL brain and read back through the REAL
// lessonMatchesFor. A helper that rebuilt the retrieval context itself would
// pass even with the fix reverted, which is the trap these tests exist to avoid.
const seen = (kind, brief) => lessonMatchesFor(kind, brief).map((m) => m.slug).sort();

test('a lesson scoped to one agent reaches that stage and no other', () => {
  const home = sandbox();
  try {
    mkdirSync(path.join(home, 'brain'), { recursive: true });
    writeActiveLesson({
      slug: 'sec-only', category: 'security',
      scope: { stacks: [], task_kinds: [], projects: [], agents: ['security'] },
      triggers: { keywords: ['password'], paths: [] }
    });
    writeActiveLesson({
      slug: 'any-agent', category: 'correctness',
      scope: { stacks: [], task_kinds: [], projects: [], agents: [] },
      triggers: { keywords: ['password'], paths: [] }
    });

    const brief = 'add password reset to the account settings screen';
    assert.deepEqual(seen('security', brief), ['any-agent', 'sec-only']);
    assert.deepEqual(seen('frontend', brief), ['any-agent'], 'a security lesson has no business at a frontend stage');
    assert.deepEqual(seen('design', brief), ['any-agent']);
    // Edge: a kind with no roster agent keeps the plain-session behaviour —
    // no audience filter, so it sees everything.
    assert.deepEqual(seen('test', brief), ['any-agent', 'sec-only']);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('regression: the bare kind word is no longer keyword-matched against lessons', () => {
  const home = sandbox();
  try {
    // Keyword lists contain role words. Prepending the kind to the matched text
    // made any lesson mentioning "frontend" the top hit at the frontend node
    // whatever its subject — measured on the real brain, five of ten kinds
    // received a byte-identical set of five lessons.
    mkdirSync(path.join(home, 'brain'), { recursive: true });
    writeActiveLesson({
      slug: 'role-worded', category: 'correctness',
      scope: { stacks: [], task_kinds: [], projects: [], agents: [] },
      triggers: { keywords: ['frontend', 'browser'], paths: [] }
    });

    assert.deepEqual(seen('frontend', 'compute the invoice totals in cents and round half up'), [],
      'the word "frontend" comes from the node kind, not from the work');
    // and it still fires when the WORK is actually about that
    assert.deepEqual(seen('develop', 'render the frontend in the browser'), ['role-worded']);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('failure: an empty brain leaves a build running with no lessons, never broken', () => {
  const home = sandbox();
  try {
    // No lessons at all in a fresh RAPHAEL_HOME.
    assert.deepEqual(lessonMatchesFor('develop', 'anything at all'), []);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

// ---- A3, the other half: the command an agent is TOLD to run ------------------

test('raph atlas where catches a stale cache up instead of answering from it', async () => {
  const home = sandbox();
  const proj = mkdtempSync(path.join(os.tmpdir(), 'raph-atcmd-'));
  try {
    const { execSync } = await import('node:child_process');
    const atlasCmd = (await import('../src/commands/atlas.js')).default;
    writeFileSync(path.join(proj, 'alpha.js'), 'export function alpha() { return 1; }\n');
    execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm one', { cwd: proj });

    await atlasCmd(['--project', proj]);
    assert.equal(loadAtlasDoc(proj).counts.files, 1);
    const firstHead = loadAtlasDoc(proj).head;

    writeFileSync(path.join(proj, 'beta.js'), 'export function beta() { return 2; }\n');
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -qm two', { cwd: proj });

    // A QUERY, not a build, and no --refresh: the digest tells agents to run
    // exactly this, so it has to answer from the current tree.
    await atlasCmd(['where', 'beta', '--project', proj]);

    const after = loadAtlasDoc(proj);
    assert.equal(after.counts.files, 2, 'a query must not answer from a graph the tree has moved past');
    assert.notEqual(after.head, firstHead);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});

test('edge: a query on an UNCHANGED tree does not rebuild — correctness must not cost a rescan every call', async () => {
  const home = sandbox();
  const proj = mkdtempSync(path.join(os.tmpdir(), 'raph-atcmd2-'));
  try {
    const { execSync } = await import('node:child_process');
    const atlasCmd = (await import('../src/commands/atlas.js')).default;
    writeFileSync(path.join(proj, 'alpha.js'), 'export function alpha() { return 1; }\n');
    execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm one', { cwd: proj });

    await atlasCmd(['--project', proj]);
    const { json } = (await import('../src/lib/atlas.js')).atlasPaths(proj);
    const before = statSync(json).mtimeMs;

    await atlasCmd(['where', 'alpha', '--project', proj]);
    assert.equal(statSync(json).mtimeMs, before, 'nothing moved, so nothing should have been rewritten');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});
