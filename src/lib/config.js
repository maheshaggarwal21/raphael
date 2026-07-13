// Config + per-project consent registry. Mining only ever touches projects
// the user explicitly registered — consent is opt-in, per absolute path.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

const DEFAULT_CONFIG = () => ({ schema: 'raphael/config/v1', mode: 'curator', projects: {} });

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
