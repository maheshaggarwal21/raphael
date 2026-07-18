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

// ---------- Phase 17: mode + global consent ----------

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
