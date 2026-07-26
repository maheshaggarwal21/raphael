import { existsSync, readFileSync, readdirSync, accessSync, constants } from 'node:fs';
import { claudeBinary, hasClaudeCli, isSuccessEnvelope } from '../lib/provider.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { p } from '../lib/paths.js';
import { validateLesson } from '../lib/validate.js';
import { isInjectionEnabled } from '../lib/config.js';

function listLessonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLessonFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export default async function doctor() {
  const checks = [];
  const add = (name, ok, fix = '', warn = false) => checks.push({ name, ok, fix, warn });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(`node ${process.versions.node} (need >=18)`, nodeMajor >= 18, 'install Node 18 or newer');

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  add('git available', git.status === 0, 'install git — brain versioning depends on it');

  const initialized = existsSync(p.home());
  add(`brain exists at ${p.home()}`, initialized, 'run "raph init"');

  if (initialized) {
    let configOk = false;
    try {
      const cfg = yaml.load(readFileSync(p.config(), 'utf8'), { schema: yaml.JSON_SCHEMA });
      configOk = cfg?.schema === 'raphael/config/v1';
    } catch { /* fall through */ }
    add('config.yaml parses', configOk, 'fix or delete config.yaml, then re-run "raph init"');

    add('brain is a git repo', existsSync(path.join(p.brain(), '.git')), 're-run "raph init" with git installed');
    add(
      'pre-push guard installed',
      existsSync(path.join(p.brain(), '.git', 'hooks', 'pre-push')),
      're-run "raph init" to restore the push blocker',
      true
    );

    const files = listLessonFiles(p.lessons());
    let bad = 0;
    for (const f of files) {
      const r = validateLesson(readFileSync(f, 'utf8'));
      if (!r.ok) bad++;
    }
    add(
      `lessons validate (${files.length - bad}/${files.length})`,
      bad === 0,
      'run "raph validate --all" to see which files fail'
    );
  }

  const transcripts = path.join(os.homedir(), '.claude', 'projects');
  let transcriptsOk = false;
  try {
    accessSync(transcripts, constants.R_OK);
    transcriptsOk = true;
  } catch { /* not present or unreadable */ }
  add('claude session transcripts readable', transcriptsOk, `expected at ${transcripts} — mining will have nothing to read`, true);

  // Can Raphael's headless work ACTUALLY run? Having the CLI installed is not
  // the same as being able to call a model with it: on 2026-07-26 every eval arm
  // came back HTTP 429 "Usage credits are required for this model", because the
  // child inherited whatever model the user had last chosen interactively and
  // the subscription does not cover that one headlessly. `raph doctor` said
  // "healthy" throughout. One cheap probe turns a baffling failure into a
  // sentence. Opt out with RAPHAEL_SKIP_MODEL_PROBE=1 (it costs a few tokens).
  if (!probeSkipped()) {
    const probe = probeHeadlessModel();
    add(
      `headless model call works (${probe.model})`,
      probe.ok,
      probe.hint,
      true
    );
  }

  // --- plugin / injection health (Phase 9) ---
  if (initialized) {
    let injectionOn = true;
    try {
      const cfg = yaml.load(readFileSync(p.config(), 'utf8'), { schema: yaml.JSON_SCHEMA });
      injectionOn = isInjectionEnabled(cfg);
    } catch { /* default: enabled */ }
    add('injection enabled', injectionOn, 'run "raph on" so the hooks add lessons (mining/review still work while off)', true);
  }

  // `raph` on PATH — the plugin's hooks call the bare `raph` command, so it must resolve
  // globally (npm install -g) even though `node bin/raph.js` works in this repo.
  const raphOnPath = spawnSync('raph', ['version'], { encoding: 'utf8', shell: true });
  add('raph on PATH (plugin hooks call it)', raphOnPath.status === 0, 'install globally: npm install -g raphael-brain', true);

  // Plugin packaging present (relative to this CLI). WARN-only: the CLI runs fine without it,
  // but the Claude Code plugin needs the manifest + hooks to auto-wire recall.
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pluginDir = path.join(repoRoot, 'plugin');
  if (existsSync(pluginDir)) {
    add('plugin manifest present', existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json')), 'Phase 9 packaging: add plugin/.claude-plugin/plugin.json', true);
    add('plugin hooks.json present', existsSync(path.join(pluginDir, 'hooks', 'hooks.json')), 'add plugin/hooks/hooks.json so SessionStart/UserPromptSubmit auto-inject', true);
  }

  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : c.warn ? 'WARN' : 'FAIL';
    if (!c.ok && !c.warn) failed++;
    console.log(`${mark}  ${c.name}${c.ok || !c.fix ? '' : `\n      fix: ${c.fix}`}`);
  }
  console.log(failed === 0 ? 'raph: healthy' : `raph: ${failed} check(s) failing`);
  return failed === 0 ? 0 : 1;
}

// --- headless model probe ----------------------------------------------------
// A few tokens, once, to answer the question that matters: can this machine
// actually make the model calls Raphael depends on? It uses the SAME resolution
// path the real work uses, and pins an explicit model so it tests availability
// rather than whatever the interactive session happens to be set to.
export function probeSkipped() {
  return process.env.RAPHAEL_SKIP_MODEL_PROBE === '1' || !hasClaudeCli();
}

export function probeHeadlessModel({ model = 'haiku', spawn = spawnSync } = {}) {
  try {
    const bin = claudeBinary();
    const r = spawn(bin, ['-p', '--output-format', 'json', '--strict-mcp-config', '--no-session-persistence', '--tools', '', '--model', model], {
      input: 'Reply with exactly: OK',
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (r.error) return { ok: false, model, hint: `could not run the claude CLI (${r.error.message}) — check the install` };

    let env = null;
    try { env = JSON.parse(String(r.stdout ?? '').trim()); } catch { /* handled below */ }
    if (!env) return { ok: false, model, hint: `the CLI returned no parseable output (exit ${r.status}) — try "claude -p" by hand` };
    if (isSuccessEnvelope(env)) return { ok: true, model, hint: '' };

    const detail = String(env.result || env.error || env.subtype || 'unknown').slice(0, 120);
    if (env.api_error_status === 429) {
      return {
        ok: false,
        model,
        hint: `HTTP 429 — ${detail}. Distill/eval/autopilot cannot call a model. If this only happens on the DEFAULT model, pass --model explicitly; Raphael pins one for its own work.`
      };
    }
    return { ok: false, model, hint: `the model call failed — ${detail}` };
  } catch (err) {
    return { ok: false, model, hint: `probe failed: ${err.message}` };
  }
}
