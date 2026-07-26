// The compiled index: one small JSON file the hooks read instead of parsing
// every lesson on every prompt. Integrity rule (threat model): the index is
// verified against lesson-file CONTENT HASHES before use, not mtime — a
// tampered or stale index never injects. On any mismatch it silently rebuilds
// from the lesson files, and every lesson re-passes the validation chokepoint
// on the way in (a hand-edited lesson that no longer validates drops out).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateLesson } from './validate.js';
import { contentHash } from './transcripts.js';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

const INDEXED_STATUS = new Set(['active', 'probation']);

function lessonFiles() {
  const root = p.lessons();
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  }
  return out.sort();
}

function relToLessons(file) {
  return path.relative(p.lessons(), file).split(path.sep).join('/');
}

// Rebuild index/compiled.json from the lesson files. Every file goes back
// through validateLesson() — the index is a write path like any other.
// Quarantine-flagged content is kept IF valid: a human explicitly confirmed
// it at approve time; build-time is not a second review.
export function buildIndex() {
  const lessons = [];
  const skipped = [];
  const seen = [];
  for (const file of lessonFiles()) {
    // hash ONCE per file (it used to be computed twice and the file read three
    // times), and record the stat so verifyIndex can skip re-hashing later
    const hash = contentHash(file);
    let size = null;
    let mtimeMs = null;
    try {
      const st = statSync(file);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch { /* recorded as null → verifyIndex falls back to hashing */ }
    seen.push({ file: relToLessons(file), hash, ...(size !== null ? { size, mtimeMs } : {}) });
    let check;
    try {
      check = validateLesson(readFileSync(file, 'utf8'));
    } catch {
      skipped.push({ file: relToLessons(file), codes: ['E-FRONTMATTER'] });
      continue;
    }
    if (!check.ok) {
      skipped.push({ file: relToLessons(file), codes: check.errors.map((e) => e.code) });
      continue;
    }
    const d = check.data;
    if (!INDEXED_STATUS.has(d.status)) continue;
    lessons.push({
      id: d.id,
      slug: d.slug,
      title: d.title,
      status: d.status,
      category: d.category,
      severity: d.severity,
      scope: d.scope,
      triggers: d.triggers,
      evidence: {
        observations: d.evidence?.observations ?? 0,
        distinct_projects: d.evidence?.distinct_projects ?? 0,
        last_seen: d.evidence?.last_seen ?? null
      },
      injection: d.injection,
      counter_indications: d.counter_indications ?? null,
      file: relToLessons(file),
      hash
    });
  }
  const index = {
    schema: 'raphael/index/v1',
    built_at: new Date().toISOString(),
    // every file present at build time, including skipped-invalid ones —
    // verifyIndex uses this so a skipped file doesn't force a rebuild loop
    built_files: seen,
    lessons
  };
  atomicWrite(p.compiledIndex(), JSON.stringify(index, null, 2) + '\n');
  return { count: lessons.length, skipped };
}

// True when the index still describes exactly what is on disk: same file set,
// same content hashes — for EVERY file seen at build time, including ones that
// were skipped as invalid (so fixing one by hand is detected too). Anything
// else — edited, added, deleted, tampered — is stale.
// A stat fast-path keeps this honest AND cheap. Full content hashing on every
// load meant a read + SHA-256 of every lesson file on every prompt (linear in
// brain size, on a Windows hook path where small-file opens are not free —
// audit 2026-07-26). Now: if size AND mtime both match what the build recorded,
// the file is unchanged and hashing is skipped; anything that differs — or has no
// recorded stat, i.e. an index built before this change — falls back to the full
// hash. So the integrity property is identical, the cost is not.
export function verifyIndex(index) {
  if (!index || index.schema !== 'raphael/index/v1' || !Array.isArray(index.lessons)) return false;
  if (!Array.isArray(index.built_files)) return false;
  const onDisk = lessonFiles().map(relToLessons);
  const built = new Map(index.built_files.map((e) => [e.file, e]));
  if (onDisk.length !== built.size) return false;
  for (const rel of onDisk) {
    const entry = built.get(rel);
    if (entry === undefined) return false;
    const full = path.join(p.lessons(), ...rel.split('/'));
    if (statMatches(full, entry)) continue; // unchanged: no read, no hash
    if (contentHash(full) !== entry.hash) return false;
  }
  return true;
}

// True only when the recorded stat exists and matches exactly. Any doubt (no
// recorded stat, unreadable file, any difference) returns false so the caller
// does the full hash — never the other way round.
function statMatches(full, entry) {
  if (!entry || typeof entry.size !== 'number' || typeof entry.mtimeMs !== 'number') return false;
  try {
    const st = statSync(full);
    return st.size === entry.size && st.mtimeMs === entry.mtimeMs;
  } catch {
    return false;
  }
}

// Load the compiled index, rebuilding when missing, unreadable, or stale.
export function loadIndex() {
  let index = null;
  let rebuilt = false;
  if (existsSync(p.compiledIndex())) {
    try {
      index = JSON.parse(readFileSync(p.compiledIndex(), 'utf8'));
    } catch {
      index = null;
    }
  }
  if (!index || !verifyIndex(index)) {
    buildIndex();
    rebuilt = true;
    try {
      index = JSON.parse(readFileSync(p.compiledIndex(), 'utf8'));
    } catch {
      index = { schema: 'raphael/index/v1', lessons: [] };
    }
  }
  return { lessons: index.lessons ?? [], rebuilt };
}
