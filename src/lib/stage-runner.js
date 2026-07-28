// THE EXECUTION LAYER — the one place a graph run spends tokens.
//
// Extracted from driver.js in 23.4 so that commitment 2 ("separated layers") is
// a fact about the module graph rather than a claim in a comment: this file MUST
// NOT import recovery.js or graph.js, and a test asserts it. A runner that could
// see the RECOVERY table could route, and routing is not its job.
//
// Its contract is RAW FACTS ONLY. It reports what it observed — did the child
// spawn, did it time out, did the deliverable satisfy its declared shape, how
// long did it take, what did it cost. It never names a failure class, never
// names a node, and never says what should happen next. classifyFailure() in
// recovery.js is the only thing that turns these observations into a decision.
//
// Tools are ON here (a stage writes real files in the workspace), deliberately
// unlike distill's zero-tool containment — but the GRANT is explicit and comes
// from the roster via policy.tools. See buildStageArgs.

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { claudeBinary, detectLimit, isSuccessEnvelope } from './provider.js';

export const STAGE_TIMEOUT_MS = 600000; // a stage writes real code; give it 10 minutes

// The complete set of keys a stage result may carry. Asserted by SET EQUALITY in
// the separation test — a subset check would let a routing key be added later
// without anything failing. `failureClass`, `next` and `action` are absent by
// design, and no key names a node.
export const RESULT_KEYS = Object.freeze([
  'ok', 'spawned', 'timedOut', 'gateFailed', 'verdictFailed', 'verifyFailed',
  'elapsedMs', 'tokens', 'tokensCaptured', 'output', 'error', 'decisions', 'verdict', 'sessionId'
]);

function result(fields) {
  const out = {
    ok: false,
    spawned: true,
    timedOut: false,
    gateFailed: false,
    verdictFailed: false,
    verifyFailed: false,
    elapsedMs: 0,
    tokens: 0,
    tokensCaptured: true,
    output: null,
    error: null,
    decisions: [],
    verdict: null,
    sessionId: null,
    ...fields
  };
  // Every result carries exactly the declared keys, always — so the separation
  // test is checking a real invariant rather than whichever branch it happened
  // to exercise.
  return Object.fromEntries(RESULT_KEYS.map((k) => [k, out[k]]));
}

// Session persists under --session-id so an interrupted stage can continue with
// --resume instead of restarting from zero.
//
// The tool grant (23.2) is EXPLICIT and fails closed: omitting --tools grants
// every built-in tool, which is what made read-only roster agents into writers
// inside the driver. `--tools <list>` was live-verified against the real CLI.
export function buildStageArgs({ model, effort, tools, sessionId, resume = false }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--strict-mcp-config'
  ];
  if (!Array.isArray(tools)) {
    throw new Error('E-DRIVER: buildStageArgs needs an explicit tools list — omitting it would grant every built-in tool');
  }
  args.push('--tools', tools.join(','));
  args.push(resume ? '--resume' : '--session-id', sessionId);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

// gate       — the declared pass predicate for this node, injected by the caller
//              (the runner does not know what a node is, only how to check text).
// parseVerdict — likewise: injected so this module needs no graph vocabulary.
export function makeStageRunner({
  bin = claudeBinary(),
  spawn = spawnSync,
  timeout = STAGE_TIMEOUT_MS,
  workspace = os.tmpdir()
} = {}) {
  return async function runStage({ prompt, policy, sessionId, resume, gate, wantsVerdict = false, parseVerdict = null }) {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // subscription billing, never metered
    delete env.ANTHROPIC_AUTH_TOKEN;

    // Per-kind budget when the policy table carries one (only `develop` does),
    // otherwise the shared default. A stage that writes a whole codebase and one
    // that writes a checklist do not deserve the same clock.
    const budgetMs = Number.isFinite(policy?.timeoutMs) ? policy.timeoutMs : timeout;

    // Duration is the ONE cost signal that survives a killed child — the usage
    // envelope does not.
    const startedAt = Date.now();
    const r = spawn(bin, buildStageArgs({ model: policy.model, effort: policy.effort, tools: policy.tools, sessionId, resume }), {
      input: prompt,
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout: budgetMs,
      maxBuffer: 20 * 1024 * 1024
    });
    const elapsedMs = Date.now() - startedAt;

    if (r.error) {
      const timedOut = r.error.code === 'ETIMEDOUT' || /ETIMEDOUT/i.test(String(r.error.message));
      return result({
        // A timeout is an INTERRUPTION with work on disk and a live session; a
        // spawn failure is environmental. Both are raw observations — naming
        // them 'timeout' and 'infra' is the recovery layer's job.
        spawned: !timedOut ? false : true,
        timedOut,
        elapsedMs,
        // Honest about cost: the child was killed, so its usage envelope never
        // arrived. Report "not captured" rather than a 0 that reads as "free".
        tokensCaptured: false,
        error: timedOut
          ? `stage exceeded its ${Math.round(budgetMs / 60000)}-minute budget and was interrupted (work on disk is kept; token cost not captured)`
          : `spawn failed: ${r.error.message}`,
        sessionId
      });
    }

    // Parse FIRST, then judge. A deliverable that *recommends* rate limiting is
    // not a subscription limit — detectLimit only inspects failure material.
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
      // No usable envelope came back: environmental, not the model reasoning badly.
      return result({ spawned: Boolean(envMsg), elapsedMs, error: `claude reported ${envMsg?.subtype || envMsg?.error || 'error'}`, tokens, sessionId });
    }
    const output = typeof envMsg.result === 'string' && envMsg.result.trim() ? envMsg.result : null;
    if (!output) return result({ elapsedMs, error: 'stage produced no text deliverable', tokens, sessionId });

    // THE SHAPE GATE. "Non-empty text" was never a completion test — it accepted
    // a clarifying question as a finished spec (F4). The predicate itself is
    // DECLARED by the node and injected here, so the runner holds no opinion
    // about what passing means.
    const verdictOfText = wantsVerdict && parseVerdict ? parseVerdict(output) : null;
    // REQUIRED, not defaulted. A caller that forgets the gate must not get a
    // runner that accepts any non-empty text — that IS the F4 defect (a
    // planner's clarifying question accepted as a finished spec), and a
    // permissive default would let it back in silently.
    if (typeof gate !== 'function') {
      throw new Error('E-DRIVER: a stage runner needs the node\'s declared gate — without one, any non-empty text would pass');
    }
    const checked = gate(output);
    if (!checked.ok) {
      return result({ elapsedMs, gateFailed: true, error: checked.why, output, tokens, sessionId, verdict: verdictOfText });
    }
    // A verdict node that produced no parseable verdict FAILS CLOSED. An
    // unparseable verdict is never an implicit approval — precedent: adopt.js
    // treats a malformed reviewer verdict as a block.
    if (wantsVerdict && verdictOfText === null) {
      return result({
        elapsedMs,
        verdictFailed: true,
        error: 'no single, final, parseable "## VERDICT" section — a verdict that cannot be read cannot route',
        output,
        tokens,
        sessionId,
        decisions: checked.decisions ?? []
      });
    }
    return result({ ok: true, elapsedMs, output, tokens, sessionId, decisions: checked.decisions ?? [], verdict: verdictOfText });
  };
}
