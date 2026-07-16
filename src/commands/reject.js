// Thin CLI skin over the shared review engine (src/lib/review.js) — the web
// console's reject button calls the exact same rejectRefs().

import { rejectRefs } from '../lib/review.js';

export default async function reject(args) {
  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  const valueIdx = reasonIdx >= 0 ? reasonIdx + 1 : -1; // -1, never 0: indexOf misses must not eat args[0]
  const refs = args.filter((a, i) => !a.startsWith('--') && i !== valueIdx);
  if (refs.length === 0) {
    console.error('raph: usage: raph reject <n|slug|id...> [--reason "..."]');
    return 1;
  }

  const { results, failed } = rejectRefs(refs, { reason });
  for (const r of results) {
    if (r.outcome === 'rejected') console.log(r.message);
    else console.error(`raph: ${r.message}`);
  }
  return failed > 0 ? 1 : 0;
}
