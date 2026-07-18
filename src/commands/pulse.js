// `raph pulse` — the autopilot heartbeat command (Phase 17.3).
//
//   raph pulse            show the last pulse + whether autopilot is on
//   raph pulse --run      run one heartbeat inline (mine -> distill -> curate
//                         -> sweep -> retire -> index), printing as it goes
//   raph pulse --async    HOOK ENTRY (SessionEnd): spawn a detached --run
//                         child and return in milliseconds; output goes to
//                         ~/.raphael/logs/pulse.log. ALWAYS exits 0.
//
// The hook contract mirrors `raph inject`: a broken brain must never block or
// slow the user's session — --async swallows every error.

import { mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runPulse } from '../lib/pulse.js';
import { loadConfig, getMode } from '../lib/config.js';
import { readEvents } from '../lib/events.js';
import { p } from '../lib/paths.js';

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function raphBin() {
  // src/commands/pulse.js -> <pkg>/bin/raph.js
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'raph.js');
}

export default async function pulse(args) {
  const projIdx = args.indexOf('--project');
  const projectArg = projIdx >= 0 ? args[projIdx + 1] : null;

  if (args.includes('--async')) {
    try {
      const payload = await readStdinJson();
      const project = path.resolve(projectArg ?? payload.cwd ?? process.cwd());
      mkdirSync(p.logs(), { recursive: true });
      const fd = openSync(path.join(p.logs(), 'pulse.log'), 'a');
      // No cwd option on purpose: the project travels via --project, and a
      // bad/vanished cwd would make the detached child die SILENTLY (spawn
      // ENOENT) — found by the 17.8 outside-user test.
      const child = spawn(process.execPath, [raphBin(), 'pulse', '--run', '--project', project], {
        detached: true,
        stdio: ['ignore', fd, fd],
        env: process.env,
        windowsHide: true
      });
      child.unref();
      closeSync(fd);
    } catch {
      // fail-open: a hook must never surface an error into the session
    }
    return 0;
  }

  if (args.includes('--run')) {
    const project = path.resolve(projectArg ?? process.cwd());
    console.log(`pulse: ${new Date().toISOString()} — project ${project}`);
    const summary = await runPulse({ project, log: (s) => console.log(s) });
    if (summary.skipped) {
      console.log(`pulse: skipped — ${summary.skipped}`);
      return 0;
    }
    console.log(
      `pulse: mined +${summary.mined} episode(s), distilled ${summary.distilled}, ` +
      `activated ${summary.curated}, expired ${summary.expired}, retired ${summary.retired}` +
      `${summary.limited ? '  [LIMIT hit — resumes next pulse]' : ''}` +
      `${summary.errors.length ? `  [${summary.errors.length} step error(s), fail-open]` : ''}`
    );
    for (const e of summary.errors) console.log(`  [error] ${e}`);
    return 0;
  }

  // status view
  const cfg = loadConfig();
  const mode = getMode(cfg);
  console.log(`mode: ${mode === 'autopilot' ? 'AUTOPILOT — pulse runs after each session' : 'manual (curator) — pulse is a no-op (raph auto full to enable)'}`);
  const pulses = readEvents().filter((e) => e.event === 'pulse');
  if (pulses.length === 0) {
    console.log('no pulses recorded yet');
    return 0;
  }
  const last = pulses[pulses.length - 1];
  console.log(`last pulse: ${last.ts ?? '?'}  project: ${last.project ?? '?'}`);
  if (last.skipped) console.log(`  skipped — ${last.skipped}`);
  else console.log(`  mined +${last.mined ?? 0}, distilled ${last.distilled ?? 0}, activated ${last.curated ?? 0}, expired ${last.expired ?? 0}, retired ${last.retired ?? 0}${last.limited ? '  [LIMIT]' : ''}`);
  console.log(`total pulses: ${pulses.length}  ·  log: ${path.join(p.logs(), 'pulse.log')}`);
  return 0;
}
