// `raph decide` — record and list durable decisions (Phase 16.8b).
//   raph decide "<what was decided>" [--why "<rationale>"] [--supersedes dec_x] [--tag a,b]
//   raph decide list [--json]
// Decisions are surfaced at session start so settled calls are not re-litigated.

import { recordDecision, readDecisions, activeDecisions, renderDecisions } from '../lib/decisions.js';

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

export default async function decide(args) {
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;

  if (sub === 'list' || (!sub && args.includes('--json'))) {
    const records = readDecisions();
    if (args.includes('--json')) {
      console.log(JSON.stringify({ active: activeDecisions(records), all: records }, null, 2));
      return 0;
    }
    console.log(renderDecisions(records));
    return 0;
  }

  if (!sub) {
    console.error('raph: usage: raph decide "<decision>" [--why "..."] [--supersedes dec_x] [--tag a,b]  |  raph decide list');
    return 1;
  }

  const title = sub; // the first non-flag token is the decision itself
  const rationale = flagValue(args, '--why') ?? '';
  const supersedes = flagValue(args, '--supersedes');
  const tagCsv = flagValue(args, '--tag');
  const tags = tagCsv ? tagCsv.split(',').map((t) => t.trim()).filter(Boolean) : [];

  try {
    const rec = recordDecision({ title, rationale, supersedes: supersedes ? [supersedes] : [], tags });
    console.log(`raph: recorded decision ${rec.id.slice(0, 12)}… — ${rec.title}`);
    if (rec.supersedes.length) console.log(`raph: supersedes ${rec.supersedes.join(', ')}`);
    return 0;
  } catch (err) {
    console.error(`raph: ${err.message}`);
    return 1;
  }
}
