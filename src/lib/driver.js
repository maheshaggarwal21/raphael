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
import { claudeBinary, detectLimit, isSuccessEnvelope } from './provider.js';
import { resolvePolicy, routeEffortWithLessons, canEscalate } from './policy.js';
import { loadIndex } from './compile.js';
import { rank } from './match.js';
import { computeConfidence } from './confidence.js';
import { AGENTS } from './agents.js';
import { readState, writeState, checkpoint, recordBoundary, recordLimit } from './academy.js';
import { scanProject, buildAtlas, renderDigest } from './atlas.js';
import { scrubSecrets } from './scrub.js';

const STAGE_TIMEOUT_MS = 600000; // a stage writes real code; give it 10 minutes

// How many times a single stage may be RESUMED after being cut off mid-run.
// Observation 2026-07-27 (F10): `develop` writes an entire codebase and hit the
// ten-minute cap twice in a row. Both times the driver recorded "failed, 0
// tokens" and gave up — while the workspace held 15 files and 49 passing tests,
// and 423,523 billable tokens had actually been spent. A cut-off stage is not a
// failed stage: the CLI keeps the session, so the right move is to continue it
// with --resume, which is machinery the driver already has and only ever used
// for crashes. Bounded, because a stage that cannot finish in three passes needs
// a human, not an infinite loop.
const MAX_STAGE_RESUMES = 3;

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
- Work ONLY inside the current directory (the project workspace). This includes
  memory/note-taking tools: do not write project facts, architectural decisions,
  or "for next time" notes to any file or tool outside this directory. That
  channel is invisible to the pipeline, is never reviewed, and cannot carry your
  reasoning forward — the DECISIONS section below is what the next stage reads.
- NEVER deploy, sign in, create accounts, spend money, publish packages, or push to any remote.
- Produce your deliverable as plain text/files and stop; the next stage picks it up.

There is NO HUMAN in this loop. Nobody will read a question you ask, and no answer
can arrive — the next stage receives your output verbatim as its input. So:
- Never end by asking for clarification, confirmation, or a preference.
- When something is genuinely ambiguous, CHOOSE the option you would defend to a
  senior engineer, state the choice, and keep going. Deciding is your job here.
- The autonomy boundary above is NOT an ambiguity to resolve. "Decide for yourself"
  never authorises a deploy, a sign-in, a purchase, or a push.
- Your deliverable is the thing itself (the spec, the design, the code), never a
  description of what you would produce given more information.`;

// The one structural contract every stage deliverable must satisfy. This is the
// F4 fix, and it is deliberately a CONTRACT rather than a question-detector:
// a clarifying question cannot satisfy "list the calls you made", so the gate
// needs no phrase lists, no question-mark heuristics and no tuned thresholds
// that decay against the next model's phrasing.
//
// It also answers the owner's actual ask — the agent decides for itself, AND the
// decisions are recorded where a human can read them later (`raph academy status`).
const DECISIONS_CONTRACT = `## Required final section

End your response with a section headed exactly "## DECISIONS" listing every
judgement call you made that a human might have made differently — each as one
"- " bullet, in the form "<what you chose> — <why>". If you genuinely made none,
write "- none". A response without this section is incomplete and will be rejected.`;

const MAX_DECISIONS = 12;
const MAX_DECISION_LEN = 300;

// Parse the "## DECISIONS" section out of a stage deliverable. Pure, total, and
// deliberately forgiving about formatting while strict about presence:
//   - the LAST matching heading wins (a spec may quote the contract earlier);
//   - bullets are "-", "*" or "1." lines until the next heading or the end;
//   - "- none" is a valid, explicit answer and yields [].
// Returns null when the section is absent — which is the failure the gate acts on.
export function parseDecisions(text) {
  const s = String(text ?? '');
  const heading = /^[ \t]{0,3}#{1,6}[ \t]*DECISIONS[ \t]*:?[ \t]*$/gim;
  let last = -1;
  for (let m = heading.exec(s); m; m = heading.exec(s)) last = m.index + m[0].length;
  if (last === -1) return null;

  const rest = s.slice(last);
  const stop = rest.search(/^[ \t]{0,3}#{1,6}[ \t]*\S/m);
  const body = stop === -1 ? rest : rest.slice(0, stop);

  const out = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (!bullet) continue;
    const item = bullet[1].trim();
    if (!item) continue;
    if (/^none\b/i.test(item) || /^n\/a\b/i.test(item)) continue; // explicit "no decisions"
    out.push(item.slice(0, MAX_DECISION_LEN));
    if (out.length >= MAX_DECISIONS) break;
  }
  return out;
}

// The deliverable gate. Loop Engineering's central rule is "no gate, no real
// loop" — and Raphael's driver had none: any non-empty text counted as success.
// That is exactly how F4 happened, where a planner's clarifying question was
// accepted as a finished spec and handed to the architect as its input.
//
// Returns { ok, decisions, why }. Kept separate from the runner so it is a pure
// function over a string, testable without spawning anything.
export function gateDeliverable(output) {
  const decisions = parseDecisions(output);
  if (decisions === null) {
    return {
      ok: false,
      decisions: [],
      why: 'no "## DECISIONS" section — the deliverable is incomplete (a question or a request for input is not a deliverable)'
    };
  }
  return { ok: true, decisions, why: null };
}

// Stages that WRITE code and are therefore expected to leave it working. The
// verifier runs after these only: `review` and `security` are advisory passes,
// and failing them for a defect they did not introduce would be wrong.
export const VERIFIED_KINDS = new Set(['develop', 'test', 'debug', 'implement', 'refactor']);

const VERIFY_TIMEOUT_MS = 300000;
const VERIFY_OUTPUT_CAP = 2000;

// The owner-supplied verifier: `raph academy drive --verify "npm test"`.
//
// Why this exists, from a real run (2026-07-27): the `test` stage reported
// "135 total tests", walked through `parseBody` in its own deliverable and
// ticked it, satisfied the DECISIONS contract, and was marked done — while
// `npm test` failed on exactly that function. The contract gate checks the
// SHAPE of a deliverable; only running the project can check its CLAIM.
//
// Deliberately owner-supplied rather than discovered: every guessed command is
// a red gate on correct work. And never parsed out of stage output — that would
// let a model choose what command the driver runs, which is the one genuinely
// new injection surface this feature could open.
export function runVerify(command, { cwd, spawn = spawnSync, timeout = VERIFY_TIMEOUT_MS } = {}) {
  if (!command || !String(command).trim()) return { ran: false, ok: true, detail: null };
  try {
    const r = spawn(command, {
      cwd,
      shell: true,          // the owner writes a command line, not an argv array
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    if (r.error) {
      return { ran: true, ok: false, detail: `the verifier could not run: ${r.error.message}` };
    }
    if (r.status === 0) return { ran: true, ok: true, detail: null };
    // A failing test can print an env var, and this lands in state.json and in
    // the next prompt — scrub before it is stored (invariant #2).
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().slice(-VERIFY_OUTPUT_CAP);
    // scrubSecrets returns { text, found } — not a bare string.
    return { ran: true, ok: false, detail: `verifier exited ${r.status}:\n${scrubSecrets(tail).text}` };
  } catch (err) {
    return { ran: true, ok: false, detail: `the verifier threw: ${err.message}` };
  }
}

// ---- state machine (pure over the state object) -----------------------------

export function initDriver(state, { brief, pipeline = DEFAULT_PIPELINE, verify = null } = {}) {
  if (!state) throw new Error('E-DRIVER: no academy state — start the project first');
  if (state.driver && state.driver.status !== 'done') return state; // idempotent mid-flight
  if (!brief || !String(brief).trim()) throw new Error('E-DRIVER: a project brief is required (--brief or --brief-file)');
  for (const kind of pipeline) resolvePolicy(kind); // E-POLICY on any unknown kind (there IS no deploy kind)
  state.driver = {
    pipeline: [...pipeline],
    stage: 0,
    brief: String(brief).trim(),
    // The owner's verification command, stored once at init. Set only from the
    // CLI flag — never from a stage's output, so a model can never choose what
    // the driver executes.
    verify: verify ? String(verify).trim() : null,
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

  // An interrupted stage keeps its session and stays RESUMABLE, up to a bound.
  // nextAction() already continues any stage left in 'running' with --resume;
  // before this, a timeout was written as 'failed', which routed around that
  // machinery and abandoned both the files and the session context (F10).
  const timeouts = (rec.timeouts ?? 0) + (result.timedOut ? 1 : 0);
  const resumable = Boolean(result.timedOut) && timeouts < MAX_STAGE_RESUMES;
  if (resumable) {
    d.stages[kind] = {
      ...rec,
      status: 'running',            // nextAction resumes this session
      session_id: result.sessionId ?? rec.session_id ?? null,
      model: result.model ?? null,
      effort: result.effort ?? null,
      timeouts,
      tokens_captured: false,       // the killed child never reported usage
      // Duration is the ONLY cost signal that survives an interruption, so it
      // must accumulate here above all — this is the branch where tokens can't.
      elapsed_ms: (rec.elapsed_ms ?? 0) + (result.elapsedMs ?? 0),
      error: result.error ?? 'interrupted',
      at: new Date().toISOString()
    };
    d.updated_at = new Date().toISOString();
    return state;
  }

  d.stages[kind] = {
    ...rec,
    timeouts,
    status: result.ok ? 'done' : 'failed',
    session_id: result.sessionId ?? rec.session_id ?? null,
    model: result.model ?? null,
    effort: result.effort ?? null,
    escalated: result.escalated === true,
    output: result.ok ? result.output : rec.output ?? null,
    error: result.ok ? null : result.error ?? 'stage reported failure',
    tokens: (rec.tokens ?? 0) + (result.tokens ?? 0),
    // Honesty markers. tokens_captured is STICKY-FALSE: once any pass of this
    // stage went unmeasured, the total is incomplete forever, so a later
    // captured pass must not overwrite the doubt. Caught live on 2026-07-27 —
    // the `test` stage was killed at 600s (nothing reported), resumed, finished,
    // and the record then claimed tokens_captured:true over a figure that was
    // only the second pass. A partial total advertising itself as complete is
    // the same lie as the 0 this field exists to prevent.
    tokens_captured: rec.tokens_captured !== false && result.tokensCaptured !== false,
    elapsed_ms: (rec.elapsed_ms ?? 0) + (result.elapsedMs ?? 0),
    // The judgement calls this stage made in place of a human (F4). Stored per
    // stage rather than written into the owner's global decision ledger: these
    // are machine assumptions pending review, not settled project decisions, and
    // promoting one is a human act after reading it.
    decisions: result.ok ? (result.decisions ?? []) : rec.decisions ?? [],
    at: new Date().toISOString()
  };

  if (result.ok) {
    d.stage += 1;
    if (d.stage >= d.pipeline.length) d.status = 'done';
  } else if (result.timedOut) {
    // Out of resumes. Do NOT escalate: escalation buys deeper reasoning, and a
    // stage that ran out of clock needs less work per pass or a bigger budget —
    // a stronger, slower model would simply time out too, at a higher price.
    d.status = 'failed';
  } else if (canEscalate(kind) && !rec.retry_escalated) {
    d.stages[kind].retry_escalated = true; // next nextAction() resolves the stronger model
    d.stages[kind].status = 'retry';       // fresh session — never resume a failed one
  } else {
    d.status = 'failed';
  }
  d.updated_at = new Date().toISOString();
  return state;
}

// Clear a failed stage so the pipeline can be driven again (F14). Before this
// there was NO supported route back: `academy status` said "NEXT: run stage:
// develop" while `drive` refused with "failed twice", and the only way forward
// was hand-editing state.json — on the pipeline's most common failure, no less.
//
// Deliberately drops the failed attempt's record rather than resuming it: a
// stage a human had to intervene on should start clean, and a fresh session is
// correct once the prior one has gone stale. Files in the workspace are never
// touched, so the work already produced is what the retry builds on.
export function retryStage(state) {
  if (!state?.driver) throw new Error('E-DRIVER: no autopilot run to retry — start one with "raph academy drive"');
  const d = state.driver;
  const kind = d.pipeline[d.stage];
  if (d.status !== 'failed') {
    return { state, kind, cleared: false, why: `stage "${kind}" is ${d.status}, not failed — nothing to retry` };
  }
  delete d.stages[kind];
  d.status = 'running';
  d.updated_at = new Date().toISOString();
  return { state, kind, cleared: true, why: null };
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
  lines.push('## Your deliverable', m.output, '', DECISIONS_CONTRACT);
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

    // Per-kind budget when the policy table carries one (only `develop` does),
    // otherwise the shared default. A stage that writes a whole codebase and one
    // that writes a checklist do not deserve the same clock.
    const budgetMs = Number.isFinite(policy?.timeoutMs) ? policy.timeoutMs : timeout;

    // Duration is the ONE cost signal that survives a killed child — the usage
    // envelope does not. Recording it is what turns the next round of timeout
    // tuning from judgement into data.
    const startedAt = Date.now();
    const r = spawn(bin, buildStageArgs({ model: policy.model, effort: policy.effort, sessionId, resume }), {
      input: prompt,
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout: budgetMs,
      maxBuffer: 20 * 1024 * 1024
    });
    const elapsedMs = Date.now() - startedAt;

    // A timeout is NOT a failure — it is an interruption with work already on
    // disk and a live session to continue. Distinguish it so applyStageResult
    // can resume instead of discarding (F10). Everything else is a real failure.
    if (r.error) {
      const timedOut = r.error.code === 'ETIMEDOUT' || /ETIMEDOUT/i.test(String(r.error.message));
      return {
        ok: false,
        timedOut,
        elapsedMs,
        // Honest about cost: the child was killed, so its usage envelope never
        // arrived. Report "not captured" rather than a 0 that reads as "free".
        tokensCaptured: false,
        error: timedOut
          ? `stage exceeded its ${Math.round(budgetMs / 60000)}-minute budget and was interrupted (work on disk is kept; token cost not captured)`
          : `spawn failed: ${r.error.message}`,
        output: null,
        tokens: 0
      };
    }

    // Parse FIRST, then judge. A stage deliverable that *recommends* rate
    // limiting is not a subscription limit — detectLimit only inspects failure
    // material, never a successful envelope's payload.
    let envMsg = null;
    try { envMsg = JSON.parse((r.stdout ?? '').trim()); } catch { /* handled below */ }

    const limit = detectLimit({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', env: envMsg });
    if (limit) {
      limit.message = limit.message.replace('Claude Code subscription limit reached', 'subscription limit hit mid-stage');
      throw limit;
    }

    const u = envMsg?.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    if (!isSuccessEnvelope(envMsg)) {
      return { ok: false, elapsedMs, tokensCaptured: true, error: `claude reported ${envMsg?.subtype || envMsg?.error || 'error'}`, output: null, tokens };
    }
    const output = typeof envMsg.result === 'string' && envMsg.result.trim() ? envMsg.result : null;
    if (!output) return { ok: false, elapsedMs, tokensCaptured: true, error: 'stage produced no text deliverable', output: null, tokens };

    // THE GATE. "Non-empty text" was never a completion test — it accepted a
    // clarifying question as a finished spec (F4). The deliverable must satisfy
    // the DECISIONS contract, which a question structurally cannot.
    const gate = gateDeliverable(output);
    if (!gate.ok) {
      return { ok: false, elapsedMs, tokensCaptured: true, gateFailed: true, error: gate.why, output, tokens };
    }
    return { ok: true, elapsedMs, tokensCaptured: true, output, tokens, decisions: gate.decisions };
  };
}

// ---- the loop ----------------------------------------------------------------

// Runs stages until done / limit / failure / boundary. Every transition is written
// to the academy state FIRST, so an interrupt at any point resumes cleanly.
// Returns { stopped: 'done'|'limit'|'failed'|'owner'|'no-driver', state }.
export async function drive(project, { runner, log = () => {}, maxStages = Infinity, workspace = null, atlasDigestFn = workspaceAtlasDigest, verifyFn = runVerify } = {}) {
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

    // 18.10's effort router, finally reachable: it shipped with tests and NO
    // production caller (audit 2026-07-26), so no stage's effort was ever routed
    // on lesson confidence. Its own contract is that it RECOMMENDS and never
    // silently downgrades, so it surfaces as a log line and the policy stands.
    try {
      const matches = lessonMatchesFor(kind, input);
      const route = routeEffortWithLessons(policy.effort, matches, { escalated: Boolean(policy.escalated) });
      if (route.downgraded) {
        log(`  note: ${route.why} — consider --effort ${route.effort} for this stage (not applied automatically)`);
      }
    } catch { /* advice is never allowed to break a stage */ }

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

    // THE SECOND GATE: run the owner's verifier over the workspace. The contract
    // gate above checks the SHAPE of the deliverable; this checks whether the
    // claim is TRUE. Observed 2026-07-27: the `test` stage reported "135 total
    // tests", satisfied the contract, and was marked done while `npm test` was
    // failing on the very function its own deliverable had ticked off.
    if (result.ok && state.driver.verify && VERIFIED_KINDS.has(kind)) {
      const v = verifyFn(state.driver.verify, { cwd: ws ?? undefined });
      if (v.ran && !v.ok) {
        log(`  ${kind}: verifier FAILED — the deliverable claimed success`);
        result = { ...result, ok: false, verifyFailed: true, error: `stage reported success but the verifier disagreed. ${v.detail}` };
      } else if (v.ran) {
        log(`  ${kind}: verifier passed`);
      }
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

// Which active lessons plausibly cover this stage, with their computed
// confidence — the input 18.10's effort router needs. Kept here (rather than
// inside policy.js) so the pure policy table stays free of brain I/O, and
// wrapped so a brain that is missing or unreadable never affects a build.
export function lessonMatchesFor(kind, input) {
  try {
    const { lessons } = loadIndex();
    if (!lessons.length) return [];
    const ctx = { text: `${kind}\n${String(input ?? '').slice(0, 2000)}`, paths: [], stacks: [], injected: new Set() };
    return rank(lessons, ctx, 4.0)
      .slice(0, 5)
      .map((r) => ({
        slug: r.entry.slug,
        id: r.entry.id,
        score: r.score,
        confidence: computeConfidence(r.entry)
      }));
  } catch {
    return [];
  }
}
