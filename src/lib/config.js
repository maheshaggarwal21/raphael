// Config + per-project consent registry. Mining only ever touches projects
// the user explicitly registered — consent is opt-in, per absolute path.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

// model.provider: 'auto' (default) prefers the fixed-price Claude Code subscription
// (shell out to `claude -p`) and falls back to a metered ANTHROPIC_API_KEY only if the
// CLI is not logged in. Force one with 'subscription' or 'api'.
const DEFAULT_CONFIG = () => ({
  schema: 'raphael/config/v1',
  mode: 'curator',
  model: { provider: 'auto' },
  projects: {}
});

export function loadConfig() {
  const file = p.config();
  if (!existsSync(file)) return DEFAULT_CONFIG();

  let parsed;
  try {
    // JSON_SCHEMA: no implicit dates/timestamps, keys stay plain strings.
    parsed = yaml.load(readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
  } catch (err) {
    throw new Error(`E-CONFIG: cannot parse ${file}: ${err.message}`);
  }
  if (parsed == null) return DEFAULT_CONFIG();
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`E-CONFIG: ${file} must contain a YAML mapping`);
  }
  if (!parsed.projects || typeof parsed.projects !== 'object') parsed.projects = {};
  return parsed;
}

export function saveConfig(cfg) {
  atomicWrite(p.config(), yaml.dump(cfg, { schema: yaml.JSON_SCHEMA }));
}

function samePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  // Windows paths are case-insensitive; drive-letter and dir case drift freely.
  if (process.platform === 'win32') return ra.toLowerCase() === rb.toLowerCase();
  return ra === rb;
}

export function getProjectConsent(cfg, projectPath) {
  const projects = cfg?.projects ?? {};
  for (const key of Object.keys(projects)) {
    if (samePath(key, projectPath)) return projects[key]?.consent;
  }
  return undefined;
}

// ---------- mode + global consent ----------

export const MODES = ['curator', 'autopilot'];

// Fail closed: anything unknown reads as curator (the human-review mode).
export function getMode(cfg) {
  return cfg?.mode === 'autopilot' ? 'autopilot' : 'curator';
}

export function setMode(mode) {
  if (!MODES.includes(mode)) {
    throw new Error(`E-CONFIG: unknown mode "${mode}" — use curator or autopilot`);
  }
  const cfg = loadConfig();
  cfg.mode = mode;
  saveConfig(cfg);
  return cfg;
}

function underPath(child, parent) {
  const rc = path.resolve(child);
  const rp = path.resolve(parent);
  const a = process.platform === 'win32' ? rc.toLowerCase() : rc;
  const b = process.platform === 'win32' ? rp.toLowerCase() : rp;
  return a === b || a.startsWith(b + path.sep);
}

// The one consent question (permission #1). Precedence, most specific first:
//   1. an explicit per-project registry answer (true OR false) always wins
//   2. a consent.ignore entry blocks the project (and everything under it)
//   3. consent.scope 'all' grants everything else
//   4. otherwise undefined — the caller must ask (curator-era behavior)
export function hasConsent(cfg, projectPath) {
  const explicit = getProjectConsent(cfg, projectPath);
  if (explicit !== undefined) return explicit;
  const consent = cfg?.consent;
  if (consent?.scope === 'all') {
    for (const entry of consent.ignore ?? []) {
      if (underPath(projectPath, entry)) return false;
    }
    return true;
  }
  return undefined;
}

export function setConsentScope(scope, { ignore } = {}) {
  if (scope !== 'all' && scope !== 'registered') {
    throw new Error(`E-CONFIG: unknown consent scope "${scope}" — use all or registered`);
  }
  if (ignore !== undefined && (!Array.isArray(ignore) || ignore.some((x) => typeof x !== 'string' || !x.trim()))) {
    throw new Error('E-CONFIG: consent ignore list must be an array of paths');
  }
  const cfg = loadConfig();
  cfg.consent = {
    scope,
    granted: new Date().toISOString().slice(0, 10),
    ...(ignore?.length ? { ignore: ignore.map((x) => path.resolve(x)) } : {})
  };
  saveConfig(cfg);
  return cfg;
}

// Injection kill switch (`raph on` / `raph off`). Absent = enabled: the hooks
// are already a no-op until the first lesson is approved, so the default is safe.
export function isInjectionEnabled(cfg) {
  return (cfg?.injection?.enabled) !== false;
}

// 18.3 — the RECALL dial: how assertive recall is, deliberately separate from the
// auto-approve dial (that one governs what may ACTIVATE; this one governs how much
// of what is already active gets SPOKEN). Named settings beat raw numbers because
// the trade-off is legible: quiet = fewer interruptions, eager = more coverage.
//
// Explicit injection.* numbers in config still win, so anyone who tuned by hand
// keeps their tuning — the dial only supplies the defaults.
export const RECALL_LEVELS = ['quiet', 'normal', 'eager'];

const RECALL_PRESETS = {
  // digestMax/promptMax = how many lines may appear; the thresholds are the
  // score a lesson must clear to be worth saying at all.
  quiet:  { digestMax: 3,  promptMax: 1, digestThreshold: 2.0, promptThreshold: 6.0, sessionCap: 600 },
  normal: { digestMax: 10, promptMax: 3, digestThreshold: 1.0, promptThreshold: 4.0, sessionCap: 1200 },
  eager:  { digestMax: 15, promptMax: 5, digestThreshold: 0.5, promptThreshold: 3.0, sessionCap: 1800 }
};

export function getRecallLevel(cfg = loadConfig()) {
  const raw = String(cfg?.injection?.recall ?? 'normal').trim().toLowerCase();
  return RECALL_LEVELS.includes(raw) ? raw : 'normal'; // fail to the middle, never louder
}

// Resolved knobs for inject.js.
//
// THE DIAL OWNS THESE. `raph init` has always written session_start_max /
// per_prompt_max / session_cap_tokens into config.yaml as defaults, and until
// 18.3 inject.js ignored them entirely (it used hardcoded constants). So letting
// those top-level keys override the preset would leave the dial dead on arrival
// for every existing install — you would set "eager" and nothing would change.
// They stay ignored; the dial is the source of truth.
//
// A genuine power-user override lives under injection.overrides.* instead, where
// it is unambiguously something a human chose rather than a default init wrote.
export function recallProfile(cfg = loadConfig()) {
  const level = getRecallLevel(cfg);
  const preset = RECALL_PRESETS[level];
  const ov = cfg?.injection?.overrides ?? {};
  const num = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);
  return {
    level,
    digestMax: num(ov.session_start_max, preset.digestMax),
    promptMax: num(ov.per_prompt_max, preset.promptMax),
    digestThreshold: num(ov.digest_threshold, preset.digestThreshold),
    promptThreshold: num(ov.prompt_threshold, preset.promptThreshold),
    sessionCap: num(ov.session_cap_tokens, preset.sessionCap)
  };
}

export function setRecallLevel(level) {
  const v = String(level ?? '').trim().toLowerCase();
  if (!RECALL_LEVELS.includes(v)) {
    throw new Error(`E-CONFIG: recall must be one of ${RECALL_LEVELS.join(', ')}, got "${level}"`);
  }
  const cfg = loadConfig();
  cfg.injection = { ...(cfg.injection ?? {}), recall: v };
  saveConfig(cfg);
  return v;
}

export function setInjectionEnabled(enabled) {
  if (typeof enabled !== 'boolean') {
    throw new Error(`E-CONFIG: injection.enabled must be boolean, got ${typeof enabled}`);
  }
  const cfg = loadConfig();
  cfg.injection = { ...(cfg.injection ?? {}), enabled };
  saveConfig(cfg);
  return cfg;
}

export function setProjectConsent(projectPath, consent) {
  if (typeof consent !== 'boolean') {
    throw new Error(`E-CONFIG: consent must be boolean, got ${typeof consent}`);
  }
  const cfg = loadConfig();
  const resolved = path.resolve(projectPath);
  // Drop any case-variant duplicate of the same path before writing.
  for (const key of Object.keys(cfg.projects)) {
    if (key !== resolved && samePath(key, resolved)) delete cfg.projects[key];
  }
  cfg.projects[resolved] = {
    consent,
    registered: new Date().toISOString().slice(0, 10)
  };
  saveConfig(cfg);
  return cfg;
}
