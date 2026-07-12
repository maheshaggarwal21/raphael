import { existsSync, readFileSync, readdirSync, accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { p } from '../lib/paths.js';
import { validateLesson } from '../lib/validate.js';

function listLessonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLessonFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export default async function doctor() {
  const checks = [];
  const add = (name, ok, fix = '', warn = false) => checks.push({ name, ok, fix, warn });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(`node ${process.versions.node} (need >=18)`, nodeMajor >= 18, 'install Node 18 or newer');

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  add('git available', git.status === 0, 'install git — brain versioning depends on it');

  const initialized = existsSync(p.home());
  add(`brain exists at ${p.home()}`, initialized, 'run "raph init"');

  if (initialized) {
    let configOk = false;
    try {
      const cfg = yaml.load(readFileSync(p.config(), 'utf8'), { schema: yaml.JSON_SCHEMA });
      configOk = cfg?.schema === 'raphael/config/v1';
    } catch { /* fall through */ }
    add('config.yaml parses', configOk, 'fix or delete config.yaml, then re-run "raph init"');

    add('brain is a git repo', existsSync(path.join(p.brain(), '.git')), 're-run "raph init" with git installed');
    add(
      'pre-push guard installed',
      existsSync(path.join(p.brain(), '.git', 'hooks', 'pre-push')),
      're-run "raph init" to restore the push blocker',
      true
    );

    const files = listLessonFiles(p.lessons());
    let bad = 0;
    for (const f of files) {
      const r = validateLesson(readFileSync(f, 'utf8'));
      if (!r.ok) bad++;
    }
    add(
      `lessons validate (${files.length - bad}/${files.length})`,
      bad === 0,
      'run "raph validate --all" to see which files fail'
    );
  }

  const transcripts = path.join(os.homedir(), '.claude', 'projects');
  let transcriptsOk = false;
  try {
    accessSync(transcripts, constants.R_OK);
    transcriptsOk = true;
  } catch { /* not present or unreadable */ }
  add('claude session transcripts readable', transcriptsOk, `expected at ${transcripts} — mining will have nothing to read`, true);

  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : c.warn ? 'WARN' : 'FAIL';
    if (!c.ok && !c.warn) failed++;
    console.log(`${mark}  ${c.name}${c.ok || !c.fix ? '' : `\n      fix: ${c.fix}`}`);
  }
  console.log(failed === 0 ? 'raph: healthy' : `raph: ${failed} check(s) failing`);
  return failed === 0 ? 0 : 1;
}
