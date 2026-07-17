// Contribute (Phase 11): turn an ACTIVE lesson into a SHAREABLE file — opt-in,
// one lesson at a time, never a bulk default. Sharing is invariant #6's opt-in
// made concrete: the export strips everything that ties a lesson to this machine
// or its projects, re-runs the secret scrubber over the FULL body (belt and
// suspenders — lessons were scrubbed on the way in), and then re-validates the
// result through validateLesson() so what leaves the brain is exactly as clean
// as what may enter one. A lesson that fails the chokepoint after scrubbing is
// refused, not "fixed" silently.

import { scrubSecrets } from './scrub.js';
import { validateLesson } from './validate.js';
import { serializeLessonFile } from './frontmatter.js';

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
