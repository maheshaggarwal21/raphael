import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { validateLesson } from '../lib/validate.js';
import { p } from '../lib/paths.js';

function collect(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export default async function validate(args) {
  let files;
  if (args.includes('--all')) {
    files = [...collect(p.lessons()), ...collect(p.candidates())];
    if (files.length === 0) {
      console.log('raph: no lesson or candidate files found');
      return 0;
    }
  } else {
    files = args.filter((a) => !a.startsWith('--'));
    if (files.length === 0) {
      console.error('raph: usage: raph validate <file...> | raph validate --all');
      return 1;
    }
  }

  let failed = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`FAIL  ${file}  (file not found)`);
      failed++;
      continue;
    }
    const result = validateLesson(readFileSync(file, 'utf8'));
    if (result.ok && !result.quarantine) {
      console.log(`PASS  ${file}`);
    } else if (result.ok && result.quarantine) {
      console.log(`QUARANTINE  ${file}`);
      for (const w of result.warnings) console.log(`  ${w.code}: ${w.msg}`);
    } else {
      failed++;
      console.error(`FAIL  ${file}`);
      for (const e of result.errors) console.error(`  ${e.code}: ${e.msg}`);
      for (const w of result.warnings) console.error(`  ${w.code}: ${w.msg}`);
    }
  }

  const summary = `${files.length} checked, ${failed} failed`;
  console.log(failed > 0 ? `raph: ${summary}` : `raph: ${summary} — all clean`);
  return failed > 0 ? 1 : 0;
}
