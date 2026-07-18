// `raph update` — check the npm registry for a newer raphael-brain and
// upgrade in place (owner decision 2026-07-18). On autopilot this also runs
// automatically inside the pulse (daily check), so most users never type it.
//
//   raph update            check, and upgrade if behind
//   raph update --check    check only, change nothing

import { checkForUpdate, runNpmUpgrade, currentVersion, readUpdateState } from '../lib/update.js';
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
  console.log(`raph: updated to ${check.latest} — new sessions use it immediately`);
  const st = readUpdateState();
  if (st.last_result) console.log(`        (autopilot's last check: ${st.last_result})`);
  return 0;
}
