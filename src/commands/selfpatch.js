// `raph selfpatch` — run the self-patch gate (Phase 13b) on the current working
// state: the files changed vs the default branch, plus the self-upgrade gate
// (branch + tests + eval). Reports CLEAR TO PRESENT or BLOCKED and exits non-zero
// when blocked. It NEVER applies or merges anything (§11.11) — it green-lights a
// human presentation only.
//   raph selfpatch [--quick] [--confirm-chokepoint] [--license-family fam] [--json]

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateSelfPatch, renderSelfPatch } from '../lib/selfpatch.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(cmdArgs) {
  try {
    const r = spawnSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

function changedVsMain() {
  // union of committed-on-branch and working-tree changes vs main
  const files = new Set();
  for (const spec of [['diff', '--name-only', 'main...HEAD'], ['diff', '--name-only']]) {
    const out = git(spec);
    if (out) for (const line of out.split('\n')) if (line.trim()) files.add(line.trim());
  }
  return [...files];
}

function run(cmd, cmdArgs) {
  try {
    const r = spawnSync(cmd, cmdArgs, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' });
    return r.status === 0;
  } catch {
    return null;
  }
}

export default async function selfpatch(args) {
  const quick = args.includes('--quick');
  const chokepointAck = args.includes('--confirm-chokepoint');
  const lfIdx = args.indexOf('--license-family');
  const licenseFamily = lfIdx >= 0 ? args[lfIdx + 1] : null;

  const branchOut = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchOut ? branchOut.trim() : null;
  const changedFiles = changedVsMain();
  const testsPassed = quick ? undefined : run('npm', ['test']);
  const evalPassed = quick ? undefined : run(process.execPath, ['bin/raph.js', 'eval', 'run', '--dry-run']);

  const rep = evaluateSelfPatch({ branch, testsPassed, evalPassed, changedFiles, chokepointAck, licenseFamily });
  if (args.includes('--json')) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    if (quick) console.log('raph: --quick — branch + patch classification only (skipping npm test + eval)');
    console.log(renderSelfPatch(rep));
  }
  return rep.ok ? 0 : 1;
}
