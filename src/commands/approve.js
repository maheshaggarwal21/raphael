import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { listCandidates, resolveRef, needsConfirmation } from '../lib/queue.js';
import { serializeLessonFile, parseLessonFile } from '../lib/frontmatter.js';
import { validateLesson } from '../lib/validate.js';
import { atomicWrite } from '../lib/files.js';
import { logEvent } from '../lib/events.js';
import { commitBrain } from '../lib/braingit.js';
import { p } from '../lib/paths.js';

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

export default async function approve(args) {
  const confirmed = args.includes('--confirmed');
  const refs = args.filter((a) => !a.startsWith('--'));
  if (refs.length === 0) {
    console.error('raph: usage: raph approve <n|slug|id...> [--confirmed]');
    return 1;
  }

  const items = listCandidates();
  let failed = 0;
  let approvedCount = 0;

  for (const ref of refs) {
    let item;
    try {
      item = resolveRef(items, ref);
    } catch (err) {
      const already = findActiveByRef(ref);
      if (already) {
        console.log(`raph: "${ref}" is already active (${already.file}) — nothing to do`);
        continue;
      }
      console.error(`raph: ${err.message}`);
      failed++;
      continue;
    }

    if (needsConfirmation(item)) {
      const kind = item.quarantined ? 'quarantined' : 'security-category';
      if (refs.length > 1) {
        console.error(`raph: REFUSED "${ref}" — ${kind} candidates cannot be batch-approved; approve it alone after reading the full body (raph show ${ref})`);
        failed++;
        continue;
      }
      if (!confirmed) {
        console.error(`raph: REFUSED "${ref}" — ${kind} candidates need a full-body review first:`);
        console.error(`        raph show ${ref}`);
        console.error(`        raph approve ${ref} --confirmed`);
        failed++;
        continue;
      }
    }

    const data = { ...item.data, status: 'active' };
    if (activeSlugExists(data.slug)) {
      console.error(`raph: E-SLUG: an active lesson with slug "${data.slug}" already exists — edit the candidate's slug first`);
      failed++;
      continue;
    }

    // validate-on-write, always: approval is a write path into the brain
    const content = serializeLessonFile(data, item.body);
    const check = validateLesson(content);
    if (!check.ok) {
      console.error(`raph: E-CANDIDATE: "${ref}" no longer passes validation: ${check.errors.map((e) => e.code).join(', ')}`);
      failed++;
      continue;
    }

    const idSuffix = data.id.slice(-8);
    const target = path.join(p.lessons(), data.category, `${data.slug}.${idSuffix}.md`);
    atomicWrite(target, content);
    rmSync(item.file, { force: true });
    logEvent({ event: 'approved', id: data.id, slug: data.slug, category: data.category, from: item.quarantined ? 'quarantine' : 'candidates' });
    approvedCount++;
    console.log(`APPROVED  ${data.slug} -> ${target}`);
  }

  if (approvedCount > 0) commitBrain(`approve: ${approvedCount} lesson(s)`);
  return failed > 0 ? 1 : 0;
}
