// `raph why` — the anti-spooky-action command. Shows exactly what the hooks
// injected, when, into which session, matched on what, and what it cost.
// Everything here is read straight from the append-only audit log.

import { existsSync, readFileSync } from 'node:fs';
import { p } from '../lib/paths.js';

export default async function why(args) {
  const lIdx = args.indexOf('--last');
  const last = lIdx >= 0 ? Math.max(1, Number(args[lIdx + 1]) || 10) : 10;

  if (!existsSync(p.events())) {
    console.log('no injections recorded yet — nothing has been added to any session');
    return 0;
  }

  const injections = [];
  for (const line of readFileSync(p.events(), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.event === 'injected') injections.push(e);
    } catch {
      continue;
    }
  }

  if (injections.length === 0) {
    console.log('no injections recorded yet — nothing has been added to any session');
    return 0;
  }

  const shown = injections.slice(-last);
  console.log(`last ${shown.length} injection(s) of ${injections.length} total (raph off disables them):\n`);
  for (const e of shown) {
    console.log(`${e.ts}  ${e.hook}  session=${e.session_id}  project=${e.project}  ~${e.tokens} tokens${e.cap_reached ? '  [session cap reached: high/critical only]' : ''}`);
    for (const l of e.lessons ?? []) {
      console.log(`    ${l.slug}  [${l.severity}]  score ${l.score}  (${(l.reasons ?? []).join(', ')})`);
    }
  }
  return 0;
}
