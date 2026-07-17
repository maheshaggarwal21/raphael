// Cross-platform test entry: expand test/*.test.js ourselves and hand the file
// list to `node --test`. Shell globbing differs (bash expands, cmd doesn't) and
// node's own glob/directory handling differs across 18/20/22 — an explicit list
// behaves identically everywhere.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('test', f));

if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
