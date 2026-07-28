// The graph layer (Phase 23, ARCHITECTURE §15) — "what runs next", declared
// before the run starts instead of decided inside it.
//
// Design: docs/graph-engineering-plan.md. The honest justification, in one
// sentence: the driver keys stage records by KIND (`d.stages[kind]`), so a
// pipeline containing the same kind twice silently overwrites the first record —
// which makes "frontend builds, design reviews, send it back, repeat" not
// expressible at all. A graph with per-visit records is what makes it expressible,
// and making it BOUNDED and INSPECTABLE is what keeps it safe.
//
// This module is the PLANNING layer and nothing else. It is pure: it spawns
// nothing, spends nothing, reads no files, and has no clock. Everything it can
// reject, it rejects before a single token is spent.
//
// Two rules that shape the whole file:
//   - `edges` are the ONLY control relation. `inputs` is a pure data selector
//     (which prior nodes' text gets rendered into this node's prompt) and has no
//     effect on ordering. Defining topology twice is how a graph ends up unable
//     to pass its own validator.
//   - The model never authors topology. Graphs come from a shipped template or
//     the owner's --graph-file, never from stage output. Same rule as --verify.

import { createHash } from 'node:crypto';
import { POLICY, policyKinds, canEscalate } from './policy.js';
import { isNegatedAt } from './match.js';
import { RECOVERY, MAX_NODE_ATTEMPTS } from './recovery.js';

// Reserved edge targets. `@done` completes the run (the existing boundary logic
// records the owner ask); `@owner` terminates and escalates to a human.
export const TERMINAL_DONE = '@done';
export const TERMINAL_OWNER = '@owner';
export const TERMINALS = Object.freeze(new Set([TERMINAL_DONE, TERMINAL_OWNER]));

// Kinds that must never be drivable unattended, INDEPENDENT of whether a policy
// entry exists for them. `redteam` is the offensive agent: the roster withholds
// Edit/Write from it deliberately, and the driver spawns with acceptEdits, while
// BOUNDARY_RULES ("There is NO HUMAN in this loop") would directly override the
// redteam mission's own first rule ("AUTHORIZATION IS THE FIRST STEP, ALWAYS").
// It stays reachable exactly where a human is: the manager, the pentest recipe.
// Checked BEFORE the policy-membership rule so that adding it to POLICY later
// cannot silently make it drivable.
export const DRIVER_FORBIDDEN_KINDS = Object.freeze(new Set(['redteam']));

export const WHEN_VALUES = Object.freeze(['pass', 'changes', 'always']);
export const EMIT_VALUES = Object.freeze(['deliverable', 'verdict']);

// Stages that WRITE code and are therefore expected to leave it working.
// Lifted from driver.js so the planning layer does not import the driver; 23.2
// prunes the dead members (implement/refactor/qa are not POLICY kinds) and a
// test there asserts every member resolves.
export const VERIFIED_KINDS = Object.freeze(new Set(['develop', 'test', 'debug', 'implement', 'refactor']));

export const MAX_GRAPH_NODES = 64;      // bounds the SCC walk and any hand-written file
export const MAX_TITLE_LEN = 120;
export const MAX_CRITERIA_LEN = 2000;
export const MAX_CHECK_DEPTH = 3;
export const MAX_PATTERN_LEN = 200;
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function bad(message) {
  return new Error(`E-GRAPH: ${message}`);
}

// ---- the boundary deny-scan (D13) -------------------------------------------

// The draft claimed the deploy boundary was structural because "there is no
// deploy kind, so no valid graph can contain one". That is a claim about node
// LABELS, not capabilities: every node spawns with --permission-mode acceptEdits,
// tools on, cwd = the real workspace. What actually stops a deploy today is
// BOUNDARY_RULES prose — and a graph ADDS free-text `criteria` rendered into
// that same prompt. So
//   { id:'ship', kind:'develop', criteria:'Publish the package to npm ...' }
// would otherwise pass validation in full.
//
// This scan is the deterministic floor under that prose: zero tokens, runs at
// init, before anything spawns. It matches boundary verbs in an ACTION position
// (verb + article/preposition/object), never bare topic words — so "deploy-prep",
// "deployment checklist" and "the release notes" do not fire, while "deploy the
// app to production" does. Negated mentions are exempt via the brain's own
// negation helper, because the correct criteria for a deploy-prep node reads
// "produce the checklist; never deploy anything yourself".
const BOUNDARY_RULES_SCAN = [
  ['publish', /\b(?:npm|yarn|pnpm)\s+publish\b/gi,
    'publishing a package is the owner\'s action'],
  ['publish', /\bpublish(?:es|ing)?\s+(?:the|this|it|a|an|your|our|to)\b/gi,
    'publishing is the owner\'s action'],
  ['deploy', /\bdeploy(?:s|ing)?\s+(?:the|this|it|a|an|your|our|to)\b/gi,
    'deploying is the owner\'s action'],
  ['deploy', /\b(?:go|going)\s+live\b/gi,
    'going live is the owner\'s action'],
  ['push', /\bgit\s+push\b/gi,
    'pushing to a remote is the owner\'s action'],
  ['push', /\bpush(?:es|ing)?\s+(?:to|the\s+(?:branch|commit|code|repo|repository))\b/gi,
    'pushing to a remote is the owner\'s action'],
  ['release', /\brelease\s+(?:to|into)\s+\w/gi,
    'releasing is the owner\'s action'],
  ['signin', /\b(?:sign|log)\s*(?:in|into|on)\b/gi,
    'signing in is the owner\'s action'],
  ['signup', /\b(?:sign\s*up|create\s+(?:an?\s+)?account|register\s+(?:an?\s+)?account)\b/gi,
    'creating an account is the owner\'s action'],
  ['spend', /\b(?:purchase|buy|pay\s+for|spend\s+(?:money|\$)|enter\s+(?:a\s+)?(?:credit\s+card|payment|card\s+details))\b/gi,
    'spending money is the owner\'s action']
];

// Returns [{ rule, match, index, why }] — empty means clean. Pure and total.
export function scanBoundaryVerbs(text, { label = 'text' } = {}) {
  const s = String(text ?? '');
  const found = [];
  for (const [rule, re, why] of BOUNDARY_RULES_SCAN) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      // A negated mention is the CORRECT way to state the boundary, not a
      // violation of it: "never deploy the app yourself" must pass.
      if (isNegatedAt(s, m.index)) continue;
      found.push({ rule, label, match: m[0], index: m.index, why });
      if (found.length >= 8) return found;
    }
  }
  return found;
}

// ---- check validation (rule 11) ---------------------------------------------

// `check` is the DECLARED pass predicate — the sharpest finding of the review
// was that the draft made topology explicit while leaving the predicate that
// selects an edge exactly as it is today (a self-assessed "does the text have a
// DECISIONS heading"). Every node must declare one, and it is type-checked here.
//
// `check.command` is deliberately NOT an allowed form. A shell command in a
// graph would be a new execution channel reachable from a shipped template
// (which `raph update` replaces daily) or an adopted file. The only shell
// command in the system stays the owner's --verify, typed on the CLI.
function validateCheck(check, where, depth = 0) {
  if (depth > MAX_CHECK_DEPTH) throw bad(`${where}: check nesting is deeper than ${MAX_CHECK_DEPTH}`);
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw bad(`${where}: check must be an object declaring exactly one form`);
  }
  const keys = Object.keys(check);
  if (keys.includes('command') || keys.includes('cmd') || keys.includes('shell')) {
    throw bad(`${where}: a graph may not carry a shell command — the only command the driver runs is the owner's --verify`);
  }
  if (keys.length !== 1) {
    throw bad(`${where}: check must declare exactly one form, got ${keys.length} (${keys.join(', ') || 'none'})`);
  }
  const [form] = keys;
  const value = check[form];
  switch (form) {
    case 'requires_section':
      if (typeof value !== 'string' || !value.trim()) {
        throw bad(`${where}: check.requires_section must be a non-empty string`);
      }
      break;
    case 'file_exists':
      assertWorkspacePath(value, `${where}: check.file_exists`);
      break;
    case 'file_matches': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw bad(`${where}: check.file_matches must be an object with path and pattern`);
      }
      assertWorkspacePath(value.path, `${where}: check.file_matches.path`);
      if (typeof value.pattern !== 'string' || !value.pattern) {
        throw bad(`${where}: check.file_matches.pattern must be a non-empty string`);
      }
      if (value.pattern.length > MAX_PATTERN_LEN) {
        throw bad(`${where}: check.file_matches.pattern is longer than ${MAX_PATTERN_LEN} characters`);
      }
      try { new RegExp(value.pattern); } catch (err) {
        throw bad(`${where}: check.file_matches.pattern is not a valid regular expression (${err.message})`);
      }
      break;
    }
    case 'all':
      if (!Array.isArray(value) || value.length === 0) {
        throw bad(`${where}: check.all must be a non-empty array of checks`);
      }
      if (value.length > 8) throw bad(`${where}: check.all may hold at most 8 checks`);
      value.forEach((sub, i) => validateCheck(sub, `${where}: check.all[${i}]`, depth + 1));
      break;
    default:
      throw bad(`${where}: unknown check form "${form}" — one of: requires_section, file_exists, file_matches, all`);
  }
}

// A check path is resolved against the project WORKSPACE at run time, so it must
// stay inside it. Rejected here rather than at execution: a path that can never
// be legal should never reach a run.
function assertWorkspacePath(p, where) {
  if (typeof p !== 'string' || !p.trim()) throw bad(`${where} must be a non-empty string`);
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]|\\\\)/.test(p)) throw bad(`${where} must be relative to the workspace, not absolute`);
  if (p.split(/[\\/]/).includes('..')) throw bad(`${where} must not escape the workspace with ".."`);
}

// ---- graph structure helpers -------------------------------------------------

function reachableFrom(startIds, adjacency) {
  const seen = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

// Tarjan's strongly-connected components, iterative so a long chain cannot blow
// the stack. Used instead of enumerating cycles (which is exponential): an SCC of
// size > 1 is exactly "these nodes can all reach each other", so every edge
// inside one is part of some cycle. O(V+E).
export function tarjanSCC(nodeIds, adjacency) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of nodeIds) {
    if (index.has(root)) continue;
    // Each frame is [node, iterator-position over its successors].
    const work = [[root, 0]];
    index.set(root, counter); low.set(root, counter); counter += 1;
    stack.push(root); onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      const [node, pos] = frame;
      const succs = adjacency.get(node) ?? [];
      if (pos < succs.length) {
        frame[1] += 1;
        const next = succs[pos];
        if (!index.has(next)) {
          index.set(next, counter); low.set(next, counter); counter += 1;
          stack.push(next); onStack.add(next);
          work.push([next, 0]);
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), index.get(next)));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === index.get(node)) {
          const component = [];
          for (;;) {
            const popped = stack.pop();
            onStack.delete(popped);
            component.push(popped);
            if (popped === node) break;
          }
          components.push(component);
        }
      }
    }
  }
  return components;
}

// ---- validateGraph — the whole planning layer --------------------------------

// Validates and NORMALISES a graph. Never mutates the input; returns a
// deep-frozen copy carrying the two resolved facts the driver needs and must
// not recompute at failure time:
//   escalatable      — whether this node's kind has an escalation model at all
//                      (only develop and debug do, 2 of 14 kinds — so a recovery
//                      table saying "model: max 1" is right for 2 and wrong for 12
//                      unless it is resolved per node, in advance)
//   effectiveVerify  — whether the owner's verifier runs after this node
//
// Throws on the first violation, with a message naming the node or edge.
export function validateGraph(graph, { brief = '', name = null } = {}) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw bad('a graph must be an object with entry, nodes and edges');
  }
  const nodes = graph.nodes;
  const edges = graph.edges ?? [];
  if (!Array.isArray(nodes) || nodes.length === 0) throw bad('a graph must declare at least one node');
  if (nodes.length > MAX_GRAPH_NODES) throw bad(`a graph may hold at most ${MAX_GRAPH_NODES} nodes, got ${nodes.length}`);
  if (!Array.isArray(edges)) throw bad('edges must be an array');

  const kinds = new Set(policyKinds());

  // --- rules 1, 10, 11, 12, 13, 16: every node on its own -----------------
  const byId = new Map();
  const normalisedNodes = [];
  for (const [i, node] of nodes.entries()) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw bad(`node #${i + 1} is not an object`);
    const id = node.id;
    if (typeof id !== 'string' || !id.trim()) throw bad(`node #${i + 1} has no id`);
    if (TERMINALS.has(id)) throw bad(`node id "${id}" collides with a reserved terminal (${[...TERMINALS].join(', ')})`);
    if (!ID_RE.test(id)) throw bad(`node id "${id}" must be kebab-case (letters, digits and single hyphens, starting with a letter)`);
    if (byId.has(id)) throw bad(`duplicate node id "${id}"`);

    const where = `node "${id}"`;
    const kind = node.kind;
    if (typeof kind !== 'string' || !kind.trim()) throw bad(`${where}: kind is required`);
    // BEFORE the policy check on purpose: if `redteam` were ever added to POLICY,
    // the policy rule would start passing and this one still refuses.
    if (DRIVER_FORBIDDEN_KINDS.has(kind)) {
      throw bad(`${where}: kind "${kind}" may never run unattended in the driver — it stays reachable only where a human is (the manager, the pentest recipe)`);
    }
    if (!kinds.has(kind)) {
      throw new Error(`E-POLICY: ${where} names unknown task kind "${kind}" — one of: ${[...kinds].join(', ')}`);
    }

    const title = node.title ?? id;
    if (typeof title !== 'string') throw bad(`${where}: title must be a string`);
    if (title.length > MAX_TITLE_LEN) throw bad(`${where}: title is longer than ${MAX_TITLE_LEN} characters`);

    const criteria = node.criteria ?? '';
    if (typeof criteria !== 'string') throw bad(`${where}: criteria must be a string`);
    if (criteria.length > MAX_CRITERIA_LEN) throw bad(`${where}: criteria is longer than ${MAX_CRITERIA_LEN} characters`);

    const emit = node.emit ?? 'deliverable';
    if (!EMIT_VALUES.includes(emit)) throw bad(`${where}: emit must be one of ${EMIT_VALUES.join(' | ')}, got "${emit}"`);

    if (node.check === undefined) {
      throw bad(`${where}: check is required — a node with no declared pass predicate makes its outgoing edge a guess`);
    }
    validateCheck(node.check, where);

    // D6 — verify is ADDITIVE ONLY. A graph may EXTEND verification to a node
    // the code would not check; it may never SUBTRACT one. Graph data switching
    // off the owner's verifier would invert the trust direction on the one gate
    // that exists because a `test` stage claimed 135 passing tests while the
    // suite was red.
    if (node.verify !== undefined && typeof node.verify !== 'boolean') {
      throw bad(`${where}: verify must be true or false when present`);
    }
    if (node.verify === false && VERIFIED_KINDS.has(kind)) {
      throw bad(`${where}: a graph cannot switch off the owner's verifier (kind "${kind}" is always verified)`);
    }

    const inputs = node.inputs ?? [];
    if (!Array.isArray(inputs)) throw bad(`${where}: inputs must be an array of node ids`);
    for (const src of inputs) {
      if (typeof src !== 'string' || !src.trim()) throw bad(`${where}: inputs holds a non-string entry`);
      if (src === id) throw bad(`${where}: a node may not name itself in inputs — loop-back re-injects a node's own prior output automatically`);
    }

    const normalised = {
      id,
      kind,
      title,
      criteria,
      emit,
      inputs: [...inputs],
      // Cloned, not referenced: the returned graph is deep-frozen, and freezing
      // a sub-object of the caller's input would be a mutation of it.
      check: JSON.parse(JSON.stringify(node.check)),
      escalatable: canEscalate(kind),
      effectiveVerify: VERIFIED_KINDS.has(kind) || node.verify === true
    };
    byId.set(id, normalised);
    normalisedNodes.push(normalised);
  }

  // --- rules 2, 7, 8, 14: every edge, and each node's out-shape -----------
  const outgoing = new Map(normalisedNodes.map((n) => [n.id, []]));
  const inboundCount = new Map(normalisedNodes.map((n) => [n.id, 0]));
  const normalisedEdges = [];
  for (const [i, edge] of edges.entries()) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw bad(`edge #${i + 1} is not an object`);
    const { from, to, when } = edge;
    if (typeof from !== 'string' || !byId.has(from)) throw bad(`edge #${i + 1}: from "${from}" is not a node in this graph`);
    if (typeof to !== 'string' || (!byId.has(to) && !TERMINALS.has(to))) {
      throw bad(`edge ${from} -> "${to}": target is neither a node in this graph nor a terminal (${[...TERMINALS].join(', ')})`);
    }
    if (!WHEN_VALUES.includes(when)) {
      throw bad(`edge ${from} -> ${to}: when must be one of ${WHEN_VALUES.join(' | ')}, got "${when}"`);
    }
    if (edge.maxTraversals !== undefined) {
      if (!Number.isInteger(edge.maxTraversals) || edge.maxTraversals < 1) {
        throw bad(`edge ${from} -> ${to}: maxTraversals must be a positive integer`);
      }
    }
    const normalised = { from, to, when, ...(edge.maxTraversals !== undefined ? { maxTraversals: edge.maxTraversals } : {}), ...(edge.reason ? { reason: String(edge.reason).slice(0, MAX_TITLE_LEN) } : {}) };
    outgoing.get(from).push(normalised);
    if (byId.has(to)) inboundCount.set(to, inboundCount.get(to) + 1);
    normalisedEdges.push(normalised);
  }

  // D5 — `when` exclusivity, plus rule 8. A node has EITHER exactly one `always`
  // edge OR exactly one `pass` edge paired with exactly one `changes` edge.
  // The draft allowed pass + changes + always on one node, where an APPROVED
  // verdict matched two edges with no declared precedence — an ambiguity whose
  // test would have documented whichever branch the implementation happened to
  // reach first. And since a `changes` edge may only leave a verdict node, this
  // resolves to: deliverable nodes advance, verdict nodes branch.
  for (const node of normalisedNodes) {
    const outs = outgoing.get(node.id);
    const byWhen = { pass: [], changes: [], always: [] };
    for (const e of outs) byWhen[e.when].push(e);
    const where = `node "${node.id}"`;

    if (outs.length === 0) throw bad(`${where}: has no outgoing edge — it can never reach a terminal`);
    for (const when of WHEN_VALUES) {
      if (byWhen[when].length > 1) throw bad(`${where}: has ${byWhen[when].length} "${when}" edges — at most one of each is allowed`);
    }
    if (byWhen.changes.length && node.emit !== 'verdict') {
      throw bad(`${where}: has a "changes" edge but emits a deliverable — only a verdict node can report changes`);
    }
    if (node.emit === 'verdict') {
      if (byWhen.always.length) throw bad(`${where}: is a verdict node, so it branches on pass/changes and may not carry an "always" edge`);
      if (!byWhen.pass.length || !byWhen.changes.length) {
        throw bad(`${where}: is a verdict node and needs exactly one "pass" edge and one "changes" edge`);
      }
    } else {
      if (byWhen.pass.length) throw bad(`${where}: emits a deliverable, so its single outgoing edge must be "always", not "pass"`);
      if (byWhen.always.length !== 1) throw bad(`${where}: emits a deliverable and needs exactly one "always" edge`);
    }
  }

  // --- rules 3, 4: entry and forward reachability -------------------------
  const entry = graph.entry;
  if (typeof entry !== 'string' || !entry.trim()) {
    throw bad('entry is required — it names the node the run starts at (it is never inferred, because a graph whose every node has an inbound edge has no inferable entry)');
  }
  if (!byId.has(entry)) throw bad(`entry "${entry}" is not a node in this graph`);

  const adjacency = new Map(normalisedNodes.map((n) => [n.id, outgoing.get(n.id).map((e) => e.to).filter((t) => byId.has(t))]));
  // Orphan check FIRST, and deliberately so: a non-entry node with no inbound
  // edge is ALWAYS also unreachable, so checking reachability first would make
  // this rule dead code and every orphan would report the vaguer diagnosis.
  // (Found by its own test, which could not go red until the order was fixed.)
  for (const node of normalisedNodes) {
    if (node.id !== entry && inboundCount.get(node.id) === 0) {
      throw bad(`node "${node.id}" has no inbound edge and is not the entry`);
    }
  }
  const reachable = reachableFrom([entry], adjacency);
  for (const node of normalisedNodes) {
    if (!reachable.has(node.id)) throw bad(`node "${node.id}" is unreachable from entry "${entry}"`);
  }

  // --- rule 5: co-reachability (every node must reach a terminal) ----------
  // This is what kills `developer <-> test` with no exit: a graph that validates,
  // spins, and escalates 100% of runs having spent real tokens.
  const reverse = new Map(normalisedNodes.map((n) => [n.id, []]));
  const terminalFeeders = [];
  for (const e of normalisedEdges) {
    if (TERMINALS.has(e.to)) terminalFeeders.push(e.from);
    else reverse.get(e.to).push(e.from);
  }
  if (!terminalFeeders.length) {
    throw bad(`no node routes to a terminal — a run of this graph could never finish (route one to ${TERMINAL_DONE})`);
  }
  const coReachable = reachableFrom(terminalFeeders, reverse);
  for (const node of normalisedNodes) {
    if (!coReachable.has(node.id)) {
      throw bad(`node "${node.id}" can never reach a terminal — the run would spin until a bound tripped`);
    }
  }

  // --- rule 6: every cycle edge is bounded ---------------------------------
  // The structural guarantee that an unbounded retry cycle CANNOT EXIST in a
  // valid graph, checked in O(V+E) rather than by enumerating cycles.
  const components = tarjanSCC(normalisedNodes.map((n) => n.id), adjacency);
  const componentOf = new Map();
  for (const [i, comp] of components.entries()) for (const id of comp) componentOf.set(id, i);
  const cyclicComponents = new Set(components.filter((c) => c.length > 1).map((c) => componentOf.get(c[0])));
  for (const e of normalisedEdges) {
    if (!byId.has(e.to)) continue;
    const selfLoop = e.from === e.to;
    const inCycle = componentOf.get(e.from) === componentOf.get(e.to) && cyclicComponents.has(componentOf.get(e.from));
    if (!selfLoop && !inCycle) continue;
    if (e.maxTraversals === undefined) {
      throw bad(`edge ${e.from} -> ${e.to} closes a loop and must declare maxTraversals — an unbounded loop is the failure this layer exists to prevent`);
    }
  }

  // --- rule 9: inputs name ancestors --------------------------------------
  // `inputs` is DATA, not control: it selects which prior nodes' output gets
  // rendered into this node's prompt. Requiring an ancestor is what makes it
  // impossible to declare an input that can never have run.
  for (const node of normalisedNodes) {
    for (const src of node.inputs) {
      if (!byId.has(src)) throw bad(`node "${node.id}": inputs names "${src}", which is not a node in this graph`);
      const downstream = reachableFrom([src], adjacency);
      if (!downstream.has(node.id)) {
        throw bad(`node "${node.id}": inputs names "${src}", which is not an ancestor — its output can never exist when this node runs`);
      }
    }
  }

  // --- rule 15: the boundary deny-scan ------------------------------------
  const scanTargets = [
    ...normalisedNodes.flatMap((n) => [
      { text: n.title, label: `node "${n.id}" title` },
      { text: n.criteria, label: `node "${n.id}" criteria` }
    ]),
    { text: brief, label: 'the project brief' }
  ];
  for (const target of scanTargets) {
    const hits = scanBoundaryVerbs(target.text, { label: target.label });
    if (hits.length) {
      const h = hits[0];
      throw bad(`${h.label} instructs the pipeline to cross the autonomy boundary ("${h.match.trim()}") — ${h.why}`);
    }
  }

  const out = {
    name: name ?? graph.name ?? 'custom',
    entry,
    nodes: normalisedNodes,
    edges: normalisedEdges
  };
  return deepFreeze(out);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ---- lifting a linear pipeline ----------------------------------------------

// A linear pipeline IS a linear graph. One engine, not two: a dual path would be
// exactly the "loop wearing a graph's vocabulary" this phase exists to remove.
//
// Duplicate kinds are legal today (`--pipeline "develop,test,develop"`), and node
// ids must be unique, so the second `develop` becomes `develop-2` — which is also
// the first time such a pipeline gets two separate records instead of one
// overwriting the other.
export function pipelineToGraph(pipeline, { name = 'custom' } = {}) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    throw bad('a pipeline must be a non-empty array of task kinds');
  }
  const seen = new Map();
  const ids = pipeline.map((kind) => {
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    return n === 1 ? kind : `${kind}-${n}`;
  });
  const nodes = pipeline.map((kind, i) => ({
    id: ids[i],
    kind,
    title: kind,
    emit: 'deliverable',
    inputs: i > 0 ? [ids[i - 1]] : [],
    check: { requires_section: '## DECISIONS' },
    // Seeded FROM the set rather than listed, so a change to VERIFIED_KINDS
    // cannot silently drop a node's verification.
    verify: VERIFIED_KINDS.has(kind)
  }));
  const edges = ids.map((id, i) => ({
    from: id,
    to: i + 1 < ids.length ? ids[i + 1] : TERMINAL_DONE,
    when: 'always'
  }));
  return { name, entry: ids[0], nodes, edges };
}

// ---- hashing -----------------------------------------------------------------

// Canonical JSON: object keys sorted, array order preserved (it is meaningful).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

// Commitment 1: the locked plan is identified by content, so a hand-edited
// state.json is caught on resume rather than quietly running a different graph.
export function graphHash(graph) {
  return createHash('sha256').update(JSON.stringify(canonical(graph))).digest('hex');
}

// ---- rendering ---------------------------------------------------------------

// The CONCRETE per-visit attempt budget for one node. The source's bar is that
// "a human reading the table in advance can predict exactly what happens", and
// the shared table alone cannot deliver that: `model: {max: 1}` is right for the
// 2 kinds that carry an escalation model and wrong for the other 12. So the
// classes that cannot apply to this node are shown as 0.
export function nodeBudget(node) {
  const out = {};
  for (const [cls, rule] of Object.entries(RECOVERY)) {
    if (cls === 'model' && !node.escalatable) { out[cls] = 0; continue; }
    if (cls === 'verify' && !node.effectiveVerify) { out[cls] = 0; continue; }
    // Only a verdict node can produce an unparseable verdict.
    if (cls === 'verdict' && node.emit !== 'verdict') { out[cls] = 0; continue; }
    out[cls] = rule.max;
  }
  out.cap = MAX_NODE_ATTEMPTS;
  return out;
}

export function renderGraph(graph) {
  const lines = [
    `graph "${graph.name}" — ${graph.nodes.length} nodes, ${graph.edges.length} edges, entry: ${graph.entry}`,
    `hash: ${graphHash(graph)}`,
    ''
  ];
  const w = Math.max(4, ...graph.nodes.map((n) => n.id.length));
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(`${pad('NODE', w)}  ${pad('KIND', 12)}  ${pad('EMIT', 11)}  ATTEMPT BUDGET PER VISIT`);
  for (const node of graph.nodes) {
    const b = nodeBudget(node);
    const budget = Object.keys(RECOVERY).map((c) => `${c}x${b[c]}`).join('  ');
    lines.push(`${pad(node.id, w)}  ${pad(node.kind, 12)}  ${pad(node.emit, 11)}  ${budget}  -> cap ${b.cap}`);
  }
  lines.push('');
  lines.push('EDGES');
  for (const e of graph.edges) {
    const bound = e.maxTraversals !== undefined ? `  (<=${e.maxTraversals} traversals)` : '';
    lines.push(`  ${e.from} --${e.when}--> ${e.to}${bound}${e.reason ? `   "${e.reason}"` : ''}`);
  }
  lines.push('');
  lines.push('Exhausting any declared bound ESCALATES to the owner — there is no "carry on anyway" path.');
  lines.push('The verify class only engages when the run supplies --verify; nodes showing verifyx0 are never claim-checked.');
  return lines.join('\n');
}

export function renderGraphMermaid(graph) {
  const lines = ['flowchart TD'];
  // Hyphens are stripped too: mermaid reads "a-b --> c" ambiguously against its
  // own arrow token, so ids stay strictly alphanumeric and the label carries the
  // real id.
  const safe = (id) => `n_${id.replace(/[^a-z0-9]/gi, '_')}`;
  for (const node of graph.nodes) {
    const shape = node.emit === 'verdict' ? ['{{', '}}'] : ['[', ']'];
    lines.push(`  ${safe(node.id)}${shape[0]}"${node.id} (${node.kind})"${shape[1]}`);
  }
  for (const t of TERMINALS) {
    if (graph.edges.some((e) => e.to === t)) lines.push(`  ${safe(t)}(["${t}"])`);
  }
  for (const e of graph.edges) {
    const label = e.maxTraversals !== undefined ? `${e.when} <=${e.maxTraversals}` : e.when;
    lines.push(`  ${safe(e.from)} -->|${label}| ${safe(e.to)}`);
  }
  return lines.join('\n');
}
