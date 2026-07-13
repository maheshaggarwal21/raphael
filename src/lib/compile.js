// The compiled index: one small JSON file the hooks read instead of parsing
// every lesson on every prompt. Integrity rule (threat model): the index is
// verified against lesson-file CONTENT HASHES before use, not mtime — a
// tampered or stale index never injects. On any mismatch it silently rebuilds
// from the lesson files, and every lesson re-passes the validation chokepoint
// on the way in (a hand-edited lesson that no longer validates drops out).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    seen.push({ file: relToLessons(file), hash: contentHash(file) });
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
      file: relToLessons(file),
      hash: contentHash(file)
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
export function verifyIndex(index) {
  if (!index || index.schema !== 'raphael/index/v1' || !Array.isArray(index.lessons)) return false;
  if (!Array.isArray(index.built_files)) return false;
  const onDisk = lessonFiles().map(relToLessons);
  const built = new Map(index.built_files.map((e) => [e.file, e.hash]));
  if (onDisk.length !== built.size) return false;
  for (const rel of onDisk) {
    const expected = built.get(rel);
    if (expected === undefined) return false;
    const full = path.join(p.lessons(), ...rel.split('/'));
    if (contentHash(full) !== expected) return false;
  }
  return true;
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
