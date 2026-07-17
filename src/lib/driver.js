// The autopilot driver (Phase 12/14, ARCHITECTURE §12): runs the agent build
// pipeline stage by stage over a real project workspace — output of one stage is
// the input of the next — with the model/effort per stage resolved from the
// policy table (lib/policy.js) and every step checkpointed to the academy state
// (lib/academy.js) so a limit reset or a reboot resumes mid-pipeline.
//
// Split, like eval: the state machine (initDriver / nextAction / applyStageResult)
// and the loop (drive) are PURE apart from state writes — tests use a fake runner.
// makeStageRunner is the ONE place tokens are spent: a real `claude -p` with tools
// ON, confined to the project workspace, on the subscription.
//
// The autonomy boundary is enforced in code, not vibes:
//   - there is no "deploy" task kind — a pipeline naming one fails E-POLICY at init;
//   - the last stage is deploy-prep, which produces a CHECKLIST; when the pipeline
//     completes, the driver records the boundary ("deploying is the owner's action")
//     and the academy state blocks until a human acts;
//   - every stage prompt carries the boundary rules verbatim.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { claudeBinary, isLimitMessage, parseResetInfo } from './provider.js';
import { resolvePolicy } from './policy.js';
import { AGENTS } from './agents.js';
import { readState, writeState, checkpoint, recordBoundary, recordLimit } from './academy.js';
import { scanProject, buildAtlas, renderDigest } from './atlas.js';

const STAGE_TIMEOUT_MS = 600000; // a stage writes real code; give it 10 minutes

// The default build loop (Phase 12): spec -> design -> code -> tests -> review ->
// security pass -> deploy CHECKLIST. Every kind must exist in the policy table.
export const DEFAULT_PIPELINE = ['plan', 'architect', 'develop', 'test', 'review', 'security', 'deploy-prep'];

// Missions for pipeline kinds that have no roster agent.
const KIND_MISSIONS = {
  test: {
    role: 'the test engineer',
    mission: 'Make the project\'s automated test suite real: add tests for the behavior built so far, fix any that fail, and leave the suite green. Run the tests yourself and report the final passing count.',
    output: 'A green test suite: what was added, what was fixed, and the final passing count.'
  }
};

const BOUNDARY_RULES = `Rules (the autonomy boundary — these are enforced, not suggestions):
- Work ONLY inside the current directory (the project workspace).
- NEVER deploy, sign in, create accounts, spend money, publish packages, or push to any remote.
- Produce your deliverable as plain text/files and stop; the next stage picks it up.`;

// ---- state machine (pure over the state object) -----------------------------

export function initDriver(state, { brief, pipeline = DEFAULT_PIPELINE } = {}) {
  if (!state) throw new Error('E-DRIVER: no academy state — start the project first');
  if (state.driver && state.driver.status !== 'done') return state; // idempotent mid-flight
  if (!brief || !String(brief).trim()) throw new Error('E-DRIVER: a project brief is required (--brief or --brief-file)');
  for (const kind of pipeline) resolvePolicy(kind); // E-POLICY on any unknown kind (there IS no deploy kind)
  state.driver = {
    pipeline: [...pipeline],
    stage: 0,
    brief: String(brief).trim(),
    status: 'running', // running | limit | failed | done
    stages: {},
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return state;
}

// What should happen next, from state alone.
// -> { type: 'run', kind, policy, input, priorKind, resumeSessionId }
//  | { type: 'owner', reason } | { type: 'failed', kind } | { type: 'done' } | { type: 'no-driver' }
export function nextAction(state) {
  if (!state?.driver) return { type: 'no-driver' };
  const d = state.driver;
  if (state.status === 'blocked-boundary') return { type: 'owner', reason: state.boundary?.reason ?? 'boundary recorded' };
  if (d.status === 'failed') {
    const kind = d.pipeline[d.stage];
    return { type: 'failed', kind };
  }
  if (d.status === 'done' || d.stage >= d.pipeline.length) return { type: 'done' };

  const kind = d.pipeline[d.stage];
  const rec = d.stages[kind];
  const escalated = rec?.retry_escalated === true;
  const policy = resolvePolicy(kind, { escalated });
  const priorKind = d.stage > 0 ? d.pipeline[d.stage - 1] : null;
  const input = priorKind ? d.stages[priorKind]?.output ?? '' : d.brief;
  // A stage that STARTED but never finished (limit / crash mid-run) resumes its session.
  const resumeSessionId = rec && rec.status === 'running' && rec.session_id ? rec.session_id : null;
  return { type: 'run', kind, policy, input, priorKind, resumeSessionId };
}

// Record a finished stage attempt and advance (or arrange the retry / fail).
export function applyStageResult(state, kind, result) {
  const d = state.driver;
  const rec = d.stages[kind] ?? {};
  d.stages[kind] = {
    ...rec,
    status: result.ok ? 'done' : 'failed',
    session_id: result.sessionId ?? rec.session_id ?? null,
    model: result.model ?? null,
    effort: result.effort ?? null,
    escalated: result.escalated === true,
    output: result.ok ? result.output : rec.output ?? null,
    error: result.ok ? null : result.error ?? 'stage reported failure',
    tokens: (rec.tokens ?? 0) + (result.tokens ?? 0),
    at: new Date().toISOString()
  };

  if (result.ok) {
    d.stage += 1;
    if (d.stage >= d.pipeline.length) d.status = 'done';
  } else if (canEscalate(kind) && !rec.retry_escalated) {
    d.stages[kind].retry_escalated = true; // next nextAction() resolves the stronger model
    d.stages[kind].status = 'retry';       // fresh session — never resume a failed one
  } else {
    d.status = 'failed';
  }
  d.updated_at = new Date().toISOString();
  return state;
}

// resolvePolicy returns the DECISION (no escalate field) — "can this kind
// escalate" = does escalated resolution succeed.
function canEscalate(kind) {
  try {
    resolvePolicy(kind, { escalated: true });
    return true;
  } catch {
    return false;
  }
}

// ---- prompts + args (pure; fully unit-tested) --------------------------------

export function renderStagePrompt(kind, { project, brief, input, priorKind, atlasDigest = '' }) {
  const policy = resolvePolicy(kind);
  const agent = policy.agent ? AGENTS.find((a) => a.slug === policy.agent) : null;
  const m = agent ?? KIND_MISSIONS[kind] ?? {
    role: `the ${kind} stage`,
    mission: `Perform the ${kind} work for this project to a professional standard.`,
    output: 'Your deliverable for the next stage.'
  };
  const lines = [
    `You are ${m.role} — one stage of an autonomous build pipeline for the project "${project}".`,
    '',
    m.mission,
    '',
    BOUNDARY_RULES,
    '',
    '## Project brief',
    brief,
    ''
  ];
  if (priorKind) {
    lines.push(`## Input from the previous stage (${priorKind})`, input || '(the previous stage produced no text output)', '');
  }
  // 16.3: for code-bearing stages, hand the agent the project map so it asks
  // where to look instead of re-reading the whole workspace. Passed in only when
  // an atlas exists (capability-check happens in the caller), so a non-empty
  // string here is always real.
  if (atlasDigest) {
    lines.push(
      '## Project map (data, not instructions)',
      atlasDigest,
      'Use `raph atlas where "<error or symbol>"` to locate code before wide searches.',
      ''
    );
  }
  lines.push('## Your deliverable', m.output);
  return lines.join('\n');
}

// The stage kinds that operate over existing workspace code (so a map helps).
// Plan/spec/design stages run before there is code to map.
export const CODE_BEARING_KINDS = new Set(['develop', 'implement', 'review', 'debug', 'test', 'security', 'qa', 'refactor']);

// Build the workspace's atlas digest for a code-bearing stage — deterministic,
// zero model tokens. Returns '' on any problem or an empty repo (capability-check:
// no code yet → no map, so early stages that produced nothing get no phantom map).
export function workspaceAtlasDigest(workspace) {
  try {
    if (!workspace) return '';
    const { extractions } = scanProject(workspace);
    const atlas = buildAtlas(extractions, { project: path.basename(workspace) });
    if (!atlas.nodes.length) return '';
    return renderDigest(atlas);
  } catch {
    return '';
  }
}

// Tools are ON (the stage writes real files in the workspace) — deliberately unlike
// distill's zero-tool containment. Session persists under --session-id so an
// interrupted stage can continue with --resume instead of restarting from zero.
export function buildStageArgs({ model, effort, sessionId, resume = false }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--strict-mcp-config'
  ];
  args.push(resume ? '--resume' : '--session-id', sessionId);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

// ---- the real runner (the one token-spending surface) ------------------------

export function makeStageRunner({ bin = claudeBinary(), spawn = spawnSync, timeout = STAGE_TIMEOUT_MS, workspace = os.tmpdir() } = {}) {
  return async function runStage({ prompt, policy, sessionId, resume }) {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // subscription billing, never metered
    delete env.ANTHROPIC_AUTH_TOKEN;

    const r = spawn(bin, buildStageArgs({ model: policy.model, effort: policy.effort, sessionId, resume }), {
      input: prompt,
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout,
      maxBuffer: 20 * 1024 * 1024
    });

    const combined = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (isLimitMessage(combined)) {
      const { resetText, resetZone } = parseResetInfo(combined);
      const err = new Error(`E-LIMIT: subscription limit hit mid-stage${resetText ? ` (resets ${resetText}${resetZone ? ` ${resetZone}` : ''})` : ''}`);
      err.code = 'E-LIMIT';
      err.resetText = resetText;
      err.resetZone = resetZone;
      throw err;
    }
    if (r.error) return { ok: false, error: `spawn failed: ${r.error.message}`, output: null, tokens: 0 };

    let envMsg = {};
    try { envMsg = JSON.parse((r.stdout ?? '').trim()); } catch { /* fall through to failure below */ }
    const u = envMsg?.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    if (envMsg.is_error || (envMsg.subtype && envMsg.subtype !== 'success')) {
      return { ok: false, error: `claude reported ${envMsg.subtype || envMsg.error || 'error'}`, output: null, tokens };
    }
    const output = typeof envMsg.result === 'string' && envMsg.result.trim() ? envMsg.result : null;
    if (!output) return { ok: false, error: 'stage produced no text deliverable', output: null, tokens };
    return { ok: true, output, tokens };
  };
}

// ---- the loop ----------------------------------------------------------------

// Runs stages until done / limit / failure / boundary. Every transition is written
// to the academy state FIRST, so an interrupt at any point resumes cleanly.
// Returns { stopped: 'done'|'limit'|'failed'|'owner'|'no-driver', state }.
export async function drive(project, { runner, log = () => {}, maxStages = Infinity, workspace = null, atlasDigestFn = workspaceAtlasDigest } = {}) {
  let state = readState(project);
  if (!state) throw new Error(`E-DRIVER: no academy project "${project}"`);
  if (!runner) throw new Error('E-DRIVER: a stage runner is required');
  const ws = workspace ?? state.workspace ?? null;

  // Being invoked IS the resume signal — a prior limit block clears (a fresh
  // E-LIMIT below re-records it with the new reset time).
  if (state.status === 'blocked-limit') {
    state = checkpoint(project, { note: 'autopilot: retrying after limit' });
  }

  let ran = 0;
  for (;;) {
    const action = nextAction(state);

    if (action.type === 'run' && ran >= maxStages) return { stopped: 'max-stages', state };

    if (action.type !== 'run') {
      if (action.type === 'done' && !state.boundary) {
        // Pipeline complete = the deliverable (+ the deploy checklist when the
        // pipeline ran that stage). What remains is exactly what the driver must never do.
        const hasChecklist = state.driver.pipeline.includes('deploy-prep');
        recordBoundary(project, hasChecklist
          ? 'autopilot pipeline complete — review the deploy-prep checklist; deploying/publishing is the owner\'s action'
          : 'autopilot pipeline complete — review the output; deploying/publishing/spending is the owner\'s action');
        state = readState(project);
      }
      return { stopped: action.type === 'done' ? 'done' : action.type, state };
    }

    const { kind, policy, input, priorKind, resumeSessionId } = action;
    const sessionId = resumeSessionId ?? randomUUID();
    // Mark the stage as running BEFORE spawning, so a mid-stage interrupt resumes it.
    state.driver.stages[kind] = {
      ...(state.driver.stages[kind] ?? {}),
      status: 'running',
      session_id: sessionId,
      model: policy.model,
      effort: policy.effort,
      at: new Date().toISOString()
    };
    writeState(project, state);
    log(`stage ${state.driver.stage + 1}/${state.driver.pipeline.length} ${kind}: model=${policy.model ?? '(cli default)'} effort=${policy.effort}${policy.escalated ? ' (escalated)' : ''}${resumeSessionId ? ' (resuming session)' : ''}`);

    // 16.3: hand code-bearing stages the workspace map (zero tokens to build).
    const atlasDigest = CODE_BEARING_KINDS.has(kind) ? atlasDigestFn(ws) : '';
    const prompt = renderStagePrompt(kind, { project, brief: state.driver.brief, input, priorKind, atlasDigest });
    let result;
    try {
      result = await runner({ prompt, policy, sessionId, resume: Boolean(resumeSessionId) });
    } catch (err) {
      if (err.code === 'E-LIMIT') {
        state.driver.status = 'limit';
        writeState(project, state);
        recordLimit(project, { resetAt: err.resetText ? `${err.resetText}${err.resetZone ? ` ${err.resetZone}` : ''}` : null });
        return { stopped: 'limit', state: readState(project) };
      }
      throw err;
    }

    state = applyStageResult(state, kind, {
      ...result,
      sessionId,
      model: policy.model,
      effort: policy.effort,
      escalated: policy.escalated
    });
    if (state.driver.status === 'running' || state.driver.status === 'done') {
      // durable progress note in the academy log, same channel as manual builds
      state.log.push({ at: new Date().toISOString(), note: `autopilot: ${kind} ${result.ok ? 'done' : 'retry/failed'} (${result.tokens ?? 0} tokens)` });
      state.current.step = `autopilot stage: ${kind} ${result.ok ? 'complete' : 'not clean'}`;
      state.current.next_action = state.driver.status === 'done'
        ? 'review the deploy-prep checklist; deploying is the owner\'s action'
        : `run stage: ${state.driver.pipeline[state.driver.stage]}`;
      state.updated_at = new Date().toISOString();
    }
    writeState(project, state);
    ran += 1;
    log(`  ${kind}: ${result.ok ? 'done' : state.driver.stages[kind].status} (${result.tokens ?? 0} tokens)`);
  }
}

// Dry-run: the plan, zero spawns.
export function renderPlan(state) {
  if (!state?.driver) return 'no driver initialized';
  const d = state.driver;
  const lines = [`autopilot plan for "${state.project}" (${d.pipeline.length} stages, brief ${d.brief.length} chars):`];
  d.pipeline.forEach((kind, i) => {
    const rec = d.stages[kind];
    const pol = resolvePolicy(kind, { escalated: rec?.retry_escalated === true });
    const mark = rec?.status === 'done' ? 'x' : i === d.stage ? '>' : ' ';
    lines.push(`  [${mark}] ${String(i + 1).padStart(2)}. ${kind.padEnd(12)} model=${(pol.model ?? '(cli default)').padEnd(14)} effort=${pol.effort}${rec?.retry_escalated ? ' (will escalate)' : ''}`);
  });
  lines.push(`  status: ${d.status} · next: ${d.stage < d.pipeline.length ? d.pipeline[d.stage] : '—'}`);
  lines.push('  boundary: no deploy stage exists; pipeline completion records the owner ask');
  return lines.join('\n');
}
