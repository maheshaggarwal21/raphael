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
import { claudeBinary, isLimitMessage, parseResetInfo } from '../lib/provider.js';

const RUN_TIMEOUT_MS = 300000;

export function buildEvalArgs({ model }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits', // auto-accept file writes in the throwaway fixture
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

      const combined = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
      if (isLimitMessage(combined)) {
        const { resetText, resetZone } = parseResetInfo(combined);
        const err = new Error(`E-LIMIT: subscription limit hit during eval${resetText ? ` (resets ${resetText}${resetZone ? ` ${resetZone}` : ''})` : ''}`);
        err.code = 'E-LIMIT';
        err.resetText = resetText;
        err.resetZone = resetZone;
        throw err;
      }

      let envelope = {};
      try {
        envelope = JSON.parse((r.stdout ?? '').trim());
      } catch {
        /* leave envelope empty; token count falls back to 0 */
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
