// Model policy table (Phase 12/14). ONE place that answers "which model, at which
// effort, runs this kind of task" — the autopilot driver, the academy build loop,
// and any future spawn site consult this instead of hard-coding model names.
//
// Principles (mirrors the SPINE's "cheap → strong"):
//   - Haiku for mechanical/routing work where reasoning adds nothing.
//   - Sonnet for real development work — the default tier.
//   - Opus only by ESCALATION for the genuinely hard cases (a stuck root-cause
//     hunt), never as a first pass; the escalate field names the stronger model
//     and resolvePolicy({ escalated: true }) switches to it.
//
// The table is data, not behavior: resolving a policy never spawns anything.
// Alignment with the agent roster (src/lib/agents.js) is enforced by test — an
// entry that names an agent must prescribe the same model the roster ships,
// unless the roster says 'inherit' (then the policy is the concrete answer).

import { AGENTS } from './agents.js';

// Aliases the Claude Code CLI accepts for --model (verified on v2.1.168).
export const MODELS = ['haiku', 'sonnet', 'opus'];
// Values the CLI accepts for --effort.
export const EFFORTS = ['low', 'medium', 'high'];

// kind      — what the driver asks for (stage names of the build pipeline plus
//             the cross-cutting task shapes).
// agent     — roster slug this kind maps to, or null for non-agent work.
// model     — first-pass model. null = let the CLI use its configured default
//             (distill deliberately rides the subscription's default model).
// effort    — reasoning effort for the pass.
// escalate  — model to switch to when the first pass failed and the caller
//             retries with { escalated: true }. Absent = never escalate.
export const POLICY = [
  { kind: 'route',       agent: 'manager',   model: 'haiku',  effort: 'low',
    why: 'routing slices to specialists needs speed, not depth' },
  { kind: 'mechanical',  agent: null,        model: 'haiku',  effort: 'low',
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    why: 'renames, formatting, boilerplate — zero-reasoning work' },
  { kind: 'summarize',   agent: null,        model: 'haiku',  effort: 'medium',
    tools: ['Read', 'Grep', 'Glob'],
    why: 'compressing text is cheap-model territory' },
  { kind: 'plan',        agent: 'planner',   model: 'sonnet', effort: 'high',
    why: 'a wrong spec is the most expensive bug — spend reasoning here' },
  { kind: 'architect',   agent: 'architect', model: 'sonnet', effort: 'high',
    why: 'design decisions compound; effort up front is cheapest' },
  // timeoutMs: 25 minutes, not the default 10. Measured, not guessed — `develop`
  // was cut off TWICE at ten minutes on a real build, the second pass having
  // produced 341,647 billable tokens, 99,373 of them output, across 15 files and
  // 49 passing tests. This is the one kind where the default is provably wrong,
  // so it is the one kind that carries an override.
  { kind: 'develop',     agent: 'developer', model: 'sonnet', effort: 'medium', escalate: 'opus', timeoutMs: 1500000,
    why: 'the bulk tier: real code in small verified diffs; a genuinely stuck implementation escalates' },
  // 23.2 — the governed path could not run the Frontend agent AT ALL until this
  // entry existed: `--pipeline` validates against POLICY membership, and the
  // roster's frontend slug had no kind. So the autopilot built every UI with the
  // general `developer` agent, and the design-reviews-frontend loop the owner
  // asked for had no builder to review. Effort is high because generic
  // "AI slop" UI is the default failure mode, and the reasoning is what buys
  // distinctiveness; no escalate, because a stronger model is not what fixes
  // taste. `redteam` is deliberately NOT given a kind — see DRIVER_FORBIDDEN.
  { kind: 'frontend',    agent: 'frontend',  model: 'sonnet', effort: 'high',
    why: 'UI is where a generic default is worst; spend the reasoning on being distinctive' },
  { kind: 'test',        agent: null,        model: 'sonnet', effort: 'medium',
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    why: 'writing tests is development work at development tier' },
  { kind: 'review',      agent: 'reviewer',  model: 'sonnet', effort: 'high',
    why: 'catching a real defect pays for the extra reasoning' },
  { kind: 'security',    agent: 'security',  model: 'sonnet', effort: 'high',
    why: 'misses here are breaches; findings stay advisory to a human' },
  { kind: 'debug',       agent: 'debugger',  model: 'sonnet', effort: 'high', escalate: 'opus',
    why: 'root-cause first at dev tier; a stuck hunt escalates to the top model' },
  { kind: 'design',      agent: 'design',    model: 'sonnet', effort: 'medium',
    why: 'UI/UX consistency review against stored decisions' },
  { kind: 'deploy-prep', agent: 'deployer',  model: 'sonnet', effort: 'high',
    why: 'checklists guard irreversible steps; never performs the deploy' },
  { kind: 'critique',    agent: 'critique',  model: 'sonnet', effort: 'medium',
    why: 'adversarial pass over one output, not the codebase' },
  { kind: 'distill',     agent: null,        model: null,     effort: 'medium',
    tools: [],
    why: 'extraction rides the subscription default; containment, not tier, is the guarantee' }
];

// Stages that WRITE code and are therefore expected to leave it working. The
// owner's --verify runs after these only: `review` and `security` are advisory
// passes, and failing them for a defect they did not introduce would be wrong.
//
// 23.2 pruned `implement` and `refactor` from this set: they were never POLICY
// kinds, so they could never appear in a run — three dead entries across the two
// sets, quietly implying coverage that did not exist. A test asserts every member
// of both sets resolves, so they cannot drift apart again.
export const VERIFIED_KINDS = new Set(['develop', 'frontend', 'test', 'debug']);

// The stage kinds that operate over existing workspace code, so the deterministic
// project map (atlas) helps them. Plan/spec stages run before there is code to map.
export const CODE_BEARING_KINDS = new Set(['develop', 'frontend', 'review', 'debug', 'test', 'security']);

export function policyKinds() {
  return POLICY.map((p) => p.kind);
}

// Resolve one task kind to { kind, model, effort, escalated, why }.
//   escalated: true  — use the entry's escalate model (E-POLICY if it has none;
//                      a caller escalating a kind with no escape hatch is a bug).
//   overrides        — { model, effort } to pin either field (validated).
export function resolvePolicy(kind, { escalated = false, overrides = {} } = {}) {
  const entry = POLICY.find((p) => p.kind === kind);
  if (!entry) {
    throw new Error(`E-POLICY: unknown task kind "${kind}" — one of: ${policyKinds().join(', ')}`);
  }

  let model = entry.model;
  if (escalated) {
    if (!entry.escalate) throw new Error(`E-POLICY: task kind "${kind}" has no escalation model`);
    model = entry.escalate;
  }

  if (overrides.model !== undefined) {
    if (!MODELS.includes(overrides.model)) {
      throw new Error(`E-POLICY: override model "${overrides.model}" — one of: ${MODELS.join(', ')}`);
    }
    model = overrides.model;
  }

  let effort = entry.effort;
  if (overrides.effort !== undefined) {
    if (!EFFORTS.includes(overrides.effort)) {
      throw new Error(`E-POLICY: override effort "${overrides.effort}" — one of: ${EFFORTS.join(', ')}`);
    }
    effort = overrides.effort;
  }

  // timeoutMs is OPTIONAL and deliberately sparse: undefined means "use the
  // driver's default". Only populated where a real run proved the default wrong,
  // because eight invented numbers dressed up as a policy table is worse than
  // one honest default.
  return { kind, agent: entry.agent, model, effort, escalated, tools: toolsFor(entry), why: entry.why, timeoutMs: entry.timeoutMs };
}

// Which tools a stage of this kind may use — the ROSTER's answer whenever the
// kind maps to an agent, so the two cannot drift and a driver stage can never
// exceed the tool set its agent was reviewed with.
//
// This closes a real hole (verified 2026-07-28): buildStageArgs emitted
// `--permission-mode acceptEdits` and NO --tools, so `design`, `critique` and
// `planner` — read-only in the roster — were handed Edit/Write/Bash inside the
// driver. A design agent that can silently fix the code it is reviewing makes a
// design-reviews-frontend loop meaningless.
//
// An empty list is meaningful, not missing: it maps to `--tools ""` (every
// built-in tool off), which is the safe direction. Defaulting to "no --tools
// flag" would silently grant everything — exactly the bug being fixed.
export function toolsFor(entry) {
  if (entry.agent) {
    const a = AGENTS.find((x) => x.slug === entry.agent);
    // Loud, not silent: a policy entry naming a missing agent would otherwise
    // resolve to zero tools and the stage would fail in a confusing way.
    if (!a) throw new Error(`E-POLICY: task kind "${entry.kind}" names agent "${entry.agent}", which is not in the roster`);
    return [...a.tools];
  }
  return [...(entry.tools ?? [])];
}

// Does this kind have an escalation model at all? resolvePolicy returns the
// DECISION (it carries no escalate field), so "can this escalate" is exactly
// "does escalated resolution succeed". Only `develop` and `debug` do — 2 of 14 —
// which is why the graph layer resolves it PER NODE at validate time instead of
// discovering it at failure time.
export function canEscalate(kind) {
  try {
    resolvePolicy(kind, { escalated: true });
    return true;
  } catch {
    return false;
  }
}

// Resolve by roster slug — what a driver holding an agent name calls.
export function resolveForAgent(slug, opts = {}) {
  const entry = POLICY.find((p) => p.agent === slug);
  if (!entry) {
    const known = POLICY.filter((p) => p.agent).map((p) => p.agent);
    throw new Error(`E-POLICY: no policy for agent "${slug}" — agents with a policy: ${known.join(', ')}`);
  }
  return resolvePolicy(entry.kind, opts);
}

// The printable table for `raph policy` and the console.
export function renderPolicy() {
  const rows = POLICY.map((p) => ({
    kind: p.kind,
    agent: p.agent ?? '—',
    model: p.model ?? '(cli default)',
    effort: p.effort,
    escalate: p.escalate ?? '—',
    why: p.why
  }));
  const w = {
    kind: Math.max(4, ...rows.map((r) => r.kind.length)),
    agent: Math.max(5, ...rows.map((r) => r.agent.length)),
    model: Math.max(5, ...rows.map((r) => r.model.length)),
    effort: Math.max(6, ...rows.map((r) => r.effort.length)),
    escalate: Math.max(8, ...rows.map((r) => r.escalate.length))
  };
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [
    'MODEL POLICY — which model + effort runs each task kind (cheap → strong; opus only by escalation)',
    '',
    `${pad('KIND', w.kind)}  ${pad('AGENT', w.agent)}  ${pad('MODEL', w.model)}  ${pad('EFFORT', w.effort)}  ${pad('ESCALATE', w.escalate)}  WHY`
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.kind, w.kind)}  ${pad(r.agent, w.agent)}  ${pad(r.model, w.model)}  ${pad(r.effort, w.effort)}  ${pad(r.escalate, w.escalate)}  ${r.why}`
    );
  }
  lines.push('');
  lines.push('resolve one kind: raph policy <kind> [--escalated] · agents inherit their roster model (verified by test)');
  return lines.join('\n');
}

// Used by the alignment test and doctor-style checks: every policy entry that
// names an agent must agree with the roster, unless the roster defers.
export function checkRosterAlignment() {
  const mismatches = [];
  for (const p of POLICY) {
    if (!p.agent) continue;
    const a = AGENTS.find((x) => x.slug === p.agent);
    if (!a) { mismatches.push(`policy "${p.kind}" names unknown agent "${p.agent}"`); continue; }
    if (a.model !== 'inherit' && a.model !== p.model) {
      mismatches.push(`policy "${p.kind}" says ${p.model} but roster agent "${p.agent}" ships ${a.model}`);
    }
  }
  return mismatches;
}

// 18.10 — effort routing on lesson-match confidence.
//
// The idea, stated honestly: when a high-confidence lesson ALREADY answers the
// step about to run, the model has less to work out for itself, so that step is a
// good candidate for a cheaper pass. This returns a RECOMMENDATION plus the reason
// — it never silently downgrades anything, because a wrong downgrade is a quality
// regression the user did not ask for.
//
// Deliberately conservative: it only fires on a strong, well-evidenced match, and
// it never touches escalation (a step that already escalated is not a candidate).
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ROUTE_MIN_CONFIDENCE = 7;   // out of 10 — a well-evidenced lesson
export const ROUTE_MIN_SCORE = 6.0;      // rank() score — a real trigger hit, not an any-stack drift

export function routeEffortWithLessons(base, matches = [], { escalated = false } = {}) {
  const current = EFFORT_ORDER.includes(base) ? base : 'medium';
  const unchanged = { effort: current, downgraded: false, why: null };
  if (escalated) return { ...unchanged, why: 'already escalated — not a downgrade candidate' };

  const strong = (matches ?? []).find(
    (m) => (m.confidence ?? 0) >= ROUTE_MIN_CONFIDENCE && (m.score ?? 0) >= ROUTE_MIN_SCORE
  );
  if (!strong) return unchanged;

  const idx = EFFORT_ORDER.indexOf(current);
  if (idx <= 0) return { ...unchanged, why: 'already at the cheapest effort' };

  const effort = EFFORT_ORDER[idx - 1];
  return {
    effort,
    downgraded: true,
    from: current,
    lesson: strong.slug ?? strong.id ?? null,
    why: `a confidence-${strong.confidence} lesson already covers this step, so ${current} -> ${effort} is unlikely to cost quality`
  };
}
