// `raph arise` — the one-command first-run (Phase 11 + 17.5). A new user should
// not need to know the setup order; this runs it. Two shapes:
//
//   raph arise --autopilot [--contribute] [--guard]
//       The zero-touch setup (§2.2's three permissions, answered): global
//       consent to learn from this machine's projects, optional contribution
//       grant, mode autopilot + dial full. From here Raphael runs itself
//       (pulse after each session) and speaks once a week.
//
//   raph arise [--pack] [--guard]
//       The manual (curator) setup — everything waits for human review.
//
// arise composes the existing engines — it holds no policy of its own.

import init from './init.js';
import pack from './pack.js';
import { loadConfig, saveConfig, setMode, setConsentScope } from '../lib/config.js';
import { setDial } from '../lib/autoapprove.js';
import { seedGlobalBrain } from '../lib/globalbrain.js';

export default async function arise(args = []) {
  const autopilot = args.includes('--autopilot');
  console.log(`raph arise — setting up your brain${autopilot ? ' (autopilot)' : ''}\n`);

  // 1. the brain (creates only what is missing; never touches lessons)
  const initArgs = args.includes('--guard') ? ['--guard'] : [];
  const initCode = await init(initArgs);
  if (initCode !== 0) return initCode;

  if (autopilot) {
    // 2. the three permissions, recorded (§2.2)
    setConsentScope('all');                    // permission 1: learn from my work
    if (args.includes('--contribute')) {       // permission 2 (optional): share up
      const cfg = loadConfig();
      cfg.contribute = { enabled: true, granted: new Date().toISOString().slice(0, 10) };
      saveConfig(cfg);
    }
    setMode('autopilot');                      // permission 3: autopilot
    const cfg = loadConfig();
    setDial(cfg, { level: 'full' });
    saveConfig(cfg);
    console.log('CONSENT  learn from this machine\'s projects: granted (raph config: consent.scope=all)');
    console.log(`SHARE    contribute to the community brain: ${args.includes('--contribute') ? 'granted — scrubbed bundles, you curate nothing' : 'NOT granted — everything stays on this machine'}`);
    console.log('MODE     autopilot — mine, distill, curate, and index after each session');

    // 3. seed the local brain from the global brain shipped in the package
    //    (§2.1: your copy starts as the owner-curated set; zero network)
    const seed = seedGlobalBrain({ log: (s) => console.log(s) });
    if (seed.activated?.length) {
      console.log(`SEED     ${seed.activated.length} curated lesson(s) from the global brain v${seed.version} — active now`);
    } else if (seed.why) {
      console.log(`SEED     skipped — ${seed.why}`);
    } else {
      console.log('SEED     nothing new (the local brain already has the global set)');
    }
    console.log(`
That's it — you're done. Raphael now runs itself:
  · after each coding session it quietly learns from what happened
  · lessons pass the machine curator (reviewer screen + canary gate) before
    they activate; quarantined content never activates
  · your project map (atlas) stays fresh automatically
  · once a week, one short line reports what it learned — raph web shows
    everything and can undo anything in one click

Wire the Claude Code plugin if you haven't:
  /plugin marketplace add maheshaggarwal21/raphael
  /plugin install raphael-brain@raphael

Prefer to review lessons yourself? raph auto manual`);
    return 0;
  }

  // manual (curator) path — unchanged Phase 11 behavior
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
sharing is per-lesson opt-in via "raph contribute". Want zero-touch instead?
raph arise --autopilot`);
  return 0;
}
