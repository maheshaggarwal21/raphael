// `raph update` — check the npm registry for a newer raphael-brain and
// upgrade in place (owner decision 2026-07-18). On autopilot this also runs
// automatically inside the pulse (daily check), so most users never type it.
//
//   raph update            check, and upgrade if behind
//   raph update --check    check only, change nothing

import { checkForUpdate, runNpmUpgrade, currentVersion, readUpdateState, writeUpdateState } from '../lib/update.js';
import { logEvent } from '../lib/events.js';

export default async function update(args) {
  const checkOnly = args.includes('--check');
  const current = currentVersion();

  let check;
  try {
    check = await checkForUpdate({ current });
  } catch (err) {
    console.error(`raph: could not reach the npm registry — ${err.message}`);
    console.error('      (offline is fine; autopilot retries daily. Manual: npm install -g raphael-brain@latest)');
    return 1;
  }

  if (!check.behind) {
    console.log(`raph: up to date (${check.current})`);
    return 0;
  }

  console.log(`UPDATE  ${check.current} -> ${check.latest} available`);
  if (checkOnly) {
    console.log('        run "raph update" to upgrade (or wait — autopilot does it daily)');
    return 0;
  }

  console.log('        upgrading via: npm install -g raphael-brain@latest');
  const r = runNpmUpgrade();
  if (!r.ok) {
    console.error(`raph: upgrade failed — ${r.why}`);
    console.error('      run it yourself: npm install -g raphael-brain@latest');
    return 1;
  }
  try { logEvent({ event: 'self-update', from: check.current, to: check.latest }); } catch { /* non-fatal */ }
  // Record it. Only maybeSelfUpdate (the pulse path) used to write this, so a
  // MANUAL upgrade left the old record standing and then printed it back at the
  // user in the same breath — "updated to 0.5.1 ... (last check: current (0.5.0))",
  // which reads as though nothing happened. A status line that contradicts the
  // action above it is worse than no status line.
  try {
    writeUpdateState({ last_check: Date.now(), last_result: `updated ${check.current} -> ${check.latest}` });
  } catch { /* the record must never break the upgrade */ }
  console.log(`raph: updated to ${check.latest} — new sessions use it immediately`);
  return 0;
}
