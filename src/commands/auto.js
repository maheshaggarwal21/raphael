// `raph auto` — read/set the auto-approve dial (ARCHITECTURE §9 + §13).
// The console's settings page calls exactly this verb (no verb, no button).

import { loadConfig, saveConfig } from '../lib/config.js';
import { dialLevel, dialCaps, DIAL_LEVELS, countAutoTier } from '../lib/autoapprove.js';

const HELP = `raph auto — the auto-approve dial

Usage:
  raph auto                     Show the current level and the auto tier's size
  raph auto off|standard|wide   Set the level
  raph auto --cap N             Max auto-tier lessons (default 30)
  raph auto --daily-cap N       Max adopted auto-approvals per day (default 10)

Levels:
  off       nothing activates without you (curator default)
  standard  your own MINED lessons that pass every gate activate into the
            restricted auto tier (this-project scope, capped, never shared)
  wide      + ADOPTED lessons that passed the reviewer agent

At every level, security-category lessons and anything quarantined still wait
for you — that floor is enforced in code (E-AUTOSEC) and is not configurable.`;

export default async function auto(args) {
  const cfg = loadConfig();

  const capIdx = args.indexOf('--cap');
  const dailyIdx = args.indexOf('--daily-cap');
  const level = args.find((a) => !a.startsWith('--') && args.indexOf(a) !== capIdx + 1 && args.indexOf(a) !== dailyIdx + 1);

  if (level === 'help') {
    console.log(HELP);
    return 0;
  }

  let changed = false;
  if (level) {
    if (!DIAL_LEVELS.includes(level)) {
      console.error(`raph: unknown level "${level}" — use off, standard, or wide`);
      return 1;
    }
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), level };
    changed = true;
  }
  if (capIdx >= 0) {
    const n = Number(args[capIdx + 1]);
    if (!Number.isInteger(n) || n < 0) {
      console.error('raph: --cap needs a non-negative integer');
      return 1;
    }
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), cap: n };
    changed = true;
  }
  if (dailyIdx >= 0) {
    const n = Number(args[dailyIdx + 1]);
    if (!Number.isInteger(n) || n < 0) {
      console.error('raph: --daily-cap needs a non-negative integer');
      return 1;
    }
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), daily_cap: n };
    changed = true;
  }
  if (changed) saveConfig(cfg);

  const now = dialLevel(cfg);
  const caps = dialCaps(cfg);
  console.log(`auto-approve: ${now}${changed ? '  (saved)' : ''}`);
  console.log(`  auto tier: ${countAutoTier()}/${caps.cap} lesson(s)  ·  adopted daily cap: ${caps.dailyCap}`);
  if (now === 'wide') {
    console.log('  wide is on: adopted lessons that pass the reviewer activate WITHOUT you.');
    console.log('  security lessons still always need you. Undo any source with: raph adopt revoke <id>');
  }
  if (now === 'off') console.log('  everything waits for your review (raph queue)');
  return 0;
}
