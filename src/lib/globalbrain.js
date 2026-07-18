// The GLOBAL BRAIN pipe (Phase 17.6, §2.1 two-brain model).
//
//   GLOBAL (github.com/maheshaggarwal21/raphael, global-brain/, owner-curated)
//     -> seed at install (from the copy SHIPPED IN THE PACKAGE, zero network)
//     -> occasional down-sync in pulse (ONE pinned HTTPS URL pair, throttled,
//        hash-verified — invariant #5c)
//
// Trust model, stated honestly: the global brain is the owner's human-reviewed
// set (tier 'curated'). Its integrity anchor is the same as npm's: the pinned
// HTTPS source. Per-lesson sha256 (over canonical JSON, EOL-proof) catches
// corruption and partial fetches; the chokepoint (validateLesson) still runs
// on EVERY lesson before it touches the brain — invariant #1 has no
// exceptions, including this one. A global lesson NEVER overwrites or
// duplicates a local one (slug + id dedupe): local learning wins.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeLessonFile, parseLessonFile } from './frontmatter.js';
import { validateLesson } from './validate.js';
import { atomicWrite } from './files.js';
import { logEvent } from './events.js';
import { commitBrain } from './braingit.js';
import { buildIndex } from './compile.js';
import { fetchUrl } from './fetch.js';
import { p } from './paths.js';

// Invariant #5c: down-sync may touch EXACTLY these two URLs, nothing else.
export const GLOBAL_BRAIN_MANIFEST_URL = 'https://raw.githubusercontent.com/maheshaggarwal21/raphael/main/global-brain/manifest.json';
export const GLOBAL_BRAIN_LESSONS_URL = 'https://raw.githubusercontent.com/maheshaggarwal21/raphael/main/global-brain/lessons.json';
const SYNC_INTERVAL_MS = 7 * 86400000; // check weekly, not per-pulse

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

export function packagedGlobalBrainDir() {
  // src/lib/globalbrain.js -> <pkg>/global-brain
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'global-brain');
}

export function stateFile() {
  return path.join(p.state(), 'globalbrain.json');
}

export function readSyncState() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return { version: 0, last_check: 0, seeded_at: null };
  }
}

function writeSyncState(next) {
  atomicWrite(stateFile(), JSON.stringify(next));
}

export function readPackagedGlobalBrain(dir = packagedGlobalBrainDir()) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const lessons = JSON.parse(readFileSync(path.join(dir, 'lessons.json'), 'utf8'));
  return { manifest, lessons };
}

function activeSlugsAndIds() {
  const slugs = new Set();
  const ids = new Set();
  const root = p.lessons();
  if (!existsSync(root)) return { slugs, ids };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) {
        try {
          const { data } = parseLessonFile(readFileSync(full, 'utf8'));
          slugs.add(data.slug);
          ids.add(data.id);
        } catch { continue; }
      }
    }
  }
  return { slugs, ids };
}

// Activate a set of global lessons into the local brain. Every lesson:
// manifest-hash verified -> slug/id dedupe (local wins) -> chokepoint ->
// written ACTIVE with tier 'curated' (they passed the owner's human review
// upstream — that IS the human gate for this material, §2.1).
export function activateGlobalLessons({ manifest, lessons }, { origin, log = () => {} } = {}) {
  const bySlug = new Map(manifest.lessons.map((e) => [e.slug, e]));
  const { slugs, ids } = activeSlugsAndIds();
  const result = { activated: [], skipped: [] };

  for (const lesson of lessons) {
    const entry = bySlug.get(lesson.slug);
    if (!entry) {
      result.skipped.push({ slug: lesson.slug, why: 'not in the manifest' });
      continue;
    }
    if (sha(lesson) !== entry.sha256) {
      result.skipped.push({ slug: lesson.slug, why: 'hash mismatch vs manifest — refused' });
      continue;
    }
    if (slugs.has(lesson.slug) || ids.has(lesson.id)) {
      result.skipped.push({ slug: lesson.slug, why: 'already in the local brain (local wins)' });
      continue;
    }
    const data = { ...lesson, status: 'active' };
    const content = serializeLessonFile(data, '');
    const check = validateLesson(content);
    if (!check.ok) {
      result.skipped.push({ slug: lesson.slug, why: `chokepoint: ${check.errors.map((e) => e.code).join(', ')}` });
      continue;
    }
    const target = path.join(p.lessons(), data.category, `${data.slug}.${data.id.slice(-8)}.md`);
    if (existsSync(target)) {
      result.skipped.push({ slug: lesson.slug, why: 'target exists' });
      continue;
    }
    atomicWrite(target, content);
    slugs.add(data.slug);
    ids.add(data.id);
    logEvent({ event: 'global-brain-activated', id: data.id, slug: data.slug, category: data.category, origin, version: manifest.version });
    result.activated.push({ id: data.id, slug: data.slug });
    log(`  [global] ${data.slug} (${data.category}, curated)`);
  }

  if (result.activated.length > 0) {
    commitBrain(`global-brain ${origin} v${manifest.version}: ${result.activated.length} lesson(s)`);
    try { buildIndex(); } catch { /* lazily rebuilt */ }
  }
  return result;
}

// SEED — install-time copy from the version shipped inside the package.
// Zero network. Autopilot arise calls this; manual installs use `raph pack`.
export function seedGlobalBrain({ dir = packagedGlobalBrainDir(), log = () => {} } = {}) {
  if (!existsSync(path.join(dir, 'manifest.json'))) {
    return { activated: [], skipped: [], why: 'no packaged global brain found' };
  }
  const pack = readPackagedGlobalBrain(dir);
  const res = activateGlobalLessons(pack, { origin: 'seed', log });
  const state = readSyncState();
  writeSyncState({ ...state, version: Math.max(state.version, pack.manifest.version), seeded_at: new Date().toISOString() });
  return { ...res, version: pack.manifest.version };
}

// DOWN-SYNC — the weekly pulse check against the pinned GitHub manifest.
// Throttled; fetches the bundle only when the remote version is newer.
export async function syncGlobalBrain({ now = Date.now(), fetcher = fetchUrl, log = () => {} } = {}) {
  const state = readSyncState();
  if (now - (state.last_check ?? 0) < SYNC_INTERVAL_MS) {
    return { checked: false, why: 'checked recently' };
  }
  let manifest;
  try {
    const r = await fetcher(GLOBAL_BRAIN_MANIFEST_URL);
    manifest = JSON.parse(r.text);
  } catch (err) {
    // offline / GitHub down / blocked network: note the attempt, retry next week
    writeSyncState({ ...state, last_check: now });
    return { checked: true, updated: false, why: `manifest fetch failed (${err.message}) — retrying next week` };
  }
  writeSyncState({ ...state, last_check: now });
  if (!manifest || manifest.schema !== 'raphael/global-brain/v1' || !Number.isInteger(manifest.version)) {
    return { checked: true, updated: false, why: 'manifest malformed — refused' };
  }
  if (manifest.version <= (state.version ?? 0)) {
    return { checked: true, updated: false, why: `up to date (v${state.version})` };
  }
  let lessons;
  try {
    const r = await fetcher(GLOBAL_BRAIN_LESSONS_URL);
    lessons = JSON.parse(r.text);
  } catch (err) {
    return { checked: true, updated: false, why: `bundle fetch failed (${err.message})` };
  }
  if (!Array.isArray(lessons)) return { checked: true, updated: false, why: 'bundle malformed — refused' };

  const res = activateGlobalLessons({ manifest, lessons }, { origin: 'sync', log });
  writeSyncState({ ...readSyncState(), version: manifest.version, last_check: now });
  logEvent({ event: 'global-brain-sync', version: manifest.version, activated: res.activated.length, skipped: res.skipped.length });
  return { checked: true, updated: true, version: manifest.version, ...res };
}
