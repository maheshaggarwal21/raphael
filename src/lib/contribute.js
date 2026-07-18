// Contribute (Phase 11): turn an ACTIVE lesson into a SHAREABLE file — opt-in,
// one lesson at a time, never a bulk default. Sharing is invariant #6's opt-in
// made concrete: the export strips everything that ties a lesson to this machine
// or its projects, re-runs the secret scrubber over the FULL body (belt and
// suspenders — lessons were scrubbed on the way in), and then re-validates the
// result through validateLesson() so what leaves the brain is exactly as clean
// as what may enter one. A lesson that fails the chokepoint after scrubbing is
// refused, not "fixed" silently.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { scrubSecrets } from './scrub.js';
import { validateLesson } from './validate.js';
import { serializeLessonFile } from './frontmatter.js';
import { readActiveLessons } from './freshness.js';
import { atomicWrite } from './files.js';
import { logEvent } from './events.js';
import { ulid } from './ulid.js';
import { p } from './paths.js';

// Fields whose text leaves the machine — every one passes the scrubber again.
function scrubText(s) {
  return typeof s === 'string' ? scrubSecrets(s).text : s;
}

// Build the shareable form of one active lesson. Pure: lesson in, {data, content}
// out (or throws E-CONTRIBUTE). Strips local traces:
//   - scope.projects (local project names) and triggers.paths (local path globs)
//   - evidence.refs (ULIDs of evidence records that only exist on this machine)
//   - provenance keeps kind + tier but drops nothing else it never had (no URLs
//     exist anywhere in a valid lesson — the chokepoint enforces that).
export function exportableLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') throw new Error('E-CONTRIBUTE: no lesson given');
  if (lesson.status !== 'active') {
    throw new Error(`E-CONTRIBUTE: only ACTIVE lessons can be contributed (this one is "${lesson.status ?? 'unknown'}")`);
  }

  const data = JSON.parse(JSON.stringify(lesson));

  // strip local traces
  data.scope = { ...data.scope, projects: [] };
  data.triggers = { ...data.triggers, paths: [] };
  if (data.evidence) delete data.evidence.refs;

  // scrub every text field that leaves the machine
  data.title = scrubText(data.title);
  data.lesson = scrubText(data.lesson);
  if (data.counter_indications) data.counter_indications = scrubText(data.counter_indications);
  if (data.injection?.headline) data.injection.headline = scrubText(data.injection.headline);
  if (Array.isArray(data.triggers?.keywords)) data.triggers.keywords = data.triggers.keywords.map(scrubText);

  const content = serializeLessonFile(data);
  const check = validateLesson(content);
  if (!check.ok) {
    const why = check.errors.map((e) => `${e.code} ${e.msg}`).join('; ');
    throw new Error(`E-CONTRIBUTE: refused — the export does not pass the chokepoint (${why})`);
  }
  return { data, content, quarantine: check.quarantine };
}

export function renderContribution(data) {
  return [
    `SHARE  ${data.slug}  [${data.category}·${data.severity}]`,
    `       ${data.injection?.headline ?? data.title}`,
    `       evidence: ${data.evidence?.observations ?? 0} observation(s) — refs and project names stripped, body re-scrubbed`
  ].join('\n');
}

// ---------- 17.7: contribution BUNDLES (up-sync, permission #2) ----------
//
// With the install-time contribution grant (§2.2 permission 2), locally-learned
// lessons are occasionally batched into a bundle for the GLOBAL brain. Facts
// that keep this safe and honest:
//   - permission #2 off (the default) = buildBundle refuses; nothing is even
//     staged. Nothing EVER leaves the machine without the grant.
//   - every lesson passes exportableLesson (strip local traces -> re-scrub ->
//     re-validate); one that fails is SKIPPED, never "fixed" silently
//   - tier 'curated' is excluded — those came DOWN from the global brain;
//     sending them back up would be noise
//   - v0 send is the USER's action (`raph contribute send` shows the bundle +
//     where to attach it); the v1 serverless ingest endpoint replaces that
//     click later. Nothing in pulse performs any network write — bundles only
//     ever STAGE locally (invariant #5 untouched).

export const BUNDLE_MIN_LESSONS = 3;
export const BUNDLE_INTERVAL_MS = 7 * 86400000;

export function bundlesDir() {
  return path.join(p.home(), 'staged', 'bundles');
}

export function contributedStateFile() {
  return path.join(p.state(), 'contributed.json');
}

export function readContributedState() {
  try {
    return JSON.parse(readFileSync(contributedStateFile(), 'utf8'));
  } catch {
    return { bundled: {}, last_bundle: 0 };
  }
}

export function contributionEnabled(cfg) {
  return cfg?.contribute?.enabled === true;
}

// Locally-learned active lessons not yet bundled.
export function eligibleForBundle(state = readContributedState()) {
  return readActiveLessons().filter((l) =>
    l.provenance?.tier !== 'curated' && !state.bundled[l.id]
  );
}

// Build + stage one bundle. Returns { staged: path, count, skipped } or
// { refused: why }. Pure local write — sending is a separate, user act.
export function buildBundle({ config, now = Date.now(), min = BUNDLE_MIN_LESSONS, log = () => {} } = {}) {
  if (!contributionEnabled(config)) {
    return { refused: 'contribution is not granted (raph arise --autopilot --contribute, or the console)' };
  }
  const state = readContributedState();
  const eligible = eligibleForBundle(state);
  if (eligible.length < min) {
    return { refused: `only ${eligible.length} new lesson(s) — bundles start at ${min}` };
  }

  const lessons = [];
  const skipped = [];
  for (const l of eligible) {
    try {
      lessons.push(exportableLesson(l).data);
    } catch (err) {
      skipped.push({ slug: l.slug, why: err.message });
    }
  }
  if (lessons.length === 0) return { refused: 'every eligible lesson was refused by the export chokepoint', skipped };

  const id = ulid();
  const file = path.join(bundlesDir(), `bundle-${id}.json`);
  atomicWrite(file, JSON.stringify({
    schema: 'raphael/contribution-bundle/v1',
    id,
    created: new Date(now).toISOString(),
    count: lessons.length,
    lessons
  }, null, 1));
  const nextState = { ...state, last_bundle: now };
  for (const l of lessons) nextState.bundled[l.id] = new Date(now).toISOString();
  atomicWrite(contributedStateFile(), JSON.stringify(nextState));
  logEvent({ event: 'bundle-staged', bundle: id, count: lessons.length, skipped: skipped.length });
  log(`  [bundle] staged ${lessons.length} lesson(s) -> ${file}`);
  return { staged: file, id, count: lessons.length, skipped };
}

export function listBundles() {
  const dir = bundlesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('bundle-') && f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        const b = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        return { file: path.join(dir, f), id: b.id, created: b.created, count: b.count };
      } catch {
        return { file: path.join(dir, f), id: f, created: null, count: 0 };
      }
    });
}

// The occasional autopilot trigger (called from pulse): weekly at most, only
// with enough new material. Never a network act.
export function maybeBundleContributions({ config, now = Date.now(), log = () => {} } = {}) {
  if (!contributionEnabled(config)) return { built: false, why: 'not granted' };
  const state = readContributedState();
  if (now - (state.last_bundle ?? 0) < BUNDLE_INTERVAL_MS) return { built: false, why: 'bundled recently' };
  const res = buildBundle({ config, now, log });
  if (res.refused) return { built: false, why: res.refused };
  return { built: true, ...res };
}
