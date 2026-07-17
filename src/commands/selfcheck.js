// `raph selfcheck` — run the self-upgrade gate on the CURRENT state of this repo:
// are we on a feature branch, is npm test green, are the eval canaries green?
// Read-only: it reports PASS/BLOCKED and exits non-zero when blocked. It never
// merges — a human does that. Use before merging any change to Raphael's own code.
//   raph selfcheck [--quick]   (--quick skips the slow npm test + eval, branch only)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateSelfUpgrade, renderSelfUpgrade } from '../lib/selfupgrade.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function gitBranch() {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

function run(cmd, cmdArgs) {
  try {
    const r = spawnSync(cmd, cmdArgs, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' });
    return r.status === 0;
  } catch {
    return null;
  }
}

export default async function selfcheck(args) {
  const quick = args.includes('--quick');
  const branch = gitBranch();
  const testsPassed = quick ? undefined : run('npm', ['test']);
  const evalPassed = quick ? undefined : run(process.execPath, ['bin/raph.js', 'eval', 'run', '--dry-run']);

  const rep = evaluateSelfUpgrade({ branch, testsPassed, evalPassed });
  if (args.includes('--json')) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    if (quick) console.log('raph: --quick — checking branch only (skipping npm test + eval)');
    console.log(renderSelfUpgrade(rep));
  }
  return rep.ok ? 0 : 1;
}
