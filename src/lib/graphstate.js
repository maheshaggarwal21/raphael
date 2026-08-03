// Lifting a pre-graph driver state onto the graph engine. A linear pipeline
// is a linear graph, so every state is read through ensureGraph() and the
// driver only ever knows about graphs — no dual code path.
//
// Eight distinct on-disk shapes exist; see D18 in
// docs/graph-engineering-plan.md. Fixtures under test/fixtures are taken from
// the two authentic pre-graph runs in existence (gatepost, microcache), both
// edge cases.
//
// Pure: no clock of its own beyond a stamp, no file I/O, no spawns.

import { validateGraph, pipelineToGraph, graphHash, TERMINALS } from './graph.js';
import { canEscalate } from './policy.js';

export const STATE_SCHEMA_V2 = 'raphael/academy-state/v2';

// A node's per-visit record. Visits are a list, not a slot — a kind-keyed
// record would silently overwrite on a repeated kind, which is why a loop
// couldn't be expressed before this. Keeping every visit is also what makes
// loop-back data possible, since the loop's own evidence would otherwise be
// overwritten by it.
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
// A state with no driver key at all (shape 2) is a project that has never
// been driven, and must stay that way — nextAction() and renderStatus depend
// on telling that apart from an empty run.
export function ensureGraph(state, { now = () => new Date().toISOString() } = {}) {
  if (!state || typeof state !== 'object') return state;
  const d = state.driver;
  if (!d) return state;                 // shape 2 — untouched, deliberately
  if (isGraphState(d)) return state;    // already migrated

  const pipeline = Array.isArray(d.pipeline) ? d.pipeline : [];
  if (!pipeline.length) return state;   // nothing meaningful to lift

  const lifted = pipelineToGraph(pipeline, { name: 'custom' });
  // `custom` always, never a template name: the divergence check on resume
  // compares graph_hash against the named template's current hash, and a
  // shipped template can change under `raph update`.
  //
  // The boundary deny-scan is skipped here on purpose. This state already
  // exists on disk and was already accepted by the pre-graph driver; refusing
  // to load a user's completed run over its brief's own wording would be a
  // worse outcome than the risk. New graphs are scanned at init instead.
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
    // An interrupted stage carries `timeouts: n`; dropping the scalar would
    // reset the retry budget on migration, granting extra spawns.
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
    // Records were keyed by kind, so a duplicated kind shares one record
    // between its visits — lifted onto each node as the only evidence that
    // exists for either.
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
      // In flight with a live session — resume it, don't restart.
      node.status = 'running';
      node.session_id = rec.session_id ?? null;
    } else if (rec.status === 'retry') {
      // 'retry' means the session failed and should start fresh at the
      // escalated model — the opposite of 'running'. Lifting it to 'running'
      // naively would hand a dead session id to --resume.
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

  // `pipeline[stage]` is undefined one past the end, so a completed run maps
  // to cursor: null rather than an invalid index.
  const cursor = complete ? null : idOf(stageIndex);
  // The node the run is sitting on has been entered even without a record yet
  // (it may not have spawned) — leaving its visit counter unset would read as
  // "never entered" once it finishes.
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
    verify: d.verify ?? null,
    brief: d.brief ?? '',
    started_at: d.started_at ?? stamp,
    updated_at: stamp,
    // Derived display field only, never routing — kept for `raph academy
    // status` and older readers to print.
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

// The one accessor for a run's decisions, so a shape change can't silently
// empty the DECIDED block or the failure message.
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

// Which node the run is sitting on. Never `pipeline[stage]`, which degrades
// to "stage undefined" one past the end of a completed run.
export function cursorNodeId(driver) {
  if (!driver) return null;
  if (isGraphState(driver)) return driver.cursor;
  return driver.pipeline?.[driver.stage] ?? null;
}

export { TERMINALS };
