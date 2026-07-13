import { rmSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { listCandidates, resolveRef } from '../lib/queue.js';
import { logEvent } from '../lib/events.js';
import { commitBrain } from '../lib/braingit.js';
import { p } from '../lib/paths.js';

export default async function reject(args) {
  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  const valueIdx = reasonIdx >= 0 ? reasonIdx + 1 : -1; // -1, never 0: indexOf misses must not eat args[0]
  const refs = args.filter((a, i) => !a.startsWith('--') && i !== valueIdx);
  if (refs.length === 0) {
    console.error('raph: usage: raph reject <n|slug|id...> [--reason "..."]');
    return 1;
  }

  const items = listCandidates();
  let failed = 0;
  let rejectedFromQuarantine = 0;

  for (const ref of refs) {
    let item;
    try {
      item = resolveRef(items, ref);
    } catch (err) {
      console.error(`raph: ${err.message}`);
      failed++;
      continue;
    }

    // Tombstone feeds distill's rejection memory (same shape it reads):
    // suppressions are similarity-matched on title+lesson and expire after 180d.
    const tombstone = {
      text: `${item.data.title}\n${item.data.lesson}`,
      slug: item.data.slug,
      id: item.data.id,
      reason: reason ?? null,
      rejected_at: new Date().toISOString()
    };
    mkdirSync(path.dirname(p.rejectedMemory()), { recursive: true });
    appendFileSync(p.rejectedMemory(), JSON.stringify(tombstone) + '\n', 'utf8');
    rmSync(item.file, { force: true });
    if (item.quarantined) rejectedFromQuarantine++;
    logEvent({ event: 'rejected', id: item.data.id, slug: item.data.slug, reason: reason ?? null });
    console.log(`REJECTED  ${item.data.slug}${reason ? ` (${reason})` : ''} — similar candidates will be auto-suppressed for 180 days`);
  }

  if (rejectedFromQuarantine > 0) commitBrain(`reject: ${rejectedFromQuarantine} quarantined candidate(s)`);
  return failed > 0 ? 1 : 0;
}
