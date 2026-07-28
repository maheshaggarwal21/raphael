// Phase 23.1 — the planning layer.
//
// Coverage rule for this file (CLAUDE.md testing standard): every validateGraph
// rule gets a case that PASSES and a case that FAILS, plus the edges that rule
// can be wrong about. A validator only tested on rejections proves it says no; a
// validator only tested on acceptance proves nothing at all.
//
// Deliberately absent: any test that reads the RECOVERY table's numbers back.
// Asserting a constant equals itself proves nothing, so the budget tests assert
// the DERIVED behaviour (a non-escalatable node gets zero model attempts) instead.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateGraph, pipelineToGraph, graphHash, renderGraph, renderGraphMermaid,
  tarjanSCC, scanBoundaryVerbs, nodeBudget,
  VERIFIED_KINDS, DRIVER_FORBIDDEN_KINDS, TERMINAL_DONE, MAX_GRAPH_NODES, MAX_TITLE_LEN
} from '../src/lib/graph.js';
import { MAX_NODE_ATTEMPTS } from '../src/lib/recovery.js';
import { DEFAULT_PIPELINE } from '../src/lib/driver.js';
import { policyKinds } from '../src/lib/policy.js';

const CHECK = { requires_section: '## DECISIONS' };

// A minimal VALID linear graph. Every failure test below starts from this and
// breaks exactly one thing, so the assertion is about that one thing.
function linear(over = {}) {
  return {
    entry: 'plan',
    nodes: [
      { id: 'plan', kind: 'plan', check: { ...CHECK } },
      { id: 'develop', kind: 'develop', check: { ...CHECK } }
    ],
    edges: [
      { from: 'plan', to: 'develop', when: 'always' },
      { from: 'develop', to: TERMINAL_DONE, when: 'always' }
    ],
    ...over
  };
}

// A minimal VALID graph with a bounded review loop — the shape the whole phase
// exists to make expressible.
function looped(over = {}) {
  return {
    entry: 'develop',
    nodes: [
      { id: 'develop', kind: 'develop', check: { ...CHECK } },
      { id: 'review', kind: 'review', emit: 'verdict', check: { ...CHECK } }
    ],
    edges: [
      { from: 'develop', to: 'review', when: 'always', maxTraversals: 3 },
      { from: 'review', to: TERMINAL_DONE, when: 'pass' },
      { from: 'review', to: 'develop', when: 'changes', maxTraversals: 3 }
    ],
    ...over
  };
}

function rejects(graph, fragment, opts = {}) {
  assert.throws(() => validateGraph(graph, opts), (err) => {
    assert.match(err.message, /^E-(GRAPH|POLICY):/, `expected a coded error, got: ${err.message}`);
    assert.match(err.message, fragment, `message did not mention the reason: ${err.message}`);
    return true;
  });
}

// ---- the happy paths ---------------------------------------------------------

test('a linear graph validates and reports its resolved facts', () => {
  const g = validateGraph(linear(), { name: 'linear' });
  assert.equal(g.entry, 'plan');
  assert.equal(g.nodes.length, 2);
  assert.equal(g.name, 'linear');
  const develop = g.nodes.find((n) => n.id === 'develop');
  // Resolved at validate time, not at failure time.
  assert.equal(develop.escalatable, true, 'develop carries an escalation model');
  assert.equal(develop.effectiveVerify, true, 'develop is a code-bearing kind');
  const plan = g.nodes.find((n) => n.id === 'plan');
  assert.equal(plan.escalatable, false, 'plan has no escalation model');
  assert.equal(plan.effectiveVerify, false);
  assert.equal(plan.emit, 'deliverable', 'emit defaults to deliverable');
});

test('a bounded review loop validates — the shape the driver could not express', () => {
  const g = validateGraph(looped());
  const review = g.nodes.find((n) => n.id === 'review');
  assert.equal(review.emit, 'verdict');
  assert.equal(g.edges.filter((e) => e.maxTraversals === 3).length, 2);
});

test('the returned graph is deep-frozen and the input is left untouched', () => {
  const input = linear();
  const g = validateGraph(input);
  assert.ok(Object.isFrozen(g) && Object.isFrozen(g.nodes) && Object.isFrozen(g.nodes[0]));
  assert.ok(Object.isFrozen(g.nodes[0].check));
  // The caller's own objects must not have been frozen as a side effect.
  assert.ok(!Object.isFrozen(input), 'validateGraph must not freeze its input');
  assert.ok(!Object.isFrozen(input.nodes[0].check), 'validateGraph must not freeze the input check');
});

// ---- rule 1: node identity ---------------------------------------------------

test('rule 1 rejects a graph with no nodes, and a non-object graph', () => {
  rejects({ entry: 'plan', nodes: [], edges: [] }, /at least one node/);
  rejects(null, /must be an object/);
  rejects([], /must be an object/);
});

test('rule 1 rejects duplicate, malformed, and terminal-colliding node ids', () => {
  rejects(linear({ nodes: [{ id: 'plan', kind: 'plan', check: CHECK }, { id: 'plan', kind: 'develop', check: CHECK }] }), /duplicate node id/);
  rejects(linear({ nodes: [{ id: '', kind: 'plan', check: CHECK }] }), /has no id/);
  rejects(linear({ nodes: [{ id: '@done', kind: 'plan', check: CHECK }] }), /reserved terminal/);
  rejects(linear({ nodes: [{ id: 'Plan Stage', kind: 'plan', check: CHECK }] }), /kebab-case/);
  rejects(linear({ nodes: [{ id: '2fast', kind: 'plan', check: CHECK }] }), /kebab-case/);
});

test('rule 1 edge: a hyphenated id like develop-2 is legal (pipelineToGraph generates them)', () => {
  const g = validateGraph({
    entry: 'develop-2',
    nodes: [{ id: 'develop-2', kind: 'develop', check: CHECK }],
    edges: [{ from: 'develop-2', to: TERMINAL_DONE, when: 'always' }]
  });
  assert.equal(g.nodes[0].id, 'develop-2');
});

test('rule 1 edge: a graph larger than the node cap is refused', () => {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < MAX_GRAPH_NODES + 1; i += 1) {
    nodes.push({ id: `n${i}`, kind: 'develop', check: CHECK });
    edges.push({ from: `n${i}`, to: i + 1 <= MAX_GRAPH_NODES ? `n${i + 1}` : TERMINAL_DONE, when: 'always' });
  }
  rejects({ entry: 'n0', nodes, edges }, /at most \d+ nodes/);
});

// ---- rule 2: edge endpoints --------------------------------------------------

test('rule 2 rejects an edge naming a node that does not exist, at either end', () => {
  rejects(linear({ edges: [{ from: 'ghost', to: 'develop', when: 'always' }] }), /from "ghost" is not a node/);
  rejects(linear({
    edges: [{ from: 'plan', to: 'ghost', when: 'always' }, { from: 'develop', to: TERMINAL_DONE, when: 'always' }]
  }), /target is neither a node/);
});

test('rule 2 edge: @owner is a legal target alongside @done', () => {
  const g = validateGraph({
    entry: 'review',
    nodes: [{ id: 'review', kind: 'review', emit: 'verdict', check: CHECK }],
    edges: [
      { from: 'review', to: TERMINAL_DONE, when: 'pass' },
      { from: 'review', to: '@owner', when: 'changes', reason: 'security findings are advisory' }
    ]
  });
  assert.equal(g.edges.find((e) => e.to === '@owner').reason, 'security findings are advisory');
});

// ---- rule 3: entry and orphans ----------------------------------------------

test('rule 3 rejects a missing or unknown entry — it is never inferred', () => {
  const noEntry = linear();
  delete noEntry.entry;
  rejects(noEntry, /entry is required/);
  rejects(linear({ entry: 'ghost' }), /entry "ghost" is not a node/);
});

test('rule 3 rejects a node with no inbound edge that is not the entry', () => {
  rejects({
    entry: 'plan',
    nodes: [
      { id: 'plan', kind: 'plan', check: CHECK },
      { id: 'develop', kind: 'develop', check: CHECK },
      { id: 'stray', kind: 'test', check: CHECK }
    ],
    edges: [
      { from: 'plan', to: 'develop', when: 'always' },
      { from: 'develop', to: TERMINAL_DONE, when: 'always' },
      { from: 'stray', to: TERMINAL_DONE, when: 'always' }
    ]
  }, /has no inbound edge and is not the entry/);
});

test('rule 3 edge: the entry MAY have an inbound edge (a loop back to the start)', () => {
  const g = validateGraph(looped());
  assert.equal(g.entry, 'develop');
  assert.ok(g.edges.some((e) => e.to === 'develop'), 'the entry is looped back to');
});

// ---- rules 4 and 5: reachability both ways -----------------------------------

test('rule 4 rejects a node unreachable from the entry', () => {
  // `island` has an inbound edge (so rule 3 passes) but nothing links it to the
  // entry's component.
  rejects({
    entry: 'plan',
    nodes: [
      { id: 'plan', kind: 'plan', check: CHECK },
      { id: 'island', kind: 'develop', check: CHECK },
      { id: 'islet', kind: 'test', check: CHECK }
    ],
    edges: [
      { from: 'plan', to: TERMINAL_DONE, when: 'always' },
      { from: 'island', to: 'islet', when: 'always' },
      { from: 'islet', to: 'island', when: 'always', maxTraversals: 2 }
    ]
  }, /unreachable from entry/);
});

test('rule 5 rejects a graph with no terminal at all', () => {
  rejects(linear({
    edges: [
      { from: 'plan', to: 'develop', when: 'always' },
      { from: 'develop', to: 'plan', when: 'always', maxTraversals: 2 }
    ]
  }), /no node routes to a terminal/);
});

test('rule 5 rejects a node that can never reach a terminal — the spin-forever graph', () => {
  // plan -> develop <-> test, and only plan routes to @done. Once the run enters
  // the develop/test pair it can never leave: it would spin until a bound tripped
  // and escalate 100% of runs, having spent real tokens.
  rejects({
    entry: 'plan',
    nodes: [
      { id: 'plan', kind: 'plan', emit: 'verdict', check: CHECK },
      { id: 'develop', kind: 'develop', check: CHECK },
      { id: 'test', kind: 'test', check: CHECK }
    ],
    edges: [
      { from: 'plan', to: TERMINAL_DONE, when: 'pass' },
      { from: 'plan', to: 'develop', when: 'changes' },
      { from: 'develop', to: 'test', when: 'always', maxTraversals: 2 },
      { from: 'test', to: 'develop', when: 'always', maxTraversals: 2 }
    ]
  }, /can never reach a terminal/);
});

// ---- rule 6: every loop is bounded -------------------------------------------

test('rule 6 rejects an unbounded loop, and accepts the same loop once bounded', () => {
  const unbounded = looped();
  delete unbounded.edges[2].maxTraversals;
  rejects(unbounded, /closes a loop and must declare maxTraversals/);
  assert.ok(validateGraph(looped()), 'the bounded form of the same loop is fine');
});

test('rule 6 rejects an unbounded self-loop', () => {
  rejects({
    entry: 'develop',
    nodes: [
      { id: 'develop', kind: 'develop', emit: 'verdict', check: CHECK }
    ],
    edges: [
      { from: 'develop', to: TERMINAL_DONE, when: 'pass' },
      { from: 'develop', to: 'develop', when: 'changes' }
    ]
  }, /closes a loop and must declare maxTraversals/);
});

test('rule 6 edge: a purely linear graph needs no bounds at all', () => {
  const g = validateGraph(linear());
  assert.ok(g.edges.every((e) => e.maxTraversals === undefined));
});

test('rule 14 rejects a non-positive or fractional maxTraversals', () => {
  for (const bad of [0, -1, 2.5, '3', null]) {
    const g = looped();
    g.edges[2].maxTraversals = bad;
    rejects(g, /maxTraversals must be a positive integer/);
  }
});

// ---- rules 7 and 8: the out-shape of a node ---------------------------------

test('rule 7 rejects duplicate edge conditions on one node', () => {
  rejects(linear({
    edges: [
      { from: 'plan', to: 'develop', when: 'always' },
      { from: 'plan', to: TERMINAL_DONE, when: 'always' },
      { from: 'develop', to: TERMINAL_DONE, when: 'always' }
    ]
  }), /has 2 "always" edges/);
});

test('rule 7 rejects a node with no outgoing edge', () => {
  rejects(linear({ edges: [{ from: 'plan', to: 'develop', when: 'always' }] }), /has no outgoing edge/);
});

test('rule 8 rejects a "changes" edge leaving a deliverable node', () => {
  rejects(linear({
    edges: [
      { from: 'plan', to: 'develop', when: 'always' },
      { from: 'develop', to: TERMINAL_DONE, when: 'pass' },
      { from: 'develop', to: 'plan', when: 'changes', maxTraversals: 2 }
    ]
  }), /only a verdict node can report changes/);
});

test('rule 8 rejects a verdict node missing a branch, or carrying an "always"', () => {
  const missingChanges = looped();
  missingChanges.edges = missingChanges.edges.filter((e) => e.when !== 'changes');
  rejects(missingChanges, /needs exactly one "pass" edge and one "changes" edge/);

  const withAlways = looped();
  withAlways.edges.push({ from: 'review', to: TERMINAL_DONE, when: 'always' });
  rejects(withAlways, /may not carry an "always" edge/);
});

test('rule 8 edge: a deliverable node may not carry a bare "pass" edge either', () => {
  rejects(linear({
    edges: [
      { from: 'plan', to: 'develop', when: 'pass' },
      { from: 'develop', to: TERMINAL_DONE, when: 'always' }
    ]
  }), /must be "always", not "pass"/);
});

test('an unknown "when" value is refused', () => {
  rejects(linear({
    edges: [
      { from: 'plan', to: 'develop', when: 'fail' },
      { from: 'develop', to: TERMINAL_DONE, when: 'always' }
    ]
  }), /when must be one of/);
});

// ---- rule 9: inputs are data, and must be ancestors --------------------------

test('rule 9 accepts an ancestor input and rejects an unknown, self, or non-ancestor one', () => {
  const ok = linear();
  ok.nodes[1].inputs = ['plan'];
  assert.deepEqual(validateGraph(ok).nodes[1].inputs, ['plan']);

  const unknown = linear();
  unknown.nodes[1].inputs = ['ghost'];
  rejects(unknown, /not a node in this graph/);

  const self = linear();
  self.nodes[1].inputs = ['develop'];
  rejects(self, /may not name itself in inputs/);

  // `plan` naming its own descendant: develop's output cannot exist when plan runs.
  const backwards = linear();
  backwards.nodes[0].inputs = ['develop'];
  rejects(backwards, /is not an ancestor/);

  const notArray = linear();
  notArray.nodes[1].inputs = 'plan';
  rejects(notArray, /inputs must be an array/);
});

test('rule 9 edge: inside a loop, both nodes are each other\'s ancestors', () => {
  const g = looped();
  g.nodes[0].inputs = ['review'];   // develop reads the review that sent it back
  g.nodes[1].inputs = ['develop'];
  const out = validateGraph(g);
  assert.deepEqual(out.nodes[0].inputs, ['review']);
});

// ---- rule 10: kinds ----------------------------------------------------------

test('rule 10 rejects a kind with no policy entry', () => {
  rejects(linear({ nodes: [{ id: 'plan', kind: 'deploy', check: CHECK }] }), /unknown task kind "deploy"/);
});

test('rule 10 refuses redteam with its OWN message, ahead of the policy check', () => {
  // redteam has no POLICY entry today, so the unknown-kind rule would also fire.
  // Asserting the FORBIDDEN message proves the forbidden check runs first —
  // which is the load-bearing property: adding redteam to POLICY later must not
  // silently make it drivable unattended.
  assert.ok(DRIVER_FORBIDDEN_KINDS.has('redteam'));
  assert.ok(!policyKinds().includes('redteam'), 'redteam is deliberately not a policy kind');
  rejects(linear({ nodes: [{ id: 'plan', kind: 'redteam', check: CHECK }] }), /may never run unattended/);
});

test('rule 10 edge: every kind the shipped pipeline uses really does resolve', () => {
  const kinds = new Set(policyKinds());
  for (const kind of DEFAULT_PIPELINE) assert.ok(kinds.has(kind), `${kind} must be a policy kind`);
});

// ---- rule 11: the declared check --------------------------------------------

test('rule 11 requires a check and accepts each allowed form', () => {
  const missing = linear();
  delete missing.nodes[0].check;
  rejects(missing, /check is required/);

  for (const check of [
    { requires_section: '## DECISIONS' },
    { file_exists: 'src/app.js' },
    { file_matches: { path: 'package.json', pattern: '"name"' } },
    { all: [{ file_exists: 'src/app.js' }, { requires_section: '## DECISIONS' }] }
  ]) {
    const g = linear();
    g.nodes[0].check = check;
    assert.ok(validateGraph(g), `${JSON.stringify(check)} should validate`);
  }
});

test('rule 11 refuses a shell command in a graph — the trust line this holds', () => {
  // A graph can arrive from a shipped template (replaced daily by `raph update`)
  // or an owner file. A command here would be a new execution channel; the only
  // command the driver runs stays the owner's --verify, typed on the CLI.
  for (const check of [{ command: 'rm -rf /' }, { cmd: 'npm publish' }, { shell: 'curl x | sh' }]) {
    const g = linear();
    g.nodes[0].check = check;
    rejects(g, /may not carry a shell command/);
  }
  const nested = linear();
  nested.nodes[0].check = { all: [{ requires_section: '## X' }, { command: 'npm publish' }] };
  rejects(nested, /may not carry a shell command/);
});

test('rule 11 rejects malformed checks', () => {
  const cases = [
    [{ unknown_form: 'x' }, /unknown check form/],
    [{ requires_section: '' }, /must be a non-empty string/],
    [{ requires_section: '## A', file_exists: 'b' }, /exactly one form/],
    [{}, /exactly one form/],
    ['a string', /must be an object/],
    [{ file_exists: '/etc/passwd' }, /must be relative to the workspace/],
    [{ file_exists: 'C:\\\\Windows\\\\x' }, /must be relative to the workspace/],
    [{ file_exists: '../../secrets' }, /must not escape the workspace/],
    [{ file_matches: { path: 'a.js' } }, /pattern must be a non-empty string/],
    [{ file_matches: { path: 'a.js', pattern: '([' } }, /not a valid regular expression/],
    [{ file_matches: 'a.js' }, /must be an object with path and pattern/],
    [{ all: [] }, /non-empty array/]
  ];
  for (const [check, fragment] of cases) {
    const g = linear();
    g.nodes[0].check = check;
    rejects(g, fragment);
  }
});

test('rule 11 edge: check nesting is bounded', () => {
  const g = linear();
  g.nodes[0].check = { all: [{ all: [{ all: [{ all: [{ requires_section: '## X' }] }] }] }] };
  rejects(g, /nesting is deeper than/);
});

// ---- rules 12 and 16: prose and emit -----------------------------------------

test('rule 12 rejects an over-long title and a non-string criteria', () => {
  rejects(linear({ nodes: [{ id: 'plan', kind: 'plan', title: 'x'.repeat(MAX_TITLE_LEN + 1), check: CHECK }] }), /title is longer than/);
  rejects(linear({ nodes: [{ id: 'plan', kind: 'plan', criteria: 42, check: CHECK }] }), /criteria must be a string/);
  rejects(linear({ nodes: [{ id: 'plan', kind: 'plan', criteria: 'x'.repeat(2001), check: CHECK }] }), /criteria is longer than/);
});

test('rule 12 edge: title defaults to the node id and criteria to empty', () => {
  const g = validateGraph(linear());
  assert.equal(g.nodes[0].title, 'plan');
  assert.equal(g.nodes[0].criteria, '');
});

test('rule 16 rejects an unknown emit value', () => {
  rejects(linear({ nodes: [{ id: 'plan', kind: 'plan', emit: 'opinion', check: CHECK }] }), /emit must be one of/);
});

// ---- rule 13: verify is additive only ---------------------------------------

test('rule 13 lets a graph ADD verification but never subtract it', () => {
  // Extending: a kind the code would not check can be checked.
  const extended = linear();
  extended.nodes[0].verify = true;
  assert.equal(validateGraph(extended).nodes[0].effectiveVerify, true);

  // Subtracting: refused. This is the gate that exists because a `test` stage
  // claimed 135 passing tests while the suite was red — graph DATA must not be
  // able to switch off the owner's verifier.
  const subtracted = linear();
  assert.ok(VERIFIED_KINDS.has('develop'));
  subtracted.nodes[1].verify = false;
  rejects(subtracted, /cannot switch off the owner's verifier/);
});

test('rule 13 edge: verify:false on a non-verified kind is a legal no-op, and non-booleans are refused', () => {
  const noop = linear();
  noop.nodes[0].verify = false;               // `plan` is not a verified kind
  assert.equal(validateGraph(noop).nodes[0].effectiveVerify, false);

  const bad = linear();
  bad.nodes[0].verify = 'yes';
  rejects(bad, /verify must be true or false/);
});

// ---- rule 15: the boundary deny-scan ----------------------------------------

test('scanBoundaryVerbs catches instructions to cross the boundary', () => {
  const hits = scanBoundaryVerbs('Publish the package to npm and confirm the release is live.');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].rule, 'publish');

  for (const text of [
    'Then deploy the service to production.',
    'Run npm publish once the tests pass.',
    'git push origin main when done.',
    'Sign in to the dashboard first.',
    'Create an account on the provider.',
    'Purchase the domain before continuing.',
    'Push to the repo after the review.',
    'Make the app go live on Friday.'
  ]) {
    assert.ok(scanBoundaryVerbs(text).length >= 1, `should have flagged: ${text}`);
  }
});

test('scanBoundaryVerbs does NOT fire on the correct way to state the boundary', () => {
  // The right criteria for a deploy-prep node says exactly this, and rejecting
  // it would make the rule unusable on the very node it most concerns.
  for (const text of [
    'Produce the checklist; never deploy the app yourself.',
    'Do not publish the package — that is the owner\'s action.',
    'Never push to any remote.',
    'The deploy-prep stage writes a deployment checklist.',
    'Document the release notes and the rollback plan.',
    'Describe the deployment topology.',
    ''
  ]) {
    assert.deepEqual(scanBoundaryVerbs(text), [], `should NOT have flagged: ${text}`);
  }
});

test('rule 15 rejects boundary instructions in criteria, in a title, and in the brief', () => {
  const inCriteria = linear();
  inCriteria.nodes[1].criteria = 'Publish the package to npm and confirm the release is live.';
  rejects(inCriteria, /criteria instructs the pipeline to cross the autonomy boundary/);

  const inTitle = linear();
  inTitle.nodes[1].title = 'Deploy the service';
  rejects(inTitle, /title instructs the pipeline to cross the autonomy boundary/);

  rejects(linear(), /brief instructs the pipeline to cross the autonomy boundary/, {
    brief: 'Build the tool, then deploy it to production.'
  });
});

test('a scope-exclusion elsewhere in the text does NOT excuse a later instruction', () => {
  // The exemption is scoped to the text BEFORE the match on the SAME line. If it
  // were a whole-text check, one "Out of scope:" line anywhere would disarm the
  // scan for the entire brief — turning a safety rule into a one-line bypass.
  const hits = scanBoundaryVerbs('Out of scope: hosting.\nDeploy the app to production when ready.');
  assert.equal(hits.length, 1, 'the instruction on the second line must still be flagged');
  assert.equal(hits[0].rule, 'deploy');

  // Same line, marker AFTER the instruction: still flagged.
  assert.ok(scanBoundaryVerbs('Deploy the app to prod. Out of scope: nothing.').length >= 1);
  // Same line, marker BEFORE the instruction: exempt, which is the real brief's shape.
  assert.deepEqual(scanBoundaryVerbs('Out of scope: deploying it, publishing it.'), []);
});

test('rule 15 edge: a normal brief and the shipped pipeline\'s own kind names pass', () => {
  const g = pipelineToGraph(DEFAULT_PIPELINE);
  assert.ok(validateGraph(g, { brief: 'Build a small CLI that reads a CSV and prints a summary.' }));
});

// ---- pipelineToGraph ---------------------------------------------------------

test('pipelineToGraph lifts the shipped pipeline into a graph that validates', () => {
  const g = validateGraph(pipelineToGraph(DEFAULT_PIPELINE, { name: 'linear' }), { name: 'linear' });
  assert.equal(g.nodes.length, DEFAULT_PIPELINE.length);
  assert.equal(g.entry, DEFAULT_PIPELINE[0]);
  assert.equal(g.edges.at(-1).to, TERMINAL_DONE);
  assert.deepEqual(g.nodes.map((n) => n.kind), DEFAULT_PIPELINE);
});

test('pipelineToGraph gives a repeated kind its own node — the record that used to be overwritten', () => {
  const g = validateGraph(pipelineToGraph(['develop', 'test', 'develop']));
  assert.deepEqual(g.nodes.map((n) => n.id), ['develop', 'test', 'develop-2']);
  assert.equal(g.nodes[2].kind, 'develop', 'the second visit is still a develop stage');
});

test('pipelineToGraph seeds verify FROM the verified-kinds set, not from a list', () => {
  // Derived rather than hardcoded on purpose: a change to VERIFIED_KINDS must not
  // be able to silently drop a node's verification without this failing.
  const g = validateGraph(pipelineToGraph(DEFAULT_PIPELINE));
  for (const node of g.nodes) {
    assert.equal(node.effectiveVerify, VERIFIED_KINDS.has(node.kind), `${node.id} verification must follow VERIFIED_KINDS`);
  }
});

test('pipelineToGraph rejects an empty or non-array pipeline', () => {
  assert.throws(() => pipelineToGraph([]), /E-GRAPH: a pipeline must be a non-empty array/);
  assert.throws(() => pipelineToGraph(null), /E-GRAPH/);
});

test('pipelineToGraph edge: a single-kind pipeline routes straight to the terminal', () => {
  const g = validateGraph(pipelineToGraph(['plan']));
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].to, TERMINAL_DONE);
});

// ---- tarjanSCC ---------------------------------------------------------------

test('tarjanSCC finds a cycle, leaves an acyclic chain alone, and sees a self-loop', () => {
  const cyclic = tarjanSCC(['a', 'b', 'c'], new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]));
  assert.equal(cyclic.length, 1);
  assert.deepEqual([...cyclic[0]].sort(), ['a', 'b', 'c']);

  const chain = tarjanSCC(['a', 'b', 'c'], new Map([['a', ['b']], ['b', ['c']], ['c', []]]));
  assert.equal(chain.length, 3, 'each node is its own component');
  assert.ok(chain.every((comp) => comp.length === 1));

  const selfLoop = tarjanSCC(['a'], new Map([['a', ['a']]]));
  assert.deepEqual(selfLoop, [['a']], 'a self-loop is a size-1 component — rule 6 handles it separately');
});

test('tarjanSCC edge: empty input, and a long chain that would overflow a recursive walk', () => {
  assert.deepEqual(tarjanSCC([], new Map()), []);
  const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
  const adjacency = new Map(ids.map((id, i) => [id, i + 1 < ids.length ? [ids[i + 1]] : []]));
  assert.equal(tarjanSCC(ids, adjacency).length, 20000);
});

// ---- graphHash ---------------------------------------------------------------

test('graphHash is stable across key order and changes when the graph changes', () => {
  const a = validateGraph(linear());
  const b = validateGraph({ nodes: linear().nodes, edges: linear().edges, entry: 'plan' });
  assert.equal(graphHash(a), graphHash(b), 'key order must not change the hash');

  const changed = linear();
  changed.nodes[1].criteria = 'leave the suite green';
  assert.notEqual(graphHash(a), graphHash(validateGraph(changed)));
});

test('graphHash edge: undefined fields do not perturb the hash', () => {
  const withUndefined = validateGraph(linear());
  assert.equal(graphHash({ ...withUndefined, missing: undefined }), graphHash(withUndefined));
});

// ---- nodeBudget + rendering --------------------------------------------------

test('nodeBudget zeroes the classes a node cannot produce, and always caps the total', () => {
  const g = validateGraph(looped());
  const develop = nodeBudget(g.nodes.find((n) => n.id === 'develop'));
  const review = nodeBudget(g.nodes.find((n) => n.id === 'review'));

  // Relationships, not the table's numbers: `develop` escalates and is verified,
  // `review` does neither and is the only one that can emit a bad verdict.
  assert.ok(develop.model > 0, 'develop carries an escalation model');
  assert.equal(review.model, 0, 'review has no escalation model, so no model attempts');
  assert.ok(develop.verify > 0, 'develop is claim-checked');
  assert.equal(review.verify, 0);
  assert.equal(develop.verdict, 0, 'a deliverable node cannot emit an unparseable verdict');
  assert.ok(review.verdict > 0);
  assert.equal(develop.cap, MAX_NODE_ATTEMPTS);

  // The cap is the ceiling no combination of classes can climb over.
  const classSum = Object.entries(develop).filter(([k]) => k !== 'cap').reduce((a, [, v]) => a + v, 0);
  assert.ok(classSum > develop.cap, 'the per-class bounds alone would allow more spawns than the cap — which is why the cap exists');
});

test('renderGraph prints every node with a concrete budget, and names the escalate-always rule', () => {
  const text = renderGraph(validateGraph(looped()));
  for (const node of ['develop', 'review']) assert.ok(text.includes(node), `missing node ${node}`);
  assert.match(text, /cap 5/);
  assert.match(text, /<=3 traversals/);
  assert.match(text, /ESCALATES to the owner/);
  assert.match(text, /modelx0/, 'a non-escalatable node must read 0, not the table default');
});

test('renderGraphMermaid emits parseable ids and distinguishes verdict nodes', () => {
  const text = renderGraphMermaid(validateGraph(looped()));
  assert.match(text, /^flowchart TD/);
  assert.match(text, /n_review\{\{/, 'a verdict node gets the hexagon shape');
  assert.match(text, /n_develop\[/, 'a deliverable node gets the box shape');
  // No id may contain a hyphen: mermaid reads it ambiguously against its arrow token.
  for (const line of text.split('\n').slice(1)) {
    const ids = line.match(/\bn_[A-Za-z0-9_]*/g) ?? [];
    for (const id of ids) assert.ok(!id.includes('-'), `mermaid id must not contain a hyphen: ${id}`);
  }
});

test('renderGraph edge: a lifted linear graph renders without any traversal bounds', () => {
  const text = renderGraph(validateGraph(pipelineToGraph(DEFAULT_PIPELINE)));
  assert.ok(!text.includes('traversals'), 'a linear graph has no loop to bound');
  assert.match(text, /deploy-prep --always--> @done/);
});
