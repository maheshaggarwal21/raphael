import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { p } from './paths.js';

// Best-effort commit of the brain repo after a state change. Rollback story:
// git revert. Never fails the calling command — versioning is a safety net,
// not a dependency.
export function commitBrain(message) {
  const brain = p.brain();
  if (!existsSync(path.join(brain, '.git'))) return false;
  const add = spawnSync('git', ['add', '-A'], { cwd: brain, encoding: 'utf8' });
  if (add.status !== 0) return false;
  const commit = spawnSync('git', ['commit', '-q', '-m', message], { cwd: brain, encoding: 'utf8' });
  return commit.status === 0; // empty commit fails: that is fine
}
