// Shipped graph templates (Phase 23.5).
//
// These are DATA the owner can point a run at with `--graph <name>`. The model
// never authors topology — graphs come from here or from the owner's own
// `--graph-file`, never from a stage's output. Same rule as `--verify`, same
// spirit as invariant #3 (nothing in a lesson may command an agent).
//
// Note on the loop bounds: EVERY edge inside a cycle carries maxTraversals,
// including the forward one. Requiring only the back edge would be unsound —
// one strongly-connected group can hold two disjoint cycles — and identifying
// true back edges needs a DFS tree whose result depends on input order.
// Bounding all of them is sound, order-independent, and reads naturally: the
// forward bound says how many times this node may hand off into the loop.

import { TERMINAL_DONE, TERMINAL_OWNER } from './graph.js';

const DECISIONS = { requires_section: '## DECISIONS' };

// `linear` — today's DEFAULT_PIPELINE, lifted verbatim. STAYS THE DEFAULT: the
// source's own warning against premature formalization applies, and this is the
// shape both real runs on disk used.
const linear = {
  name: 'linear',
  entry: 'plan',
  nodes: [
    { id: 'plan', kind: 'plan', title: 'Finalise the spec', check: { ...DECISIONS } },
    { id: 'architect', kind: 'architect', title: 'Design the system', inputs: ['plan'], check: { ...DECISIONS } },
    { id: 'develop', kind: 'develop', title: 'Build it', inputs: ['architect'], check: { ...DECISIONS } },
    { id: 'test', kind: 'test', title: 'Make the suite real and green', inputs: ['develop'], check: { ...DECISIONS } },
    { id: 'review', kind: 'review', title: 'Review the diff', inputs: ['test'], check: { ...DECISIONS } },
    { id: 'security', kind: 'security', title: 'Security audit', inputs: ['review'], check: { ...DECISIONS } },
    { id: 'deploy-prep', kind: 'deploy-prep', title: 'Pre-ship checklist', inputs: ['security'], check: { ...DECISIONS } }
  ],
  edges: [
    { from: 'plan', to: 'architect', when: 'always' },
    { from: 'architect', to: 'develop', when: 'always' },
    { from: 'develop', to: 'test', when: 'always' },
    { from: 'test', to: 'review', when: 'always' },
    { from: 'review', to: 'security', when: 'always' },
    { from: 'security', to: 'deploy-prep', when: 'always' },
    { from: 'deploy-prep', to: TERMINAL_DONE, when: 'always' }
  ]
};

// `fix` — a bug-fix run. The test node is a VERDICT node: "the suite is still
// red" is the test stage succeeding at its job and reporting bad news, which is
// a verdict, not a failure.
const fix = {
  name: 'fix',
  entry: 'debug',
  nodes: [
    { id: 'debug', kind: 'debug', title: 'Find the root cause and fix it', check: { ...DECISIONS } },
    {
      id: 'test',
      kind: 'test',
      title: 'Prove the fix with a regression test',
      inputs: ['debug'],
      emit: 'verdict',
      criteria: 'The regression test must FAIL without the fix and PASS with it. A test that passes either way proves nothing.',
      check: { ...DECISIONS }
    },
    { id: 'review', kind: 'review', title: 'Review the fix', inputs: ['test'], check: { ...DECISIONS } }
  ],
  edges: [
    { from: 'debug', to: 'test', when: 'always', maxTraversals: 3 },
    { from: 'test', to: 'review', when: 'pass' },
    { from: 'test', to: 'debug', when: 'changes', maxTraversals: 3 },
    { from: 'review', to: TERMINAL_DONE, when: 'always' }
  ]
};

// `full-build` — the "every agent, in order, with loops" build. EXPERIMENTAL
// until 23.9 puts it through a real observed run.
//
// This is the graph that justifies the whole phase: `frontend builds ->
// design reviews -> send it back -> repeat` is not expressible in a pipeline
// keyed by kind, because the second visit silently overwrites the first.
//
// `security` never routes into an auto-fix. That falls straight out of invariant
// #4 and the Security agent's own shipped mission ("findings are ADVISORY to a
// human — never auto-apply a security change"), and the graph is the first place
// Raphael can ENFORCE it structurally instead of hoping a prompt holds.
const fullBuild = {
  name: 'full-build',
  entry: 'plan',
  nodes: [
    { id: 'plan', kind: 'plan', title: 'Finalise the spec', check: { ...DECISIONS } },
    { id: 'architect', kind: 'architect', title: 'Design the system', inputs: ['plan'], check: { ...DECISIONS } },
    {
      id: 'critique',
      kind: 'critique',
      title: 'Stress-test the design',
      inputs: ['architect'],
      emit: 'verdict',
      criteria: 'Attack the design, do not admire it. Name what breaks, and quote the line you are objecting to.',
      check: { ...DECISIONS }
    },
    { id: 'frontend', kind: 'frontend', title: 'Build the UI', inputs: ['plan', 'architect'], check: { ...DECISIONS } },
    {
      id: 'design-review',
      kind: 'design',
      title: 'Review the UI against the floor',
      inputs: ['frontend'],
      emit: 'verdict',
      criteria: 'Check the mechanical floor first (contrast, visible focus, reduced motion, tokens not raw hex), then taste. Record the palette and type decisions so the next visit inherits them.',
      check: { ...DECISIONS }
    },
    { id: 'developer', kind: 'develop', title: 'Build the rest', inputs: ['architect', 'frontend'], check: { ...DECISIONS } },
    { id: 'test', kind: 'test', title: 'Make the suite real and green', inputs: ['developer'], check: { ...DECISIONS } },
    { id: 'review', kind: 'review', title: 'Review the diff', inputs: ['test'], emit: 'verdict', check: { ...DECISIONS } },
    { id: 'debug', kind: 'debug', title: 'Fix what the review found', inputs: ['review'], check: { ...DECISIONS } },
    {
      id: 'security',
      kind: 'security',
      title: 'Security audit',
      inputs: ['review'],
      emit: 'verdict',
      criteria: 'Findings are advisory to a human. Report them; never apply a security change yourself.',
      check: { ...DECISIONS }
    },
    { id: 'deploy-prep', kind: 'deploy-prep', title: 'Pre-ship checklist', inputs: ['security'], check: { ...DECISIONS } }
  ],
  edges: [
    { from: 'plan', to: 'architect', when: 'always' },
    // architect <-> critique
    { from: 'architect', to: 'critique', when: 'always', maxTraversals: 2 },
    { from: 'critique', to: 'frontend', when: 'pass' },
    { from: 'critique', to: 'architect', when: 'changes', maxTraversals: 2 },
    // frontend <-> design-review — the loop this phase exists for
    { from: 'frontend', to: 'design-review', when: 'always', maxTraversals: 3 },
    { from: 'design-review', to: 'developer', when: 'pass' },
    { from: 'design-review', to: 'frontend', when: 'changes', maxTraversals: 3 },
    { from: 'developer', to: 'test', when: 'always' },
    // test -> review -> debug -> test
    { from: 'test', to: 'review', when: 'always', maxTraversals: 3 },
    { from: 'review', to: 'security', when: 'pass' },
    { from: 'review', to: 'debug', when: 'changes', maxTraversals: 3 },
    { from: 'debug', to: 'test', when: 'always', maxTraversals: 3 },
    // security is advisory: it never routes into an auto-fix
    { from: 'security', to: 'deploy-prep', when: 'pass' },
    { from: 'security', to: TERMINAL_OWNER, when: 'changes', reason: 'security findings are advisory to a human, never auto-applied' },
    { from: 'deploy-prep', to: TERMINAL_DONE, when: 'always' }
  ]
};

export const GRAPH_TEMPLATES = { linear, fix, 'full-build': fullBuild };

// full-build stays EXPERIMENTAL until a real observed run (23.9).
export const EXPERIMENTAL_GRAPHS = new Set(['full-build']);

export function graphNames() {
  return Object.keys(GRAPH_TEMPLATES);
}

export function getGraphTemplate(name) {
  const g = GRAPH_TEMPLATES[name];
  if (!g) throw new Error(`E-GRAPH: unknown graph "${name}" — one of: ${graphNames().join(', ')}`);
  // A deep copy, so a caller (or a run) can never mutate the shipped template.
  return JSON.parse(JSON.stringify(g));
}
