// The execution layer — the one place a graph run spends tokens. Separated
// from routing as a fact about the module graph, not just a comment: this
// file must not import recovery.js or graph.js, and a test asserts it. A
// runner that could see the RECOVERY table could route, which isn't its job.
//
// Its contract is raw facts only — did the child spawn, did it time out, did
// the deliverable satisfy its declared shape, how long did it take, what did
// it cost. It never names a failure class or a node, never says what happens
// next; classifyFailure() in recovery.js turns these observations into a
// decision.
//
// Tools are ON here (a stage writes real files), unlike distill's zero-tool
// containment — but the grant is explicit and comes from the roster via
// policy.tools. See buildStageArgs.

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { claudeBinary, detectLimit, isSuccessEnvelope } from './provider.js';
import { FORBIDDEN_TOOL_PATTERNS } from './autonomy.js';

export const STAGE_TIMEOUT_MS = 600000; // a stage writes real code; give it 10 minutes

// The complete set of keys a stage result may carry. Asserted by set equality
// in the separation test — a subset check would let a routing key be added
// later without anything failing. `failureClass`, `next` and `action` are
// absent by design, and no key names a node.
export const RESULT_KEYS = Object.freeze([
  'ok', 'spawned', 'apiError', 'timedOut', 'gateFailed', 'verdictFailed', 'verifyFailed',
  'elapsedMs', 'tokens', 'tokensCaptured', 'output', 'error', 'decisions', 'corrections', 'verdict', 'sessionId'
]);

// Did the CLI itself report a transport/auth failure rather than a model
// answer? This is an observation, not a classification — classifyFailure()
// still decides what it means. Without it, a revoked token or a transient DNS
// failure arrives as a well-formed envelope (`spawned: true`) and gets
// classified as `model`, sending a momentary network blip straight to a human
// escalation, or burning an opus retry trying to out-think DNS.
//
// `api_error_status` is the authoritative structured signal; the phrase list
// is a narrow fallback for transport errors reported without a status code.
const TRANSPORT_ERROR = /\bAPI Error\b|\bUnable to connect\b|\bFailed to authenticate\b|\b(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT)\b/i;

export function isApiError(envMsg) {
  if (!envMsg) return false;
  if (Number.isFinite(envMsg.api_error_status)) return true;
  return typeof envMsg.result === 'string' && TRANSPORT_ERROR.test(envMsg.result);
}

function result(fields) {
  const out = {
    ok: false,
    spawned: true,
    apiError: false,
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
    corrections: [],
    verdict: null,
    sessionId: null,
    ...fields
  };
  // Every result carries exactly the declared keys, always.
  return Object.fromEntries(RESULT_KEYS.map((k) => [k, out[k]]));
}

// Session persists under --session-id so an interrupted stage can continue
// with --resume instead of restarting from zero.
//
// The tool grant is explicit and fails closed: omitting --tools would grant
// every built-in tool, which is what once made read-only roster agents into
// writers inside the driver.
export function buildStageArgs({ model, effort, tools, sessionId, resume = false }) {
  const args = [
    '-p',
    '--output-format', 'json',
    // bypassPermissions, not acceptEdits. acceptEdits auto-accepts file edits
    // but still ASKS before running a command, and a headless run has no one to
    // ask — 34% of Bash calls in an observed run died as "requires approval",
    // including every `node --test` and every `raph` invocation the spine tells
    // agents to make. The prompt was not protecting anything here; it was only
    // preventing work.
    //
    // What replaces it is deterministic rather than interactive: the
    // irreversible and boundary-crossing commands are refused by the CLI via
    // --disallowedTools below, the tool grant is already per-agent from the
    // roster, cwd is the workspace, and the charter carries the judgment.
    '--permission-mode', 'bypassPermissions',
    '--disallowedTools', ...FORBIDDEN_TOOL_PATTERNS,
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
        // A timeout is an interruption with work on disk and a live session; a
        // spawn failure is environmental. Naming them 'timeout'/'infra' is the
        // recovery layer's job, not this one's.
        spawned: !timedOut ? false : true,
        timedOut,
        elapsedMs,
        // The child was killed, so its usage envelope never arrived — "not
        // captured", not a 0 that reads as "free".
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
      // The CLI's own `subtype` can read "success" on a failed envelope — a
      // revoked OAuth token, for instance, produces { subtype:"success",
      // is_error:true, api_error_status:401, result:"Failed to
      // authenticate..." }. Leading with subtype there produces the actively
      // misleading message "claude reported success" for an auth failure.
      // `result`, when present, is the CLI's own human-readable reason and is
      // always preferred.
      const reason = (typeof envMsg?.result === 'string' && envMsg.result.trim())
        || envMsg?.subtype || envMsg?.error || 'error';
      const status = envMsg?.api_error_status ? ` (HTTP ${envMsg.api_error_status})` : '';
      return result({
        spawned: Boolean(envMsg),
        // The CLI's own report that the call never reached a model. The recovery
        // layer reads this to retry environmentally instead of blaming the model.
        apiError: isApiError(envMsg),
        elapsedMs,
        error: `claude reported: ${reason}${status}`,
        tokens,
        sessionId
      });
    }
    const output = typeof envMsg.result === 'string' && envMsg.result.trim() ? envMsg.result : null;
    if (!output) return result({ elapsedMs, error: 'stage produced no text deliverable', tokens, sessionId });

    // The declared pass predicate, injected by the caller — the runner holds
    // no opinion about what passing means. "Non-empty text" is not a
    // completion test; it would accept a clarifying question as a finished spec.
    const verdictOfText = wantsVerdict && parseVerdict ? parseVerdict(output) : null;
    // Required, not defaulted — a caller that forgets the gate must not
    // silently get a runner that accepts any non-empty text.
    if (typeof gate !== 'function') {
      throw new Error('E-DRIVER: a stage runner needs the node\'s declared gate — without one, any non-empty text would pass');
    }
    const checked = gate(output);
    if (!checked.ok) {
      return result({
        elapsedMs, gateFailed: true, error: checked.why, output, tokens, sessionId, verdict: verdictOfText,
        // A gate failure still carries the stage's corrections: "your input was
        // wrong" is worth reading even when the deliverable was rejected.
        corrections: checked.corrections ?? []
      });
    }
    // A verdict node that produced no parseable verdict fails closed — never
    // an implicit approval.
    if (wantsVerdict && verdictOfText === null) {
      return result({
        elapsedMs,
        verdictFailed: true,
        error: 'no single, final, parseable "## VERDICT" section — a verdict that cannot be read cannot route',
        output,
        tokens,
        sessionId,
        decisions: checked.decisions ?? [],
        corrections: checked.corrections ?? []
      });
    }
    return result({
      ok: true, elapsedMs, output, tokens, sessionId,
      decisions: checked.decisions ?? [],
      corrections: checked.corrections ?? [],
      verdict: verdictOfText
    });
  };
}
