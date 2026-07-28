// Phase 23.3 — lifting a pre-graph driver state onto the graph engine.
//
// ONE ENGINE, NOT TWO. A linear pipeline *is* a linear graph, so every state is
// read through ensureGraph() and the driver only ever knows about graphs. A
// dual code path would be exactly the "loop wearing a graph's vocabulary" this
// phase exists to remove.
//
// The draft of this design covered migration in one sentence. There are eight
// distinct shapes on disk, and three of them were silent bugs — see D18 in
// docs/graph-engineering-plan.md. The fixtures under test/fixtures are taken
// from the only two authentic pre-graph runs in existence (gatepost, microcache)
// and both happen to be edge cases.
//
// Pure: no clock of its own beyond a stamp, no file I/O, no spawns.

import { validateGraph, pipelineToGraph, graphHash, TERMINALS } from './graph.js';
import { canEscalate } from './policy.js';

export const STATE_SCHEMA_V2 = 'raphael/academy-state/v2';

// A node's per-visit record. Visits are a LIST, not a slot: the pre-graph driver
// keyed stage records by kind, so a pipeline running the same kind twice
// silently overwrote the first — which is why a loop could not be expressed at
// all. Keeping every visit is also what makes loop-back data possible, since the
// evidence the loop exists to generate would otherwise be overwritten by it.
export function newVisit(n, { startedAt = null } = {}) {
  return {
    n,
    startedAt,
    output: null,
    verdict: null,
    decisions: [],
    tokens: 0,
    tokensCaptured: true,
    elapsedMs: 0,
    escalated: false,
    attempts: []
  };
}

function newNode(node) {
  return {
    status: 'pending',
    session_id: null,
    escalatable: node.escalatable,
    visits: []
  };
}

// Is this driver state already on the graph engine?
export function isGraphState(driver) {
  return Boolean(driver && driver.graph && driver.nodes);
}

// ensureGraph(state) — returns the state with a graph-shaped driver.
//
// Shape 2 is the one that must NOT be "helpfully" filled in: a state with no
// driver key at all is a project that has never been driven, and both
// nextAction() ({type:'no-driver'}) and renderStatus depend on telling that
// apart from an empty run. Synthesising a graph there would silently claim a
// run exists.
export function ensureGraph(state, { now = () => new Date().toISOString() } = {}) {
  if (!state || typeof state !== 'object') return state;
  const d = state.driver;
  if (!d) return state;                 // shape 2 — untouched, deliberately
  if (isGraphState(d)) return state;    // already migrated

  const pipeline = Array.isArray(d.pipeline) ? d.pipeline : [];
  if (!pipeline.length) return state;   // nothing meaningful to lift

  const lifted = pipelineToGraph(pipeline, { name: 'custom' });
  // `custom` for anything lifted, ALWAYS: the divergence check on resume compares
  // graph_hash against the named template's current hash, and a shipped template
  // can change under `raph update`. Naming a lifted pipeline after a template
  // would make that check cry wolf on every resume of a migrated run.
  //
  // Rule 15 (the boundary deny-scan) is deliberately SKIPPED here. This state
  // already exists on disk and was already accepted by the pre-graph driver;
  // refusing to load a user's completed run because its brief says "Out of
  // scope: deploying it" would be a regression far worse than the risk. New
  // graphs are scanned at init, which is where the scan can actually prevent
  // something.
  const graph = validateGraph(lifted, { name: 'custom', scanBoundary: false });

  const idOf = (index) => graph.nodes[index]?.id ?? null;
  const nodes = {};
  for (const node of graph.nodes) nodes[node.id] = newNode(node);

  const stageIndex = Number.isInteger(d.stage) ? d.stage : 0;
  const complete = d.status === 'done' || stageIndex >= pipeline.length;
  const stamp = now();

  const visits = {};
  const migratedAttempts = (rec) => {
    const attempts = [];
    // Shape 7 — a stage that was interrupted carries `timeouts: n`. Dropping the
    // scalar resets the budget: a stage already at 2 would get three MORE
    // spawns, and `develop` carries a 25-minute clock, so that is up to ~75
    // minutes of unbudgeted subscription spend on exactly the failure mode this
    // phase cites. gatepost's `test` stage has timeouts: 1 on disk.
    for (let i = 0; i < (rec.timeouts ?? 0); i += 1) {
      attempts.push({ class: 'timeout', action: 'resume', at: rec.at ?? stamp, evidence: null, migrated: true });
    }
    // Shape 8 — `retry_escalated: true` means one escalation has been consumed.
    if (rec.retry_escalated === true) {
      attempts.push({ class: 'model', action: 'escalate', at: rec.at ?? stamp, evidence: null, migrated: true });
    }
    return attempts;
  };

  for (const [index, kind] of pipeline.entries()) {
    const id = idOf(index);
    if (!id) continue;
    // Records were keyed by KIND, so a duplicated kind has exactly one record
    // shared between its visits. Lifting it onto each node is the honest reading:
    // it is the only evidence that exists for either.
    const rec = d.stages?.[kind];
    const node = nodes[id];
    if (!rec) continue;

    const visit = newVisit(1, { startedAt: rec.at ?? null });
    visit.output = rec.output ?? null;
    visit.decisions = Array.isArray(rec.decisions) ? rec.decisions : [];
    visit.tokens = rec.tokens ?? 0;
    visit.tokensCaptured = rec.tokens_captured !== false;
    visit.elapsedMs = rec.elapsed_ms ?? 0;
    visit.escalated = rec.retry_escalated === true || rec.escalated === true;
    visit.attempts = migratedAttempts(rec);
    node.visits = [visit];
    visits[id] = 1;

    if (complete || index < stageIndex || rec.status === 'done') {
      node.status = 'done';
      node.session_id = rec.session_id ?? null;
    } else if (rec.status === 'running') {
      // Shape 4 — in flight with a live session. RESUME it, do not restart.
      node.status = 'running';
      node.session_id = rec.session_id ?? null;
    } else if (rec.status === 'retry') {
      // Shape 5 — the trap. 'retry' means "the session FAILED, start fresh at
      // the escalated model", the opposite of 'running'. The obvious lift (both
      // are in-flight, so both become running) would hand a failed session id to
      // --resume, which the driver explicitly forbids.
      node.status = 'running';
      node.session_id = null;
      if (!visit.attempts.some((a) => a.class === 'model')) {
        visit.attempts.push({ class: 'model', action: 'escalate', at: rec.at ?? stamp, evidence: null, migrated: true });
      }
      visit.escalated = true;
    } else if (rec.status === 'failed') {
      node.status = 'failed';
      node.session_id = rec.session_id ?? null;
    }
  }

  // Shape 6 — BOTH real runs on disk. `pipeline[stage]` is undefined one past
  // the end, so "map stage to the cursor" yields cursor: undefined for every
  // completed run. null is a legal, documented terminal value.
  const cursor = complete ? null : idOf(stageIndex);
  // The node the run is SITTING ON has been entered, even if it has no record
  // yet (it may never have spawned). Leaving its counter unset would make the
  // three maps disagree the moment it finishes — visits is the loop counter, and
  // an unset one reads as "never entered".
  if (cursor && !visits[cursor]) visits[cursor] = 1;
  if (!complete) {
    for (const [index] of pipeline.entries()) {
      const id = idOf(index);
      if (id && index < stageIndex && nodes[id].status === 'pending') nodes[id].status = 'done';
    }
  } else {
    for (const node of Object.values(nodes)) if (node.status !== 'failed') node.status = 'done';
  }

  state.schema = STATE_SCHEMA_V2;
  state.driver = {
    graph,
    graph_hash: graphHash(graph),
    graph_name: 'custom',
    cursor,
    nodes,
    visits,
    edge_visits: {},
    history: [],
    budgets: { maxNodes: null, maxWallClockMs: null },
    spent: { nodes: Object.values(visits).reduce((a, b) => a + b, 0), wallClockMs: 0, tokens: { value: 0, complete: true } },
    runLimit: null,
    status: d.status === 'done' ? 'done' : d.status ?? 'running',
    escalation: null,
    // Preserved verbatim. microcache carries verify: "node --test" on disk, so a
    // migration that dropped it would be a live regression, not a hypothetical.
    verify: d.verify ?? null,
    brief: d.brief ?? '',
    started_at: d.started_at ?? stamp,
    updated_at: stamp,
    // Derived display field only — never routing. Kept so `raph academy status`
    // and the two outside readers have something familiar to print.
    pipeline: [...pipeline],
    migrated_from: 'pipeline'
  };

  // Roll the honest cost totals up from the per-visit records.
  let tokens = 0;
  let tokensComplete = true;
  let wall = 0;
  for (const node of Object.values(nodes)) {
    for (const v of node.visits) {
      tokens += v.tokens;
      wall += v.elapsedMs;
      if (!v.tokensCaptured) tokensComplete = false;
    }
  }
  state.driver.spent = {
    nodes: Object.values(visits).reduce((a, b) => a + b, 0),
    wallClockMs: wall,
    tokens: { value: tokens, complete: tokensComplete }
  };
  return state;
}

// Clear one node so a human can send the run at it again. ONE function, because
// the three maps (nodes / visits / edge_visits) must move together or they
// drift: clearing a node's record while leaving its edge traversals counted
// would silently shrink the loop budget on the retry.
export function clearNode(state, id, { resetLoops = false } = {}) {
  const d = state?.driver;
  if (!d?.nodes?.[id]) throw new Error(`E-GRAPH: no node "${id}" in this run`);
  d.nodes[id] = newNode(d.graph.nodes.find((n) => n.id === id) ?? { escalatable: canEscalate(d.nodes[id]?.kind ?? '') });
  if (resetLoops) {
    // Opt-in: the audit trail is the default, because a retry that quietly
    // restored the loop budget would let a run exceed a declared bound.
    delete d.visits[id];
    for (const key of Object.keys(d.edge_visits)) {
      const [from, to] = key.split('->');
      if (from === id || to === id) delete d.edge_visits[key];
    }
  }
  return state;
}

// The DECIDED block and the failure message both read the run's decisions. This
// is the one accessor, so a shape change cannot silently empty either of them —
// the old readers used `?? {}` and failed OPEN, which is why no existing test
// caught the loss.
export function decisionsByNode(driver) {
  const out = [];
  if (!driver) return out;
  if (isGraphState(driver)) {
    for (const [id, node] of Object.entries(driver.nodes ?? {})) {
      for (const visit of node.visits ?? []) {
        if (visit.decisions?.length) out.push({ id, visit: visit.n, decisions: visit.decisions });
      }
    }
    return out;
  }
  for (const [kind, rec] of Object.entries(driver.stages ?? {})) {
    if (rec?.decisions?.length) out.push({ id: kind, visit: 1, decisions: rec.decisions });
  }
  return out;
}

// Which node is the run sitting on — for the F11 failure message and status.
// Never `pipeline[stage]`, which degrades to "stage undefined failed" one past
// the end of a completed run.
export function cursorNodeId(driver) {
  if (!driver) return null;
  if (isGraphState(driver)) return driver.cursor;
  return driver.pipeline?.[driver.stage] ?? null;
}

export { TERMINALS };
