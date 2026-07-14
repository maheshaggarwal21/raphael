// `raph stats` — the self-use report (Phase 10). Reads the append-only audit
// log + the compiled index and prints token-cost, retrieval-miss (never-fired
// lessons), and a false-fire proxy. Zero network, read-only.

import { existsSync, readFileSync } from 'node:fs';
import { p } from '../lib/paths.js';
import { loadIndex } from '../lib/compile.js';
import { computeStats, renderStats } from '../lib/stats.js';

export default async function stats(args = []) {
  const events = [];
  if (existsSync(p.events())) {
    for (const line of readFileSync(p.events(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip a corrupt line, keep going */ }
    }
  }

  const { lessons } = loadIndex();
  const report = computeStats(events, lessons);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(renderStats(report));
  return 0;
}
