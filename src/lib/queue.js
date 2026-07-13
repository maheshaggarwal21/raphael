// The review queue: pending candidates (normal + quarantined) with stable,
// deterministic ordering so "approve 2" means the same thing queue just printed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseLessonFile } from './frontmatter.js';
import { p } from './paths.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export function listCandidates() {
  const items = [];
  for (const [dir, quarantined] of [
    [p.candidates(), false],
    [p.quarantine(), true]
  ]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(dir, name);
      try {
        const { data, body } = parseLessonFile(readFileSync(file, 'utf8'));
        items.push({ file, name: name.replace(/\.md$/, ''), quarantined, data, body });
      } catch {
        // unparseable candidates are doctor's problem; never crash the queue
      }
    }
  }
  items.sort((a, b) => {
    const sev = (SEVERITY_RANK[a.data.severity] ?? 9) - (SEVERITY_RANK[b.data.severity] ?? 9);
    if (sev !== 0) return sev;
    const slug = String(a.data.slug).localeCompare(String(b.data.slug));
    if (slug !== 0) return slug;
    return a.name.localeCompare(b.name);
  });
  return items;
}

// A ref may be a queue number (1-based), a candidate file name (C-xxxx),
// a slug, or a lesson id (les_...).
export function resolveRef(items, ref) {
  const asNum = Number(ref);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= items.length) return items[asNum - 1];
  const found = items.find(
    (it) => it.name === ref || it.data.id === ref || it.data.slug === ref
  );
  if (!found) {
    throw new Error(`E-NOTFOUND: "${ref}" is not in the review queue (run "raph queue" for current numbers)`);
  }
  return found;
}

// True when this item needs the heavyweight path: full-body review, one at a
// time, explicit confirmation — per the threat model, these are exactly the
// candidates an attacker would try to sneak through a fast batch approve.
export function needsConfirmation(item) {
  return item.quarantined || item.data.category === 'security';
}
