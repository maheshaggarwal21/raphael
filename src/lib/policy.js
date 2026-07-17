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
    why: 'renames, formatting, boilerplate — zero-reasoning work' },
  { kind: 'summarize',   agent: null,        model: 'haiku',  effort: 'medium',
    why: 'compressing text is cheap-model territory' },
  { kind: 'plan',        agent: 'planner',   model: 'sonnet', effort: 'high',
    why: 'a wrong spec is the most expensive bug — spend reasoning here' },
  { kind: 'architect',   agent: 'architect', model: 'sonnet', effort: 'high',
    why: 'design decisions compound; effort up front is cheapest' },
  { kind: 'develop',     agent: 'developer', model: 'sonnet', effort: 'medium',
    why: 'the bulk tier: real code in small verified diffs' },
  { kind: 'test',        agent: null,        model: 'sonnet', effort: 'medium',
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
    why: 'extraction rides the subscription default; containment, not tier, is the guarantee' }
];

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

  return { kind, agent: entry.agent, model, effort, escalated, why: entry.why };
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
