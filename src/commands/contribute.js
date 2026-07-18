// `raph contribute` — opt-in lesson sharing (Phase 11). Exports chosen ACTIVE
// lessons as shareable .md files: local traces stripped, full body re-scrubbed,
// re-validated through the chokepoint. Never bulk by default; you name each one.
//   raph contribute <id|slug...> [--out <dir>]
//   raph contribute list

import path from 'node:path';
import { readActiveLessons } from '../lib/freshness.js';
import {
  exportableLesson, renderContribution,
  buildBundle, listBundles, contributionEnabled, eligibleForBundle, setContribution
} from '../lib/contribute.js';
import { loadConfig } from '../lib/config.js';
import { atomicWrite } from '../lib/files.js';

export default async function contribute(args) {
  const lessons = readActiveLessons();

  if (!args[0] || args[0] === 'help') {
    console.log('raph contribute — share lessons, safely and on purpose');
    console.log('');
    console.log('Usage: raph contribute <id|slug...> [--out <dir>]   export named lessons');
    console.log('       raph contribute list                          show what you could share');
    console.log('       raph contribute on|off                        grant / withdraw the');
    console.log('                                                     contribution permission');
    console.log('       raph contribute bundle                        stage a bundle of new local');
    console.log('                                                     lessons for the global brain');
    console.log('                                                     (needs the contribution grant)');
    console.log('       raph contribute send                          show staged bundles + where');
    console.log('                                                     to submit them');
    console.log('');
    console.log('Each export strips project names, path globs, and evidence refs; re-scrubs');
    console.log('the full text for secrets; and re-validates through the same chokepoint');
    console.log('that guards the brain. Nothing is ever sent automatically.');
    return args[0] ? 0 : 1;
  }

  if (args[0] === 'on' || args[0] === 'off') {
    const r = setContribution(args[0] === 'on');
    if (r.enabled) {
      console.log(`SHARE  contribution granted (${r.granted}) — new local lessons may be bundled:`);
      console.log('       stripped, re-scrubbed, re-validated, then STAGED on this machine only.');
      console.log('       Sending a bundle is always your own action (raph contribute send).');
    } else {
      console.log('SHARE  contribution withdrawn — nothing leaves this machine.');
      console.log('       Already-staged bundles stay local; delete them any time (raph contribute send shows paths).');
    }
    return 0;
  }

  if (args[0] === 'bundle') {
    const cfg = loadConfig();
    if (!contributionEnabled(cfg)) {
      console.error('raph: contribution is not granted — enable it with "raph contribute on"');
      console.error('      (or the console\'s Settings tab). Nothing leaves this machine without');
      console.error('      that grant — and even with it, sending is always your own action.');
      return 1;
    }
    const res = buildBundle({ config: cfg, min: 1, log: (s) => console.log(s) });
    if (res.refused) {
      console.log(`raph: no bundle — ${res.refused}`);
      return 0;
    }
    for (const s of res.skipped) console.log(`  [skipped] ${s.slug} — ${s.why}`);
    console.log(`BUNDLE  ${res.count} lesson(s) -> ${res.staged}`);
    console.log('NEXT    raph contribute send');
    return 0;
  }

  if (args[0] === 'send') {
    const bundles = listBundles();
    if (bundles.length === 0) {
      const cfg = loadConfig();
      const n = contributionEnabled(cfg) ? eligibleForBundle().length : 0;
      console.log(`raph: no staged bundles${n ? ` (${n} lesson(s) eligible — "raph contribute bundle")` : ''}`);
      return 0;
    }
    console.log('Staged contribution bundles (scrubbed, chokepoint-validated, ready to share):\n');
    for (const b of bundles) {
      console.log(`  ${b.id}  ${b.count} lesson(s)  ${b.created ?? ''}`);
      console.log(`    ${b.file}`);
    }
    console.log(`
To submit: attach a bundle file to a new issue titled "contribution bundle" at
  https://github.com/maheshaggarwal21/raphael/issues/new
The maintainer reviews every lesson before anything enters the global brain.
(Sending is your action, in your browser — Raphael never uploads anything itself.)`);
    return 0;
  }

  if (args[0] === 'list') {
    if (lessons.length === 0) {
      console.log('raph: no active lessons yet');
      return 0;
    }
    for (const l of lessons) console.log(`${l.slug}  [${l.category}·${l.severity}]  ${l.title}`);
    console.log(`\n${lessons.length} active lesson(s) — export one with "raph contribute <slug>"`);
    return 0;
  }

  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1] ?? '.') : path.resolve('raphael-contrib');
  // Only skip the value that FOLLOWS --out; when --out is absent (outIdx === -1)
  // there is no such value, and `i !== outIdx + 1` would wrongly drop args[0].
  const refs = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

  let failed = 0;
  for (const ref of refs) {
    const lesson = lessons.find((l) => l.id === ref || l.slug === ref);
    if (!lesson) {
      console.error(`raph: E-NOTFOUND: no active lesson "${ref}" (see "raph contribute list")`);
      failed++;
      continue;
    }
    try {
      const { data, content } = exportableLesson(lesson);
      const file = path.join(outDir, `${data.slug}.md`);
      atomicWrite(file, content);
      console.log(renderContribution(data));
      console.log(`       -> ${file}`);
    } catch (err) {
      console.error(`raph: ${err.message}`);
      failed++;
    }
  }
  return failed ? 1 : 0;
}
