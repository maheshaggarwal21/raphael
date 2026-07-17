// `raph optimize` — the optimizer loop's report (Phase 14 meta layer). Aggregates
// the health engines into one actionable pruning + coverage screen. Read-only.

import { buildOptimization, renderOptimization } from '../lib/optimizer.js';
import { readActiveLessons } from '../lib/freshness.js';
import { readEvents } from '../lib/events.js';

export default async function optimize(args) {
  const asJson = args.includes('--json');
  const rep = buildOptimization({ lessons: readActiveLessons(), events: readEvents() });
  if (asJson) {
    console.log(JSON.stringify(rep, null, 2));
    return 0;
  }
  console.log(renderOptimization(rep));
  return 0;
}
