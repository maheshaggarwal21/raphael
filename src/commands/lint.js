// `raph lint` — read-only freshness + staleness + contradiction pass over the
// brain's active lessons (Phase 16.6a). Advisory only: it never changes a lesson.
// Staleness is atlas-provable, so it uses the atlas for --project (default cwd)
// when one is built; otherwise that check is honestly skipped.

import path from 'node:path';
import { lintLessons, renderLint, readActiveLessons, atlasFileLabels } from '../lib/freshness.js';
import { readEvents } from '../lib/events.js';

export default async function lint(args) {
  const asJson = args.includes('--json');
  const pi = args.indexOf('--project');
  const projectDir = path.resolve(pi >= 0 && args[pi + 1] ? args[pi + 1] : process.cwd());

  const lessons = readActiveLessons();
  const atlasFiles = atlasFileLabels(projectDir);
  const rep = lintLessons(lessons, { atlasFiles, events: readEvents() });

  if (asJson) {
    console.log(JSON.stringify(rep, null, 2));
    return 0;
  }
  console.log(renderLint(rep));
  return 0; // advisory — always a clean exit
}
