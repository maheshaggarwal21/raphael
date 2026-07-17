// `raph contribute` — opt-in lesson sharing (Phase 11). Exports chosen ACTIVE
// lessons as shareable .md files: local traces stripped, full body re-scrubbed,
// re-validated through the chokepoint. Never bulk by default; you name each one.
//   raph contribute <id|slug...> [--out <dir>]
//   raph contribute list

import path from 'node:path';
import { readActiveLessons } from '../lib/freshness.js';
import { exportableLesson, renderContribution } from '../lib/contribute.js';
import { atomicWrite } from '../lib/files.js';

export default async function contribute(args) {
  const lessons = readActiveLessons();

  if (!args[0] || args[0] === 'help') {
    console.log('raph contribute — share a lesson, safely and on purpose');
    console.log('');
    console.log('Usage: raph contribute <id|slug...> [--out <dir>]   export named lessons');
    console.log('       raph contribute list                          show what you could share');
    console.log('');
    console.log('Each export strips project names, path globs, and evidence refs; re-scrubs');
    console.log('the full text for secrets; and re-validates through the same chokepoint');
    console.log('that guards the brain. Sharing is per-lesson opt-in — there is no --all.');
    return args[0] ? 0 : 1;
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
  const refs = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);

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
