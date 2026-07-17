// `raph arise` — the one-command first-run (Phase 11). A new user should not
// need to know the setup order; this runs it: init the brain (non-destructive),
// optionally seed the security pack and install the commit guard, then print
// the two plugin lines and the first five minutes. It composes the existing
// commands — arise holds no logic of its own.
//   raph arise [--pack] [--guard] [--yes]

import init from './init.js';
import pack from './pack.js';

export default async function arise(args = []) {
  console.log('raph arise — setting up your brain\n');

  // 1. the brain (creates only what is missing; never touches lessons)
  const initArgs = args.includes('--guard') ? ['--guard'] : [];
  const initCode = await init(initArgs);
  if (initCode !== 0) return initCode;

  // 2. optional: seed the security starter pack as REVIEWABLE candidates
  if (args.includes('--pack')) {
    console.log('');
    const packCode = await pack(['add', 'security']);
    if (packCode !== 0) return packCode;
  }

  console.log(`
Next steps:

  1. Wire the Claude Code plugin (auto-recall + /brain commands):
       /plugin marketplace add maheshaggarwal21/raphael
       /plugin install raphael-brain@raphael

  2. First five minutes:
       raph pack add security    seed 26 reviewed security lessons (skip if you used --pack)
       raph queue                see what is waiting for review
       raph approve 1 2 3        activate what you agree with — nothing activates without you
       raph mine                 mine YOUR real session history into candidate lessons

  3. Check everything:
       raph doctor               environment + brain + plugin health
       raph web                  the same brain in your browser (localhost only)

Injection is ON by default, budgeted at ~1,200 tokens/session; "raph why" shows
every injection, "raph off" stops them. Everything stays on this machine —
sharing is per-lesson opt-in via "raph contribute".`);
  return 0;
}
