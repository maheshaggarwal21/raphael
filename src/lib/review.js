// The approve/reject engine, shared by the CLI verbs and the web console
// (ARCHITECTURE §14: a console button must call the SAME function as the CLI
// verb — all review policy lives here, both faces are thin skins over it).
//
// Policy enforced HERE, not in any caller:
//   - security-category and quarantined candidates cannot be batch-approved
//     and need explicit confirmation after a full-body review
//   - approval is a write path into the brain, so it re-runs validateLesson()
//   - rejects tombstone into distill's rejection memory (180-day suppression)

import { existsSync, readFileSync, rmSync, readdirSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { listCandidates, resolveRef, needsConfirmation } from './queue.js';
import { serializeLessonFile, parseLessonFile } from './frontmatter.js';
import { validateLesson } from './validate.js';
import { atomicWrite } from './files.js';
import { logEvent } from './events.js';
import { commitBrain } from './braingit.js';
import { buildIndex } from './compile.js';
import { p } from './paths.js';

function activeSlugExists(slug) {
  const root = p.lessons();
  if (!existsSync(root)) return false;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(full)) return true;
      } else if (entry.name.endsWith('.md')) {
        try {
          if (parseLessonFile(readFileSync(full, 'utf8')).data.slug === slug) return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  };
  return walk(root);
}

// "Already active" check so a repeated approve is a friendly no-op, not an error.
function findActiveByRef(ref) {
  const root = p.lessons();
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) {
        try {
          const { data } = parseLessonFile(readFileSync(full, 'utf8'));
          if (data.id === ref || data.slug === ref) return { file: full, data };
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

// Approve a set of refs. Returns { results, approved, failed } where every
// result is { ref, outcome, message, slug?, target? } and outcome is one of:
// approved | already-active | not-found | refused-batch | refused-unconfirmed
// | slug-collision | invalid. "already-active" is a no-op, not a failure.
export function approveRefs(refs, { confirmed = false } = {}) {
  const items = listCandidates();
  const batch = refs.length > 1;
  const results = [];
  let approved = 0;

  for (const ref of refs) {
    let item;
    try {
      item = resolveRef(items, ref);
    } catch (err) {
      const already = findActiveByRef(ref);
      if (already) {
        results.push({ ref, outcome: 'already-active', slug: already.data.slug, message: `"${ref}" is already active (${already.file}) — nothing to do` });
        continue;
      }
      results.push({ ref, outcome: 'not-found', message: err.message });
      continue;
    }

    if (needsConfirmation(item)) {
      const kind = item.quarantined ? 'quarantined' : 'security-category';
      if (batch) {
        results.push({ ref, outcome: 'refused-batch', slug: item.data.slug, kind, message: `REFUSED "${ref}" — ${kind} candidates cannot be batch-approved; approve it alone after reading the full body (raph show ${ref})` });
        continue;
      }
      if (!confirmed) {
        results.push({ ref, outcome: 'refused-unconfirmed', slug: item.data.slug, kind, message: `REFUSED "${ref}" — ${kind} candidates need a full-body review first` });
        continue;
      }
    }

    const data = { ...item.data, status: 'active' };
    if (activeSlugExists(data.slug)) {
      results.push({ ref, outcome: 'slug-collision', slug: data.slug, message: `E-SLUG: an active lesson with slug "${data.slug}" already exists — edit the candidate's slug first` });
      continue;
    }

    // validate-on-write, always: approval is a write path into the brain
    const content = serializeLessonFile(data, item.body);
    const check = validateLesson(content);
    if (!check.ok) {
      results.push({ ref, outcome: 'invalid', slug: data.slug, message: `E-CANDIDATE: "${ref}" no longer passes validation: ${check.errors.map((e) => e.code).join(', ')}` });
      continue;
    }

    const idSuffix = data.id.slice(-8);
    const target = path.join(p.lessons(), data.category, `${data.slug}.${idSuffix}.md`);
    atomicWrite(target, content);
    rmSync(item.file, { force: true });
    logEvent({ event: 'approved', id: data.id, slug: data.slug, category: data.category, from: item.quarantined ? 'quarantine' : 'candidates' });
    approved++;
    results.push({ ref, outcome: 'approved', slug: data.slug, target, message: `APPROVED  ${data.slug} -> ${target}` });
  }

  if (approved > 0) {
    commitBrain(`approve: ${approved} lesson(s)`);
    // silent index rebuild (§6): hash verification would catch it lazily
    // anyway, this just saves the first hook the rebuild cost
    try { buildIndex(); } catch { /* next loadIndex() rebuilds */ }
  }
  const failed = results.filter((r) => r.outcome !== 'approved' && r.outcome !== 'already-active').length;
  return { results, approved, failed };
}

// Reject a set of refs. Returns { results, rejected, failed }; outcomes are
// rejected | not-found. Every reject tombstones into rejection memory.
export function rejectRefs(refs, { reason } = {}) {
  const items = listCandidates();
  const results = [];
  let rejected = 0;
  let fromQuarantine = 0;

  for (const ref of refs) {
    let item;
    try {
      item = resolveRef(items, ref);
    } catch (err) {
      results.push({ ref, outcome: 'not-found', message: err.message });
      continue;
    }

    // Tombstone feeds distill's rejection memory (same shape it reads):
    // suppressions are similarity-matched on title+lesson and expire after 180d.
    const tombstone = {
      text: `${item.data.title}\n${item.data.lesson}`,
      slug: item.data.slug,
      id: item.data.id,
      reason: reason ?? null,
      rejected_at: new Date().toISOString()
    };
    mkdirSync(path.dirname(p.rejectedMemory()), { recursive: true });
    appendFileSync(p.rejectedMemory(), JSON.stringify(tombstone) + '\n', 'utf8');
    rmSync(item.file, { force: true });
    if (item.quarantined) fromQuarantine++;
    logEvent({ event: 'rejected', id: item.data.id, slug: item.data.slug, reason: reason ?? null });
    rejected++;
    results.push({ ref, outcome: 'rejected', slug: item.data.slug, message: `REJECTED  ${item.data.slug}${reason ? ` (${reason})` : ''} — similar candidates will be auto-suppressed for 180 days` });
  }

  if (fromQuarantine > 0) commitBrain(`reject: ${fromQuarantine} quarantined candidate(s)`);
  const failed = results.filter((r) => r.outcome !== 'rejected').length;
  return { results, rejected, failed };
}
