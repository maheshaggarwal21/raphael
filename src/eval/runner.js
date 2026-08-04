// The real agent runner for `raph eval run`: spawns a headless `claude -p` in a
// throwaway fixture dir with file edits auto-accepted, lets it do the task, then
// applies the scenario's deterministic checker to whatever files it wrote. This
// is the ONE place eval actually spends subscription tokens — the harness that
// consumes it is pure and injectable, so unit tests use a fake runner instead.
//
// Note the deliberate difference from the distill provider: distill FORBIDS all
// tools (it only extracts text). Eval scenarios require the agent to WRITE files,
// so tools are on — but confined to an isolated temp dir on the subscription.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeBinary, detectLimit, isSuccessEnvelope } from '../lib/provider.js';
import { FORBIDDEN_TOOL_PATTERNS } from '../lib/autonomy.js';

const RUN_TIMEOUT_MS = 300000;

export function buildEvalArgs({ model }) {
  const args = [
    '-p',
    '--output-format', 'json',
    // Same reasoning as the driver (autonomy.js): acceptEdits auto-accepts file
    // writes but still ASKS before running a command, and an eval run is
    // headless. A scenario agent that cannot run a command is not measuring the
    // brain's effect, it is measuring the permission prompt.
    '--permission-mode', 'bypassPermissions',
    '--disallowedTools', ...FORBIDDEN_TOOL_PATTERNS,
    '--strict-mcp-config',              // no MCP tools
    '--no-session-persistence'
  ];
  if (model) args.push('--model', model);
  return args;
}

function tokensFromEnvelope(env) {
  const u = env?.usage ?? {};
  const t = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  if (t > 0) return t;
  // fall back to modelUsage totals if present
  const mu = env?.modelUsage ?? {};
  let sum = 0;
  for (const k of Object.keys(mu)) sum += (mu[k].inputTokens ?? 0) + (mu[k].outputTokens ?? 0);
  return sum;
}

// Returns runAgent(opts) -> { caught, task_complete, tokens, model }. Throws a
// coded E-LIMIT (with reset info) if the subscription limit is hit mid-eval so the
// command can stop cleanly and leave the rest for after the reset.
export function makeRealRunner({
  bin = claudeBinary(),
  spawn = spawnSync,
  timeout = RUN_TIMEOUT_MS,
  workRoot = os.tmpdir(),
  keepDirs = false
} = {}) {
  return async function runAgent({ scenario, model, injectedText }) {
    const dir = mkdtempSync(path.join(workRoot, `raph-eval-${scenario.id}-`));
    try {
      scenario.setup(dir);
      const prompt = (injectedText ? `${injectedText}\n\n` : '') + scenario.prompt;

      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;

      const r = spawn(bin, buildEvalArgs({ model }), {
        input: prompt,
        cwd: dir,
        env,
        encoding: 'utf8',
        timeout,
        maxBuffer: 20 * 1024 * 1024
      });

      // Parse FIRST, then judge. S21 ("harden this Express app") has helmet +
      // rate limiting as its CORRECT answer — scanning a successful envelope for
      // limit wording would abort the eval on its own best result.
      let envelope = null;
      try {
        envelope = JSON.parse((r.stdout ?? '').trim());
      } catch {
        /* leave envelope null; token count falls back to 0 */
      }

      const limit = detectLimit({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', env: envelope });
      if (limit) {
        limit.message = limit.message.replace('Claude Code subscription limit reached', 'subscription limit hit during eval');
        throw limit;
      }

      // A RUN THAT NEVER HAPPENED IS NOT A RESULT.
      //
      // This silently returned a verdict when the agent had not run at all: a
      // spawn failure or an error envelope left `envelope = {}`, the fixture
      // untouched, and check() dutifully reported caught:false / tokens:0. A
      // whole eval then printed a clean "0% ON vs 0% OFF, not distinguishable
      // from noise" table while NOTHING had executed — a failure wearing the
      // costume of a measurement, which is the one thing an eval must never do.
      // Observed live 2026-07-26: every arm came back 429 "Usage credits are
      // required for this model" and the report looked like data.
      if (r.error) {
        throw new Error(`E-EVAL-RUN: could not start the agent (${r.error.message}) — no measurement was taken`);
      }
      if (!envelope) {
        throw new Error(`E-EVAL-RUN: the agent produced no parseable output (exit ${r.status}) — no measurement was taken`);
      }
      if (!isSuccessEnvelope(envelope)) {
        const detail = envelope.result || envelope.error || envelope.subtype || 'unknown error';
        const status = envelope.api_error_status ? ` [HTTP ${envelope.api_error_status}]` : '';
        const err = new Error(`E-EVAL-RUN${status}: the agent did not complete — ${String(detail).slice(0, 200)}`);
        err.code = 'E-EVAL-RUN';
        err.apiStatus = envelope.api_error_status ?? null;
        throw err;
      }

      const verdict = scenario.check(dir);
      const usedModel = model ?? (envelope.modelUsage ? Object.keys(envelope.modelUsage)[0] : null);
      return { ...verdict, tokens: tokensFromEnvelope(envelope), model: usedModel };
    } finally {
      if (!keepDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }
  };
}

// A TEXT-ONLY probe: ask a question, return the answer. Used by the declarative
// canary arm, which judges what the agent SAYS rather than what it writes — so
// it needs no fixture dir and no tools. Same containment discipline as the
// scenario runner (API keys stripped, prompt on stdin, structured envelope).
export function makeAskRunner({ bin = claudeBinary(), spawn = spawnSync, timeout = RUN_TIMEOUT_MS, model = undefined, cwd = os.tmpdir() } = {}) {
  return async function ask({ prompt, injectedText = '' }) {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const r = spawn(bin, [...buildEvalArgs({ model }), '--tools', ''], {
      input: (injectedText ? `${injectedText}\n\n` : '') + prompt,
      cwd,
      env,
      encoding: 'utf8',
      timeout,
      maxBuffer: 20 * 1024 * 1024
    });
    if (r.error) throw new Error(`E-EVAL: could not run claude: ${r.error.message}`);

    let envelope = null;
    try { envelope = JSON.parse((r.stdout ?? '').trim()); } catch { /* handled below */ }
    const limit = detectLimit({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', env: envelope });
    if (limit) throw limit;
    if (!envelope) throw new Error('E-EVAL: claude produced no parseable output');
    return typeof envelope.result === 'string' ? envelope.result : '';
  };
}
