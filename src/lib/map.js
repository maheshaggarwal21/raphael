// Project map (ARCHITECTURE §8) — the biggest token saver. Instead of an agent
// re-exploring a repo from scratch every session (often 100k+ tokens), it reads
// one compact cached summary: stack, entry points, top-level structure, and the
// hottest (most-churned) files. The map is DETERMINISTIC by default — a pure scan
// plus a cheap `git log` — so generating it spends zero model tokens. An optional
// one-pass model summary (runModel injected) can add a "trouble spots" note, but
// it is opt-in; the default map is free and offline.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { detectStacks } from './stacks.js';

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out', '.venv', '__pycache__', 'vendor']);

// Count files per top-level directory (one level), skipping noise. Cheap and bounded.
function topLevelStructure(dir) {
  const rows = [];
  let rootFiles = 0;
  for (const entry of safeReaddir(dir)) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      rows.push({ name: entry.name + '/', files: countFiles(full, 0) });
    } else {
      rootFiles++;
    }
  }
  rows.sort((a, b) => b.files - a.files);
  return { rows, rootFiles };
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function countFiles(dir, depth) {
  if (depth > 6) return 0;
  let n = 0;
  for (const entry of safeReaddir(dir)) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      n += countFiles(path.join(dir, entry.name), depth + 1);
    } else {
      n++;
    }
  }
  return n;
}

// Entry points from manifests we can read cheaply. Best-effort, never throws.
function entryPoints(dir) {
  const out = [];
  const pkgPath = path.join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.main) out.push(`package.json main: ${pkg.main}`);
      if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
        out.push(`bin: ${bins.join(', ')}`);
      }
      if (pkg.scripts) out.push(`scripts: ${Object.keys(pkg.scripts).join(', ')}`);
    } catch {
      /* malformed package.json — skip */
    }
  }
  for (const cand of ['index.js', 'main.py', 'app.py', 'src/main.rs', 'main.go', 'cmd']) {
    if (existsSync(path.join(dir, cand))) out.push(cand);
  }
  return out;
}

// Hottest files = most-changed in recent history. Pure signal of where trouble
// lives. Injectable git runner so tests don't need a real repo.
export function hotFiles(dir, { git, limit = 8 } = {}) {
  if (!git) return [];
  const r = git(['log', '--pretty=format:', '--name-only', '-n', '400'], dir);
  if (!r || r.status !== 0 || !r.stdout) return [];
  const counts = new Map();
  for (const line of r.stdout.split(/\r?\n/)) {
    const f = line.trim();
    if (!f) continue;
    if ([...IGNORE_DIRS].some((d) => f.startsWith(d + '/'))) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([file, changes]) => ({ file, changes }));
}

// Build the map markdown. Deterministic given (dir, git). runModel is optional and
// only adds a prose "trouble spots" note; when absent the map is fully offline.
export async function generateMap(dir, { git, runModel, today = '(undated)' } = {}) {
  const name = path.basename(path.resolve(dir));
  const stacks = detectStacks(dir);
  const structure = topLevelStructure(dir);
  const entries = entryPoints(dir);
  const hot = hotFiles(dir, { git });
  const totalFiles = structure.rows.reduce((s, r) => s + r.files, 0) + structure.rootFiles;

  const lines = [];
  lines.push(`# Project map: ${name}`);
  lines.push(`_generated ${today} by \`raph map\` · ${totalFiles} files · ${stacks.length ? stacks.join(', ') : 'stack unknown'}_`);
  lines.push('');
  lines.push('## Stack');
  lines.push(stacks.length ? stacks.map((s) => `- ${s}`).join('\n') : '- (no manifest detected)');
  lines.push('');
  lines.push('## Entry points');
  lines.push(entries.length ? entries.map((e) => `- ${e}`).join('\n') : '- (none detected)');
  lines.push('');
  lines.push('## Structure (top level)');
  if (structure.rootFiles) lines.push(`- (root) — ${structure.rootFiles} file(s)`);
  lines.push(structure.rows.length ? structure.rows.map((r) => `- ${r.name} — ${r.files} file(s)`).join('\n') : '- (empty)');
  lines.push('');
  lines.push('## Hot files (most-changed, recent history)');
  lines.push(hot.length ? hot.map((h) => `- ${h.file} (${h.changes} changes)`).join('\n') : '- (no git history available)');

  let modelNote = null;
  if (runModel) {
    try {
      modelNote = await runModel({ name, stacks, entries, structure, hot });
    } catch {
      modelNote = null; // a map is still useful without the summary
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push(modelNote ? String(modelNote).trim() : '_(deterministic map; run with a model summary for trouble-spot notes)_');
  lines.push('');

  const markdown = lines.join('\n');
  return { name, markdown, meta: { stacks, totalFiles, entries: entries.length, hot: hot.length } };
}

// Sanitize a project name into a safe map filename. Invalid chars become '-', and
// a name that is only dots/separators (e.g. '...', which is not a usable filename)
// collapses to 'project'.
export function mapFileName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.\-]+|[.\-]+$/g, '') || 'project';
}
