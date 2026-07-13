// `raph search <terms>` — the pull side of the recall loop. Runs the exact
// same deterministic scorer the hooks use, so what you see here is what a
// hook would rank. Also the everyday way to force an index rebuild: loading
// the index re-verifies every content hash.

import path from 'node:path';
import { loadIndex } from '../lib/compile.js';
import { detectStacks } from '../lib/stacks.js';
import { rank, extractPaths } from '../lib/match.js';

export default async function search(args) {
  const json = args.includes('--json');
  const aIdx = args.indexOf('--audience');
  const audience = aIdx >= 0 ? args[aIdx + 1] : undefined;
  const valueIdx = aIdx >= 0 ? aIdx + 1 : -1; // -1, never 0: indexOf misses must not eat args[0]
  const terms = args
    .filter((a, i) => !a.startsWith('--') && i !== valueIdx)
    .join(' ')
    .trim();

  if (!terms) {
    console.error('raph: usage: raph search <terms> [--audience <agent>] [--json]');
    return 1;
  }

  const { lessons } = loadIndex();
  const ctx = {
    text: terms,
    paths: extractPaths(terms),
    stacks: detectStacks(process.cwd()),
    project: path.basename(process.cwd()), // pinned-to-other-projects lessons stay hidden
    agent: audience,
    injected: new Set()
  };
  const results = rank(lessons, ctx, 0.5);

  if (json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          id: r.entry.id,
          slug: r.entry.slug,
          severity: r.entry.severity,
          category: r.entry.category,
          score: Number(r.score.toFixed(2)),
          reasons: r.reasons,
          headline: r.entry.injection?.headline ?? r.entry.title
        })),
        null,
        2
      )
    );
    return 0;
  }

  if (results.length === 0) {
    console.log(`no matches for "${terms}" — the brain has ${lessons.length} active lesson(s)`);
    return 0;
  }

  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.entry.slug}  [${r.entry.severity}/${r.entry.category}]  score ${r.score.toFixed(1)}`);
    console.log(`   ${r.entry.injection?.headline ?? r.entry.title}`);
    console.log(`   matched: ${r.reasons.join(', ')}   (raph show ${r.entry.slug})`);
  });
  return 0;
}
