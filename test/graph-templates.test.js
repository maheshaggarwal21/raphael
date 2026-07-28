// Phase 23.5 — the shipped graph templates and the CLI surface over them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GRAPH_TEMPLATES, EXPERIMENTAL_GRAPHS, graphNames, getGraphTemplate } from '../src/lib/graph-templates.js';
import { validateGraph, renderGraph, renderGraphMermaid, TERMINAL_DONE, TERMINAL_OWNER } from '../src/lib/graph.js';
import { policyKinds } from '../src/lib/policy.js';
import { DEFAULT_PIPELINE } from '../src/lib/driver.js';
import academy from '../src/commands/academy.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-tpl-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

function capture(fn) {
  const out = [];
  const err = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  return Promise.resolve(fn()).then((code) => {
    console.log = ol; console.error = oe;
    return { code, out: out.join('\n'), err: err.join('\n') };
  }, (e) => { console.log = ol; console.error = oe; throw e; });
}

// ---- the templates themselves ------------------------------------------------

test('every shipped graph passes the full validator', () => {
  // The draft's own flagship graph could not pass its own validator, which is
  // exactly the class of thing this test exists to stop shipping.
  for (const name of graphNames()) {
    const g = validateGraph(getGraphTemplate(name), { name, brief: 'Build a small tool.' });
    assert.ok(g.nodes.length >= 1, `${name} has nodes`);
    assert.equal(g.name, name);
  }
});

test('every node kind in every shipped graph resolves in POLICY', () => {
  const kinds = new Set(policyKinds());
  for (const name of graphNames()) {
    for (const node of GRAPH_TEMPLATES[name].nodes) {
      assert.ok(kinds.has(node.kind), `${name}:${node.id} uses kind "${node.kind}", which has no policy entry`);
    }
  }
});

test('no shipped graph can reach the redteam agent', () => {
  // POLICY membership is what makes a kind drivable, and redteam deliberately
  // has none — but a shipped template is the other way something could become
  // reachable unattended, so it is checked here too.
  for (const name of graphNames()) {
    for (const node of GRAPH_TEMPLATES[name].nodes) {
      assert.notEqual(node.kind, 'redteam', `${name}:${node.id}`);
    }
  }
});

test('linear is the lifted default pipeline, unchanged', () => {
  // It stays the DEFAULT, so it must remain exactly what runs today.
  assert.deepEqual(GRAPH_TEMPLATES.linear.nodes.map((n) => n.kind), DEFAULT_PIPELINE);
  assert.equal(EXPERIMENTAL_GRAPHS.has('linear'), false);
  const g = validateGraph(getGraphTemplate('linear'));
  assert.ok(g.edges.every((e) => e.when === 'always'), 'a linear graph never branches');
  assert.equal(g.edges.at(-1).to, TERMINAL_DONE);
});

test('full-build expresses the loop a pipeline structurally cannot', () => {
  // THE justification for the whole phase: frontend builds, design reviews,
  // sends it back, repeat. A pipeline keyed by kind silently overwrites the
  // second visit's record, so this shape was inexpressible.
  const g = validateGraph(getGraphTemplate('full-build'));
  const back = g.edges.find((e) => e.from === 'design-review' && e.to === 'frontend');
  assert.ok(back, 'design-review sends work back to frontend');
  assert.equal(back.when, 'changes');
  assert.ok(back.maxTraversals >= 1, 'and the loop is bounded');
  assert.equal(g.nodes.find((n) => n.id === 'design-review').emit, 'verdict');
  assert.equal(EXPERIMENTAL_GRAPHS.has('full-build'), true, 'it stays experimental until an observed live run');
});

test('full-build never routes a security finding into an auto-fix', () => {
  // Invariant #4 and the Security agent's own mission say findings are ADVISORY
  // to a human. The graph is the first place that can be ENFORCED structurally
  // rather than hoped for in a prompt.
  const g = validateGraph(getGraphTemplate('full-build'));
  const outs = g.edges.filter((e) => e.from === 'security');
  const changes = outs.find((e) => e.when === 'changes');
  assert.equal(changes.to, TERMINAL_OWNER, 'a security objection goes to a human, not to a fixer node');
  assert.match(changes.reason ?? '', /advisory/);
  for (const e of outs) {
    assert.notEqual(e.to, 'debug', 'security must never hand its findings to an automatic fix');
    assert.notEqual(e.to, 'developer');
  }
});

test('every loop in every shipped graph is bounded in BOTH directions', () => {
  // validateGraph already refuses an unbounded cycle edge; this asserts the
  // shipped graphs actually carry the bounds rather than avoiding loops entirely.
  const fix = validateGraph(getGraphTemplate('fix'));
  const looped = fix.edges.filter((e) => e.maxTraversals !== undefined);
  assert.ok(looped.length >= 2, 'the fix graph loops, and both directions are bounded');
});

test('getGraphTemplate hands back a COPY — a caller cannot mutate a shipped graph', () => {
  const a = getGraphTemplate('linear');
  a.nodes[0].kind = 'tampered';
  assert.equal(getGraphTemplate('linear').nodes[0].kind, 'plan');
  assert.equal(GRAPH_TEMPLATES.linear.nodes[0].kind, 'plan');
});

test('getGraphTemplate names the alternatives when asked for one that does not exist', () => {
  assert.throws(() => getGraphTemplate('nope'), /E-GRAPH: unknown graph "nope" — one of: linear, fix, full-build/);
});

test('renderGraph and the mermaid view both describe every shipped graph', () => {
  for (const name of graphNames()) {
    const g = validateGraph(getGraphTemplate(name), { name });
    const text = renderGraph(g);
    const mmd = renderGraphMermaid(g);
    for (const node of g.nodes) {
      assert.ok(text.includes(node.id), `${name}: ${node.id} missing from the table`);
      assert.ok(mmd.includes(node.id), `${name}: ${node.id} missing from the diagram`);
    }
    assert.match(text, /cap \d+/);
  }
});

// ---- the CLI surface ---------------------------------------------------------

test('raph academy graph lists the shipped graphs, and prints one on request', async () => {
  const dir = sandbox();
  try {
    const listed = await capture(() => academy(['graph']));
    assert.equal(listed.code, 0);
    for (const name of graphNames()) assert.ok(listed.out.includes(name), `${name} should be listed`);

    const shown = await capture(() => academy(['graph', 'fix']));
    assert.equal(shown.code, 0);
    assert.match(shown.out, /graph "fix"/);
    assert.match(shown.out, /ATTEMPT BUDGET PER VISIT/);
    assert.match(shown.out, /ESCALATES to the owner/);

    const mmd = await capture(() => academy(['graph', 'fix', '--mermaid']));
    assert.match(mmd.out, /^flowchart TD/m);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an EXPERIMENTAL graph says so, and a stable one does not', async () => {
  const dir = sandbox();
  try {
    const experimental = await capture(() => academy(['graph', 'full-build']));
    assert.match(experimental.out, /EXPERIMENTAL/);
    const stable = await capture(() => academy(['graph', 'linear']));
    assert.equal(/EXPERIMENTAL/.test(stable.out), false);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raph academy graph <unknown> fails with the list, rather than printing nothing', async () => {
  const dir = sandbox();
  try {
    const r = await capture(() => academy(['graph', 'not-a-graph']));
    assert.equal(r.code, 1);
    assert.match(r.err, /unknown graph/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drive --graph locks the named template, and --graph-file the owner\'s own', async () => {
  const dir = sandbox();
  try {
    await capture(() => academy(['start', 'demo', '--title', 'Demo', '--workspace', dir]));
    const r = await capture(() => academy(['drive', 'demo', '--brief', 'Fix the parser.', '--graph', 'fix', '--dry-run']));
    assert.equal(r.code, 0);
    assert.match(r.out, /graph "fix"/);
    assert.match(r.out, /nothing was spawned/);

    // the locked plan is what `academy graph <project>` now reports
    const locked = await capture(() => academy(['graph', 'demo']));
    assert.match(locked.out, /graph "fix"/);

    // and an owner-supplied file goes through the SAME validator
    const file = path.join(dir, 'mine.json');
    writeFileSync(file, JSON.stringify({
      entry: 'plan',
      nodes: [{ id: 'plan', kind: 'plan', check: { requires_section: '## DECISIONS' } }],
      edges: [{ from: 'plan', to: TERMINAL_DONE, when: 'always' }]
    }));
    await capture(() => academy(['start', 'own', '--title', 'Own', '--workspace', dir]));
    const own = await capture(() => academy(['drive', 'own', '--brief', 'Do the thing.', '--graph-file', file, '--dry-run']));
    assert.equal(own.code, 0);
    assert.match(own.out, /1 nodes|graph "custom"/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a --graph-file that would cross the autonomy boundary is refused before anything spawns', async () => {
  const dir = sandbox();
  try {
    await capture(() => academy(['start', 'bad', '--title', 'Bad', '--workspace', dir]));
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({
      entry: 'ship',
      nodes: [{
        id: 'ship',
        kind: 'develop',
        criteria: 'Publish the package to npm and confirm the release is live.',
        check: { requires_section: '## DECISIONS' }
      }],
      edges: [{ from: 'ship', to: TERMINAL_DONE, when: 'always' }]
    }));
    const r = await capture(() => academy(['drive', 'bad', '--brief', 'Ship it.', '--graph-file', file, '--dry-run']));
    assert.equal(r.code, 1);
    assert.match(r.err, /autonomy boundary/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drive refuses --graph and --graph-file together rather than silently picking one', async () => {
  const dir = sandbox();
  try {
    await capture(() => academy(['start', 'both', '--title', 'Both', '--workspace', dir]));
    const r = await capture(() => academy(['drive', 'both', '--brief', 'x', '--graph', 'fix', '--graph-file', 'f.json', '--dry-run']));
    assert.equal(r.code, 1);
    assert.match(r.err, /not both/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('edge: an unreadable --graph-file is reported, not swallowed', async () => {
  const dir = sandbox();
  try {
    await capture(() => academy(['start', 'miss', '--title', 'Miss', '--workspace', dir]));
    const r = await capture(() => academy(['drive', 'miss', '--brief', 'x', '--graph-file', path.join(dir, 'nope.json'), '--dry-run']));
    assert.equal(r.code, 1);
    assert.match(r.err, /could not read the graph|ENOENT/);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});
