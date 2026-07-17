// `raph retire <id|slug...>` — retire an ACTIVE lesson that no longer holds
// (Phase 16.6b). Thin skin over the shared review engine; a console button would
// call the same retireRefs(). Retiring is irreversible, so it demands --confirmed
// after the engine shows you exactly what would go.

import { retireRefs } from '../lib/review.js';

export default async function retire(args) {
  const confirmed = args.includes('--confirmed');
  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  const reasonValueIdx = reasonIdx >= 0 ? reasonIdx + 1 : -1;
  const refs = args.filter((a, i) => !a.startsWith('--') && i !== reasonValueIdx);

  if (refs.length === 0) {
    console.error('raph: usage: raph retire <id|slug...> [--reason "..."] --confirmed');
    return 1;
  }

  const { results, retired, failed } = retireRefs(refs, { confirmed, reason });
  for (const r of results) {
    if (r.outcome === 'retired') console.log(r.message);
    else console.error(`raph: ${r.message}`);
  }
  if (!confirmed && results.some((r) => r.outcome === 'refused-unconfirmed')) {
    console.error('raph: nothing retired — add --confirmed once you have reviewed the above.');
  }
  return failed > 0 ? 1 : 0;
}
