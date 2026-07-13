import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { listCandidates } from '../lib/queue.js';
import { parseLessonFile } from '../lib/frontmatter.js';
import { findEvidence } from '../lib/evidence.js';
import { p } from '../lib/paths.js';

function findLessonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findLessonFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Resolves across the queue (numbers valid) AND the active brain (slug/id).
function resolve(ref) {
  const items = listCandidates();
  const asNum = Number(ref);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= items.length) {
    const it = items[asNum - 1];
    return { file: it.file, data: it.data, where: it.quarantined ? 'quarantine' : 'queue' };
  }
  const inQueue = items.find((it) => it.name === ref || it.data.id === ref || it.data.slug === ref);
  if (inQueue) return { file: inQueue.file, data: inQueue.data, where: inQueue.quarantined ? 'quarantine' : 'queue' };
  for (const file of findLessonFiles(p.lessons())) {
    try {
      const { data } = parseLessonFile(readFileSync(file, 'utf8'));
      if (data.id === ref || data.slug === ref) return { file, data, where: 'active' };
    } catch {
      continue;
    }
  }
  return null;
}

export default async function show(args) {
  const withProvenance = args.includes('--provenance');
  const ref = args.find((a) => !a.startsWith('--'));
  if (!ref) {
    console.error('raph: usage: raph show <n|slug|id> [--provenance]');
    return 1;
  }

  const hit = resolve(ref);
  if (!hit) {
    console.error(`raph: E-NOTFOUND: "${ref}" matches nothing in the queue or the active brain`);
    return 1;
  }

  console.log(`# ${hit.where.toUpperCase()}  ${hit.file}\n`);
  console.log(readFileSync(hit.file, 'utf8'));

  if (withProvenance) {
    const refs = hit.data.evidence?.refs ?? [];
    if (refs.length === 0) {
      console.log('--- provenance: no evidence records (manual note)');
    }
    for (const evId of refs) {
      const ev = findEvidence(evId);
      if (!ev) {
        console.log(`--- provenance ${evId}: record not found`);
        continue;
      }
      console.log(`--- provenance ${evId} [${ev.kind}] ${ev.observed_at} project=${ev.project}`);
      if (ev.source?.path) console.log(`    source: ${ev.source.path}#L${ev.source.line_span?.join('-') ?? '?'}`);
      if (ev.excerpt) console.log(`    excerpt: ${ev.excerpt.slice(0, 400)}`);
    }
  }
  return 0;
}
