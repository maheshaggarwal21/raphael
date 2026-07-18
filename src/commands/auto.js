// `raph auto` — the auto-approve dial + the autopilot/manual mode switch
// (ARCHITECTURE §9 + §13 + §11.13). Thin printer over lib/autoapprove.js
// setDial() and lib/config.js setMode() — the console's settings page calls
// exactly the same functions (no verb, no button).

import { loadConfig, saveConfig, getMode } from '../lib/config.js';
import { setDial, dialLevel, dialCaps, countAutoTier } from '../lib/autoapprove.js';

const HELP = `raph auto — the auto-approve dial + autopilot switch

Usage:
  raph auto                     Show the current mode, level, and the auto tier's size
  raph auto full                AUTOPILOT: everything the machine curator passes
                                activates on its own — security lessons included
                                (§11.13). Quarantined content still never does.
  raph auto off|standard|wide   Manual (curator) mode at the given dial level
  raph auto manual              Manual (curator) mode, dial unchanged
  raph auto --cap N             Max auto-tier lessons (default 30)
  raph auto --daily-cap N       Max adopted auto-approvals per day (default 10)

Levels:
  off       nothing activates without you (curator default)
  standard  your own MINED lessons that pass every gate activate into the
            restricted auto tier (this-project scope, capped, never shared)
  wide      + ADOPTED lessons that passed the reviewer agent
  full      + SECURITY lessons via the machine curator (reviewer screen +
            canary gate + probation) — the autopilot setting

At every level, quarantined (injection-suspect) content never machine-activates;
it waits silently and expires. That floor is enforced in code and not configurable.`;

export default async function auto(args) {
  const cfg = loadConfig();

  const capIdx = args.indexOf('--cap');
  const dailyIdx = args.indexOf('--daily-cap');
  // (an -1 flag index must not exclude args[0] — that hid the level word)
  const word = args.find((a, i) => !a.startsWith('--') && !(capIdx >= 0 && i === capIdx + 1) && !(dailyIdx >= 0 && i === dailyIdx + 1));

  if (word === 'help') {
    console.log(HELP);
    return 0;
  }

  // mode coupling: 'full' IS autopilot; any explicit sub-full level IS manual.
  let level = word;
  let modeChanged = false;
  if (word === 'manual') {
    level = undefined;
    if (cfg.mode === 'autopilot') { cfg.mode = 'curator'; modeChanged = true; }
    // autopilot's dial level makes no sense in manual mode — step it down
    if (dialLevel(cfg) === 'full') { cfg.auto_approve = { ...(cfg.auto_approve ?? {}), level: 'standard' }; modeChanged = true; }
  }

  let result;
  try {
    result = setDial(cfg, {
      level,
      cap: capIdx >= 0 ? Number(args[capIdx + 1]) : undefined,
      dailyCap: dailyIdx >= 0 ? Number(args[dailyIdx + 1]) : undefined
    });
  } catch (err) {
    console.error(`raph: ${err.message.replace(/^E-DIAL: /, '')}`);
    return 1;
  }
  if (level === 'full' && cfg.mode !== 'autopilot') { cfg.mode = 'autopilot'; modeChanged = true; }
  if (level && level !== 'full' && cfg.mode === 'autopilot') { cfg.mode = 'curator'; modeChanged = true; }
  if (result.changed || modeChanged) saveConfig(cfg);

  const now = dialLevel(cfg);
  const caps = dialCaps(cfg);
  const mode = getMode(cfg);
  console.log(`mode: ${mode === 'autopilot' ? 'AUTOPILOT' : 'manual (curator)'}  ·  auto-approve: ${now}${result.changed || modeChanged ? '  (saved)' : ''}`);
  console.log(`  auto tier: ${countAutoTier()}/${caps.cap} lesson(s)  ·  adopted daily cap: ${caps.dailyCap}`);
  if (now === 'full') {
    console.log('  autopilot is ON: mined, adopted, and security lessons that pass the machine');
    console.log('  curator (reviewer screen + canary gate) activate without you. Quarantined');
    console.log('  content never does. Undo anything: raph retire <slug> --confirmed / raph web');
  }
  if (now === 'wide') {
    console.log('  wide is on: adopted lessons that pass the reviewer activate WITHOUT you.');
    console.log('  security lessons still always need you. Undo any source with: raph adopt revoke <id>');
  }
  if (now === 'off') console.log('  everything waits for your review (raph queue)');
  return 0;
}
