// Model providers. Raphael needs a model for exactly one thing: turning a mined
// episode into a candidate lesson (distill). There are two ways to get one:
//
//   subscription — shell out to the locally installed Claude Code CLI (`claude -p`).
//                  Billing is the user's fixed-price Pro/Max plan, NOT metered API
//                  usage. This is the DEFAULT: the owner asked for predictable cost.
//   api          — the raw Anthropic Messages API in model.js (needs ANTHROPIC_API_KEY).
//                  Kept as a fallback for CI / servers with no logged-in CLI.
//
// Both keep Raphael's containment invariant: the model sees adversarial episode text
// but can execute NOTHING. The API path defines one forced tool and no others; the CLI
// path passes `--tools ""` (all built-in tools off) + `--strict-mcp-config` with no MCP
// config (no MCP tools), and forces structured output with `--json-schema`. Same
// guarantee, two transports.
//
// callModelCLI returns the SAME thing callModel does — the validated structured object —
// so distill.js never learns which provider ran.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callModel, apiKey } from './model.js';

const CLI_TIMEOUT_MS = 120000;

// ---- binary resolution -----------------------------------------------------

// The npm shim `claude` wraps a native `claude.exe` (Windows) / `claude` (unix)
// under node_modules/@anthropic-ai/claude-code/bin. A native exe spawns cleanly
// with an args array and no shell — which is exactly what we want, because the
// JSON schema arg is full of quotes and shell-quoting it would be misery.
export function claudeBinary() {
  const override = process.env.RAPHAEL_CLAUDE_BIN;
  if (override) return override;

  // Standard npm-global layout next to the shim on PATH.
  const npmDir = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const winExe = path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (process.platform === 'win32' && existsSync(winExe)) return winExe;

  // Unix native build or a plain binary on PATH.
  return 'claude';
}

export function hasClaudeCli() {
  const bin = claudeBinary();
  // An absolute path we can stat; otherwise probe PATH with a zero-cost --version.
  if (path.isAbsolute(bin)) return existsSync(bin);
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
  return r.status === 0;
}

// ---- pure helpers (fully unit-tested; no process spawned) ------------------

// Build the argv for a single contained extraction call. Prompt is NOT here —
// it goes on stdin so adversarial episode text never touches the command line.
export function buildCliArgs({ model, effort, system, toolSchema }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(toolSchema),
    '--tools', '',                 // disable ALL built-in tools
    '--strict-mcp-config',         // + no MCP config passed → no MCP tools either
    '--no-session-persistence'     // one-shot; nothing to resume
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (system) args.push('--system-prompt', system);
  return args;
}

const LIMIT_RE = /(?:session|usage|weekly|5[- ]hour)\s+limit|hit your\s+.*\blimit\b|rate[- ]?limit/i;
const RESET_RE = /reset[s]?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)(?:\s*\(([^)]+)\))?/i;

// True when the CLI output is a subscription-limit refusal, not a model answer.
export function isLimitMessage(text) {
  return LIMIT_RE.test(String(text ?? ''));
}

export function parseResetInfo(text) {
  const m = RESET_RE.exec(String(text ?? ''));
  if (!m) return { resetText: null, resetZone: null };
  return { resetText: m[1].trim(), resetZone: m[2] ? m[2].trim() : null };
}

export function makeLimitError(text, what = 'Claude Code subscription limit reached') {
  const { resetText, resetZone } = parseResetInfo(text);
  const err = new Error(
    `E-LIMIT: ${what}${resetText ? ` (resets ${resetText}${resetZone ? ` ${resetZone}` : ''})` : ''}`
  );
  err.code = 'E-LIMIT';
  err.resetText = resetText;
  err.resetZone = resetZone;
  return err;
}

function safeParseEnvelope(stdout) {
  try {
    return JSON.parse(String(stdout ?? '').trim());
  } catch {
    return null;
  }
}

// True when the parsed envelope represents a real, successful model answer.
export function isSuccessEnvelope(env) {
  return Boolean(env) && !env.is_error && (!env.subtype || env.subtype === 'success');
}

// THE one place that decides "was this invocation a subscription-limit refusal?".
// Returns an E-LIMIT error to throw, or null.
//
// A limit is a PLATFORM refusal: the CLI never produced an answer. So we only
// ever look for it in FAILURE material — stderr, a non-success envelope, or
// stdout that did not parse as JSON at all. We must NEVER scan a successful
// envelope's payload, because a deliverable that *discusses* rate limiting is
// not a limit. That confusion was a real defect in three call sites: Raphael's
// own security pack tells agents to rate-limit auth endpoints, so a security
// stage's own correct answer halted the pipeline as "limit reached", and a
// distilled lesson about 429 handling poison-pilled the distill queue forever.
export function detectLimit({ stdout = '', stderr = '', env = undefined } = {}) {
  const parsed = env !== undefined ? env : safeParseEnvelope(stdout);
  if (isSuccessEnvelope(parsed)) return null; // a real answer is never a limit
  const material = parsed ? `${JSON.stringify(parsed)}\n${stderr}` : `${stdout}\n${stderr}`;
  return isLimitMessage(material) ? makeLimitError(material) : null;
}

// Pull the structured object out of the `claude -p --output-format json`
// envelope. With --json-schema the payload lands in `structured_output`, and
// `result` is an empty string — so structured_output must be checked first,
// and empty/whitespace strings treated as absent, or `result: ""` (not
// nullish) shadows the real object and extraction returns null.
function firstUsable(...vals) {
  for (const v of vals) {
    if (v && typeof v === 'object') return v;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function extractObject(env) {
  const payload = firstUsable(env?.structured_output, env?.output, env?.result);
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    const start = payload.indexOf('{');
    const end = payload.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(payload.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

// Turn a finished `claude -p` invocation into the structured object, or throw a
// coded error. E-LIMIT is special: the caller (and the training driver) can read
// .resetText/.resetZone to schedule a resume instead of failing hard.
export function parseCliResult({ stdout = '', stderr = '', status = 0 }) {
  // Parse FIRST, then judge. A limit refusal is never a parseable success
  // envelope, so detectLimit only inspects failure material (see its comment).
  const env = safeParseEnvelope(stdout);

  if (!env) {
    const limit = detectLimit({ stdout, stderr, env: null });
    if (limit) throw limit;
    if (status !== 0) throw new Error(`E-MODEL: claude exited ${status}: ${stderr.slice(0, 300) || stdout.slice(0, 300)}`);
    throw new Error(`E-MODEL: could not parse claude JSON output: ${stdout.slice(0, 200)}`);
  }

  if (!isSuccessEnvelope(env)) {
    const limit = detectLimit({ stdout, stderr, env });
    if (limit) throw limit;
    throw new Error(`E-MODEL: claude reported ${env.subtype || env.error || 'unknown error'}`);
  }

  const obj = extractObject(env);
  if (!obj) throw new Error('E-MODEL: claude returned no structured object matching the schema');
  return obj;
}

// ---- the CLI caller (thin spawn wrapper; spawn is injectable for tests) ----

export async function callModelCLI(
  { model, effort, system, prompt, toolSchema },
  { spawn = spawnSync, bin = claudeBinary(), cwd = os.tmpdir(), timeout = CLI_TIMEOUT_MS } = {}
) {
  const args = buildCliArgs({ model, effort, system, toolSchema });

  // Force subscription auth: a stray ANTHROPIC_API_KEY in the environment would
  // silently switch billing to metered API usage — the exact thing to avoid.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const r = spawn(bin, args, {
    input: prompt ?? '',
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024
  });

  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') throw new Error('E-MODEL: claude timed out');
    throw new Error(`E-MODEL: could not run claude: ${r.error.message}`);
  }
  return parseCliResult({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 0 });
}

// ---- provider selection ----------------------------------------------------

// Resolve which provider to use. Returns { callModel, provider, reason }.
// config.model.provider: 'auto' (default) | 'subscription' | 'api'.
export function getModelCaller(config = {}, deps = {}) {
  const has = deps.hasClaudeCli ?? hasClaudeCli;
  const key = deps.apiKey ?? apiKey;
  const cli = deps.callModelCLI ?? callModelCLI;
  const api = deps.callModel ?? callModel;

  const pref = config?.model?.provider ?? 'auto';

  // A call may carry its own timeoutMs (adopt's extraction over large material
  // legitimately needs more than distill's small episodes).
  const cliOpts = (o) => (o.timeoutMs ? { timeout: o.timeoutMs } : {});

  if (pref === 'subscription') {
    if (!has()) {
      throw new Error('E-NOPROVIDER: provider is "subscription" but the Claude Code CLI was not found — log in with `claude` or set RAPHAEL_CLAUDE_BIN');
    }
    return { callModel: (o) => cli(o, cliOpts(o)), provider: 'subscription', reason: 'configured' };
  }

  if (pref === 'api') {
    if (!key()) throw new Error('E-NOPROVIDER: provider is "api" but ANTHROPIC_API_KEY is not set');
    return { callModel: (o) => api(o), provider: 'api', reason: 'configured' };
  }

  // auto: prefer the fixed-price subscription; fall back to a metered API key.
  if (has()) return { callModel: (o) => cli(o, cliOpts(o)), provider: 'subscription', reason: 'auto: CLI available' };
  if (key()) return { callModel: (o) => api(o), provider: 'api', reason: 'auto: no CLI, API key present' };
  throw new Error('E-NOPROVIDER: no model provider available — log in with the Claude Code CLI (`claude`) for fixed-price subscription use, or set ANTHROPIC_API_KEY');
}
