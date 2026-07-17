// `raph skills` — the skills factory (Phase 14 meta layer).
//   raph skills suggest [--json]   lessons that fire broadly enough to package
//   raph skills draft <id|slug>    write a staged SKILL.md draft (NOT installed)
//   raph skills list               staged drafts on disk
// Drafts are never installed automatically — that stays a human act.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { skillCandidates, draftSkillFromLesson, renderSkillSuggestions } from '../lib/skillfactory.js';
import { readActiveLessons } from '../lib/freshness.js';
import { readEvents } from '../lib/events.js';
import { p } from '../lib/paths.js';

function listDrafts() {
  const root = p.skillDrafts();
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'SKILL.md');
    if (existsSync(file)) out.push({ slug: entry.name, path: file });
  }
  return out;
}

export default async function skills(args) {
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : 'suggest';
  const asJson = args.includes('--json');
  const lessons = readActiveLessons();

  if (sub === 'suggest') {
    const result = skillCandidates(lessons, { events: readEvents() });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(renderSkillSuggestions(result));
    return 0;
  }

  if (sub === 'list') {
    const drafts = listDrafts();
    if (asJson) {
      console.log(JSON.stringify(drafts, null, 2));
      return 0;
    }
    if (!drafts.length) {
      console.log('raph: no staged skill drafts. Make one with: raph skills draft <slug>');
      return 0;
    }
    console.log(`raph: ${drafts.length} staged skill draft(s) (NOT installed):`);
    for (const d of drafts) console.log(`  ${d.slug}  -> ${d.path}`);
    return 0;
  }

  if (sub === 'draft') {
    const ref = args.find((a, i) => i > 0 && !a.startsWith('--'));
    if (!ref) {
      console.error('raph: usage: raph skills draft <lesson id|slug>');
      return 1;
    }
    const lesson = lessons.find((l) => l.id === ref || l.slug === ref);
    if (!lesson) {
      console.error(`raph: no active lesson matches "${ref}" (raph skills suggest lists candidates)`);
      return 1;
    }
    const { path: file, slug } = draftSkillFromLesson(lesson);
    console.log(`raph: staged skill draft "${slug}" -> ${file}`);
    console.log('raph: DRAFT only — review it, then install by hand. Nothing was activated.');
    return 0;
  }

  console.error('raph: usage: raph skills [suggest|draft <id|slug>|list] [--json]');
  return 1;
}
