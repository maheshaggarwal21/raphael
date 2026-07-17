// `raph stats` — the self-use report (Phase 10). Reads the append-only audit
// log + the compiled index and prints token-cost, retrieval-miss (never-fired
// lessons), and a false-fire proxy. Zero network, read-only.

import { loadIndex } from '../lib/compile.js';
import { readEvents } from '../lib/events.js';
import { computeStats, renderStats } from '../lib/stats.js';

export default async function stats(args = []) {
  const { lessons } = loadIndex();
  const report = computeStats(readEvents(), lessons);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(renderStats(report));
  return 0;
}
