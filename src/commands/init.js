import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { p } from '../lib/paths.js';
import { atomicWrite } from '../lib/files.js';

const DEFAULT_CONFIG = `schema: raphael/config/v1
mode: curator            # curator = you review every lesson | auto = machine-gated restricted tier
injection:
  session_cap_tokens: 1200
  session_start_max: 10
  per_prompt_max: 3
learning:
  max_candidates_per_run: 10
  confirm_above_tokens: 200000
review:
  nudge: weekly          # weekly | off
projects: {}             # project path -> { consent: true/false, registered: YYYY-MM-DD }
`;

// The brain repo refuses to push anywhere until the user consciously allows a
// remote. Accidental publication of the brain is a habit-level risk (threat T3).
const PRE_PUSH_HOOK = `#!/bin/sh
echo "raphael: pushing the brain to a remote is blocked by default." >&2
echo "raphael: your brain may contain content distilled from private sessions." >&2
echo "raphael: to allow a remote on purpose, delete .git/hooks/pre-push in the brain repo." >&2
exit 1
`;

export default async function init(args = []) {
  const created = [];
  const dirs = [
    p.lessons(), p.retired(), p.quarantine(), p.evidence(), p.maps(),
    p.candidates(), p.state(), p.index(), p.evals(), p.logs()
  ];
  for (const d of dirs) {
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
      created.push(d);
    }
  }

  if (!existsSync(p.config())) {
    atomicWrite(p.config(), DEFAULT_CONFIG);
    created.push(p.config());
  }

  const brainGit = path.join(p.brain(), '.git');
  if (!existsSync(brainGit)) {
    const res = spawnSync('git', ['init', '-b', 'main'], { cwd: p.brain(), encoding: 'utf8' });
    if (res.status === 0) {
      const hookPath = path.join(brainGit, 'hooks', 'pre-push');
      mkdirSync(path.dirname(hookPath), { recursive: true });
      writeFileSync(hookPath, PRE_PUSH_HOOK, 'utf8');
      try { chmodSync(hookPath, 0o755); } catch { /* windows: mode is a no-op */ }
      created.push(`${p.brain()} (git repo + pre-push guard)`);
    } else {
      console.warn('raph: git not found — brain versioning disabled (snapshots fallback not yet built)');
    }
  }

  if (created.length === 0) {
    console.log(`raph: already initialized at ${p.home()}`);
  } else {
    console.log(`raph: initialized brain at ${p.home()}`);
    for (const c of created) console.log(`  created ${c}`);
  }

  // --guard also installs the project secret guard (a pre-commit hook that
  // blocks secrets) in the CURRENT git repo — distinct from the brain's own
  // pre-push guard above. Never fatal: a missing/foreign hook just warns.
  if (args.includes('--guard')) {
    const { installPreCommitHook } = await import('../lib/guard.js');
    const res = installPreCommitHook(process.cwd());
    if (res.ok) {
      console.log(`raph: project secret guard installed -> ${res.hookPath}`);
    } else if (res.reason === 'not-a-git-repo') {
      console.warn('raph: --guard skipped — this directory is not a git repository (run "raph guard install" inside one).');
    } else if (res.reason === 'foreign-hook') {
      console.warn(`raph: --guard skipped — a non-raphael pre-commit hook already exists (${res.hookPath}). Use "raph guard install --force" to replace it.`);
    }
  }

  return 0;
}
