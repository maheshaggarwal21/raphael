import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { p } from '../lib/paths.js';

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

export default async function status() {
  if (!existsSync(p.home())) {
    console.log('raph: no brain found — run "raph init" first');
    return 1;
  }

  let mode = 'curator';
  try {
    const cfg = yaml.load(readFileSync(p.config(), 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (cfg?.mode) mode = cfg.mode;
  } catch { /* unreadable config surfaces via doctor later */ }

  const counts = {};
  for (const file of listLessonFiles(p.lessons())) {
    const text = readFileSync(file, 'utf8');
    const m = /^status:\s*(\S+)/m.exec(text);
    const st = m ? m[1] : 'unknown';
    counts[st] = (counts[st] || 0) + 1;
  }

  const pending = existsSync(p.candidates())
    ? readdirSync(p.candidates()).filter((f) => f.endsWith('.md')).length
    : 0;
  const quarantined = existsSync(p.quarantine())
    ? readdirSync(p.quarantine()).filter((f) => f.endsWith('.md')).length
    : 0;

  console.log(`brain: ${p.home()}  (mode: ${mode})`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`lessons: ${total}${total ? '  ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`);
  console.log(`candidates pending review: ${pending}`);
  if (quarantined > 0) console.log(`quarantined (needs attention): ${quarantined}`);
  if (pending > 0) console.log('next: run /brain-review (or "raph validate --all" to check files)');
  return 0;
}
