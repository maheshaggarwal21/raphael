// Thin CLI skin over the shared review engine (src/lib/review.js) — the web
// console's approve button calls the exact same approveRefs().

import { approveRefs } from '../lib/review.js';

export default async function approve(args) {
  const confirmed = args.includes('--confirmed');
  const refs = args.filter((a) => !a.startsWith('--'));
  if (refs.length === 0) {
    console.error('raph: usage: raph approve <n|slug|id...> [--confirmed]');
    return 1;
  }

  const { results, failed } = approveRefs(refs, { confirmed });
  for (const r of results) {
    if (r.outcome === 'approved') {
      console.log(r.message);
    } else if (r.outcome === 'already-active') {
      console.log(`raph: ${r.message}`);
    } else if (r.outcome === 'refused-unconfirmed') {
      console.error(`raph: ${r.message}:`);
      console.error(`        raph show ${r.ref}`);
      console.error(`        raph approve ${r.ref} --confirmed`);
    } else {
      console.error(`raph: ${r.message}`);
    }
  }
  return failed > 0 ? 1 : 0;
}
