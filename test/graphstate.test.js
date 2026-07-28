// Phase 23.3 — migrating a pre-graph driver state onto the graph engine.
//
// The two fixtures are taken from the ONLY two authentic pre-graph driver runs
// in existence (the owner's real gatepost and microcache states). Every key and
// scalar is preserved; only the long stage outputs are truncated, because the
// migration cares about their presence and type, never their content.
//
// Both are edge cases, which is exactly why they are the fixtures: both are
// shape 6 (complete, `stage` one past the end of the pipeline), gatepost also
// carries shape 7 (`timeouts: 1`), and microcache carries a real `verify`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureGraph, isGraphState, clearNode, decisionsByNode, cursorNodeId, newVisit, STATE_SCHEMA_V2
} from '../src/lib/graphstate.js';
import { scanBoundaryVerbs, graphHash } from '../src/lib/graph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(path.join(HERE, 'fixtures', `${name}-state.json`), 'utf8'));

// A synthetic pre-graph state, for the shapes no real run happens to carry.
function preGraph(over = {}, stages = {}) {
  return {
    schema: 'raphael/academy-state/v1',
    project: 'kit',
    status: 'in-progress',
    log: [],
    current: {},
    driver: {
      pipeline: ['plan', 'architect', 'develop'],
      stage: 0,
      brief: 'Build a small tool.',
      verify: null,
      status: 'running',
      stages,
      started_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      ...over
    }
  };
}

const doneRec = (over = {}) => ({
  status: 'done', session_id: 's1', model: 'sonnet', effort: 'high', at: '2026-07-01T01:00:00.000Z',
  timeouts: 0, escalated: false, output: 'THE OUTPUT', error: null, tokens: 100,
  tokens_captured: true, elapsed_ms: 1000, decisions: ['chose X — because Y'], ...over
});

// ---- the two real runs -------------------------------------------------------

test('shape 6: both REAL completed runs migrate to a null cursor, not undefined', () => {
  // `pipeline[stage]` is undefined one past the end, so "map stage to the cursor"
  // produces cursor: undefined for EVERY completed run — which is both runs that
  // have ever existed. null is the legal, documented terminal value.
  for (const name of ['gatepost', 'microcache']) {
    const state = ensureGraph(fixture(name));
    assert.equal(state.driver.cursor, null, `${name} must land on a null cursor`);
    assert.notEqual(state.driver.cursor, undefined, `${name} cursor must not be undefined`);
    assert.equal(state.driver.status, 'done');
    assert.equal(state.schema, STATE_SCHEMA_V2);
    for (const [id, node] of Object.entries(state.driver.nodes)) {
      assert.equal(node.status, 'done', `${name}:${id} should be done`);
      assert.equal(node.visits.length, 1, `${name}:${id} should carry its one recorded visit`);
    }
  }
});

test('the real runs keep their outputs, decisions, tokens and session ids', () => {
  const before = fixture('gatepost');
  const state = ensureGraph(fixture('gatepost'));
  for (const kind of before.driver.pipeline) {
    const rec = before.driver.stages[kind];
    const visit = state.driver.nodes[kind].visits[0];
    assert.equal(visit.output, rec.output, `${kind} output must survive`);
    assert.deepEqual(visit.decisions, rec.decisions, `${kind} decisions must survive`);
    assert.equal(visit.tokens, rec.tokens);
    assert.equal(state.driver.nodes[kind].session_id, rec.session_id);
  }
  // and the rolled-up totals are the sum of what is actually recorded
  const expected = before.driver.pipeline.reduce((a, k) => a + before.driver.stages[k].tokens, 0);
  assert.equal(state.driver.spent.tokens.value, expected);
});

test('shape 7: gatepost\'s interrupted stage keeps its consumed timeout budget', () => {
  // Dropping the scalar resets the budget: a stage already at timeouts:2 would
  // get three MORE spawns, and `develop` carries a 25-minute clock — up to ~75
  // minutes of unbudgeted subscription spend on the exact failure mode (F10)
  // this phase cites. gatepost's `test` stage really does carry timeouts: 1.
  const raw = fixture('gatepost');
  assert.equal(raw.driver.stages.test.timeouts, 1, 'the fixture must still carry the real scalar');

  const state = ensureGraph(fixture('gatepost'));
  const attempts = state.driver.nodes.test.visits[0].attempts;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].class, 'timeout');
  assert.equal(attempts[0].migrated, true, 'a migrated attempt is marked as such, never passed off as observed');
  // a stage that was never interrupted consumes nothing
  assert.deepEqual(state.driver.nodes.plan.visits[0].attempts, []);
});

test('microcache\'s verify command survives the migration', () => {
  // Not hypothetical: microcache carries verify "node --test" on disk, so a
  // migration that dropped it would be a live regression on the one gate built
  // because a stage lied about its passing tests.
  const raw = fixture('microcache');
  assert.equal(raw.driver.verify, 'node --test');
  assert.equal(ensureGraph(fixture('microcache')).driver.verify, 'node --test');
});

test('a REAL brief that states its boundary as an exclusion is not rejected', () => {
  // The real gatepost brief ends "Out of scope: deploying it, publishing it, ...".
  // That STATES the boundary; it does not instruct a crossing. Before this was
  // handled, migrating the run threw E-GRAPH and the completed run became
  // unloadable.
  const brief = fixture('gatepost').driver.brief;
  assert.match(brief, /[Oo]ut of scope/, 'the fixture must still contain the phrase that caused this');
  assert.deepEqual(scanBoundaryVerbs(brief), []);
  assert.ok(ensureGraph(fixture('gatepost')).driver.graph);
});

// ---- the shapes no real run carries -----------------------------------------

test('shape 2: a state with NO driver key is returned untouched', () => {
  // Three real projects (assay, onedesk, repo-keeper) are in this shape.
  // Synthesising an empty graph would claim a run exists: nextAction() reports
  // {type:'no-driver'} and renderStatus fails open, so both would silently lie.
  const state = { schema: 'raphael/academy-state/v1', project: 'assay', status: 'done' };
  const out = ensureGraph(state);
  assert.equal(out.driver, undefined);
  assert.equal(out.schema, 'raphael/academy-state/v1', 'the schema must not be bumped either');
  assert.equal(isGraphState(out.driver), false);
});

test('shape 3: a mid-flight run puts the cursor on the current stage and marks the prior ones done', () => {
  const state = ensureGraph(preGraph({ stage: 1 }, { plan: doneRec() }));
  assert.equal(state.driver.cursor, 'architect');
  assert.equal(state.driver.nodes.plan.status, 'done');
  assert.equal(state.driver.nodes.architect.status, 'pending');
  assert.equal(state.driver.nodes.develop.status, 'pending');
  assert.equal(state.driver.status, 'running');
});

test('shape 4: an in-flight stage stays RESUMABLE — its live session is preserved', () => {
  const state = ensureGraph(preGraph({ stage: 1 }, {
    plan: doneRec(),
    architect: { status: 'running', session_id: 'live-session', at: '2026-07-01T02:00:00.000Z' }
  }));
  assert.equal(state.driver.nodes.architect.status, 'running');
  assert.equal(state.driver.nodes.architect.session_id, 'live-session');
});

test('shape 5: a "retry" stage is NOT resumed — its failed session is dropped', () => {
  // The trap. 'retry' means "the session failed, start fresh at the escalated
  // model", the opposite of 'running'. The obvious lift (both are in flight, so
  // both become running) would hand a FAILED session id to --resume, which the
  // driver explicitly forbids.
  const state = ensureGraph(preGraph({ stage: 2 }, {
    plan: doneRec(), architect: doneRec(),
    develop: { status: 'retry', session_id: 'dead-session', retry_escalated: true, at: '2026-07-01T03:00:00.000Z' }
  }));
  const node = state.driver.nodes.develop;
  assert.equal(node.status, 'running');
  assert.equal(node.session_id, null, 'a failed session must never be handed to --resume');
  assert.notEqual(node.session_id, 'dead-session');
  const escalations = node.visits[0].attempts.filter((a) => a.class === 'model');
  assert.equal(escalations.length, 1, 'the escalation it already spent stays spent');
  assert.equal(node.visits[0].escalated, true);
});

test('shape 8: retry_escalated becomes one consumed model attempt, not a fresh budget', () => {
  const state = ensureGraph(preGraph({ stage: 2 }, {
    plan: doneRec(), architect: doneRec(),
    develop: doneRec({ retry_escalated: true, status: 'done' })
  }));
  const attempts = state.driver.nodes.develop.visits[0].attempts;
  assert.equal(attempts.filter((a) => a.class === 'model').length, 1);
  assert.ok(attempts.every((a) => a.migrated === true));
});

test('shape 8 edge: timeouts AND an escalation are both carried, not one or the other', () => {
  const state = ensureGraph(preGraph({ stage: 2 }, {
    plan: doneRec(), architect: doneRec(),
    develop: doneRec({ timeouts: 2, retry_escalated: true })
  }));
  const attempts = state.driver.nodes.develop.visits[0].attempts;
  assert.equal(attempts.filter((a) => a.class === 'timeout').length, 2);
  assert.equal(attempts.filter((a) => a.class === 'model').length, 1);
});

test('a failed stage migrates as failed, so a human still has something to retry', () => {
  const state = ensureGraph(preGraph({ stage: 1, status: 'failed' }, {
    plan: doneRec(),
    architect: { status: 'failed', session_id: 's9', error: 'boom', at: '2026-07-01T04:00:00.000Z' }
  }));
  assert.equal(state.driver.nodes.architect.status, 'failed');
  assert.equal(state.driver.status, 'failed');
  assert.equal(cursorNodeId(state.driver), 'architect');
});

// ---- duplicate kinds, the whole point of the phase ---------------------------

test('a duplicate-kind pipeline gets one node per visit instead of one overwritten record', () => {
  // `--pipeline "develop,test,develop"` has always been legal, and the pre-graph
  // driver keyed records by kind, so the second develop silently overwrote the
  // first and renderPlan marked BOTH visits done from one entry.
  const state = ensureGraph(preGraph(
    { pipeline: ['develop', 'test', 'develop'], stage: 3, status: 'done' },
    { develop: doneRec(), test: doneRec() }
  ));
  assert.deepEqual(Object.keys(state.driver.nodes), ['develop', 'test', 'develop-2']);
  assert.equal(state.driver.nodes['develop-2'].status, 'done');
  assert.equal(state.driver.graph.nodes[2].kind, 'develop', 'the second visit is still a develop stage');
});

// ---- idempotence, hashing, and the derived fields ----------------------------

test('ensureGraph is idempotent — migrating twice changes nothing', () => {
  const once = ensureGraph(fixture('gatepost'));
  const hash = once.driver.graph_hash;
  const twice = ensureGraph(once);
  assert.equal(twice.driver.graph_hash, hash);
  assert.equal(graphHash(twice.driver.graph), hash, 'the stored hash matches the stored graph');
  assert.equal(twice.driver.migrated_from, 'pipeline');
});

test('a lifted pipeline is always named "custom", never a template name', () => {
  // The divergence check on resume compares graph_hash to the NAMED template's
  // current hash, and `raph update` replaces shipped templates daily. Naming a
  // lifted pipeline after a template would make that check cry wolf on every
  // resume of a migrated run.
  assert.equal(ensureGraph(fixture('microcache')).driver.graph_name, 'custom');
});

test('edge: a driver with an empty or missing pipeline is left alone rather than half-migrated', () => {
  assert.equal(ensureGraph(preGraph({ pipeline: [] })).driver.graph, undefined);
  assert.equal(ensureGraph(preGraph({ pipeline: undefined })).driver.graph, undefined);
  assert.equal(ensureGraph(null), null);
  assert.equal(ensureGraph(undefined), undefined);
});

// ---- the accessors the two outside readers depend on -------------------------

test('decisionsByNode reads BOTH shapes — the DECIDED block cannot silently empty', () => {
  // The old reader used `state.driver?.stages ?? {}` and failed OPEN, so moving
  // the records would have emptied the only place a human sees what the machine
  // decided, and no existing test would have caught it.
  const legacy = preGraph({ stage: 1 }, { plan: doneRec({ decisions: ['chose A — because B'] }) });
  const fromLegacy = decisionsByNode(legacy.driver);
  assert.equal(fromLegacy.length, 1);
  assert.deepEqual(fromLegacy[0].decisions, ['chose A — because B']);

  const migrated = ensureGraph(legacy);
  const fromGraph = decisionsByNode(migrated.driver);
  assert.equal(fromGraph.length, 1, 'a graph-shaped state must still print a DECIDED line');
  assert.deepEqual(fromGraph[0].decisions, ['chose A — because B']);
  assert.equal(fromGraph[0].id, 'plan');

  assert.deepEqual(decisionsByNode(null), []);
  assert.deepEqual(decisionsByNode({}), []);
});

test('decisionsByNode returns every visit of a looping node, not just the last', () => {
  const driver = {
    graph: { nodes: [] },
    nodes: {
      frontend: {
        status: 'done',
        visits: [
          { ...newVisit(1), decisions: ['first pass — chose a card layout'] },
          { ...newVisit(2), decisions: ['second pass — fixed the focus ring'] }
        ]
      }
    }
  };
  const out = decisionsByNode(driver);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((d) => d.visit), [1, 2]);
});

test('cursorNodeId never degrades to "undefined" on a completed run', () => {
  // The F11 failure message read pipeline[stage], which is undefined one past
  // the end — so a completed run reported 'stage "undefined" failed'.
  assert.equal(cursorNodeId(ensureGraph(fixture('gatepost')).driver), null);
  assert.equal(cursorNodeId(ensureGraph(preGraph({ stage: 1 }, { plan: doneRec() })).driver), 'architect');
  assert.equal(cursorNodeId(null), null);
});

// ---- clearNode ---------------------------------------------------------------

test('clearNode resets the node and, by default, PRESERVES the loop counters', () => {
  const state = ensureGraph(preGraph({ stage: 1, status: 'failed' }, {
    plan: doneRec(),
    architect: { status: 'failed', session_id: 's9', error: 'boom' }
  }));
  state.driver.visits.architect = 2;
  state.driver.edge_visits['architect->plan'] = 2;

  clearNode(state, 'architect');
  assert.equal(state.driver.nodes.architect.status, 'pending');
  assert.equal(state.driver.nodes.architect.session_id, null);
  assert.deepEqual(state.driver.nodes.architect.visits, []);
  // A retry that quietly restored the loop budget would let a run exceed a bound
  // it already declared, so the audit trail is the default.
  assert.equal(state.driver.visits.architect, 2);
  assert.equal(state.driver.edge_visits['architect->plan'], 2);
});

test('clearNode --reset-loops clears the three maps TOGETHER so they cannot drift', () => {
  const state = ensureGraph(preGraph({ stage: 1, status: 'failed' }, { plan: doneRec() }));
  state.driver.visits.architect = 2;
  state.driver.edge_visits['architect->plan'] = 2;
  state.driver.edge_visits['plan->architect'] = 1;
  state.driver.edge_visits['develop->plan'] = 1;

  clearNode(state, 'architect', { resetLoops: true });
  assert.equal(state.driver.visits.architect, undefined);
  assert.equal(state.driver.edge_visits['architect->plan'], undefined);
  assert.equal(state.driver.edge_visits['plan->architect'], undefined);
  // an edge touching neither end is left alone
  assert.equal(state.driver.edge_visits['develop->plan'], 1);
});

test('clearNode refuses an unknown node rather than creating one', () => {
  const state = ensureGraph(preGraph({ stage: 1 }, { plan: doneRec() }));
  assert.throws(() => clearNode(state, 'ghost'), /E-GRAPH: no node "ghost"/);
});
