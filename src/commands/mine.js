import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { projectTranscriptDir, listSessionFiles, contentHash } from '../lib/transcripts.js';
import { loadConfig, hasConsent, setProjectConsent } from '../lib/config.js';
import { parseSessionLines, detectEpisodes } from '../lib/episodes.js';
import { loadLedger, hasProcessed, appendLedger } from '../lib/ledger.js';
import { ulid } from '../lib/ulid.js';
import { atomicWrite } from '../lib/files.js';
import { p } from '../lib/paths.js';

const MINER = 'raphael/miner@0.1.0';

async function ensureConsent(project, yes) {
  const cfg = loadConfig();
  // hasConsent covers both the per-project registry AND the global grant
  // (consent.scope 'all' + ignore list) from autopilot onboarding (§2.2).
  const consent = hasConsent(cfg, project);
  if (consent === true) return true;
  if (consent === false) {
    console.error(`raph: mining is disabled for ${project} (consent was declined or the path is on the ignore list; edit config.yaml to change)`);
    return false;
  }
  if (yes) {
    setProjectConsent(project, true);
    return true;
  }
  if (!stdin.isTTY) {
    console.error('raph: E-CONSENT: this project has not been registered for mining.');
    console.error('      re-run with --yes to allow Raphael to read its Claude Code session history (read-only, stays local)');
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`Allow Raphael to read this project's Claude Code session history? (read-only, stays on this machine) [y/N] `)).trim();
  rl.close();
  const granted = /^y(es)?$/i.test(answer);
  setProjectConsent(project, granted);
  if (!granted) console.log('raph: understood — this project will not be mined');
  return granted;
}

export default async function mine(args) {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('--yes');
  const projArgIdx = args.indexOf('--project');
  const project = path.resolve(projArgIdx >= 0 ? args[projArgIdx + 1] : process.cwd());

  if (!(await ensureConsent(project, yes))) return 1;

  const dir = projectTranscriptDir(project);
  if (!dir) {
    console.error(`raph: E-NOTRANSCRIPTS: no Claude Code session history found for ${project}`);
    return 1;
  }

  const sessions = listSessionFiles(dir);
  const live = sessions.filter((s) => s.live);
  const ledger = loadLedger();

  const fresh = [];
  for (const s of sessions) {
    if (s.live) continue;
    const hash = contentHash(s.path);
    if (!hasProcessed(ledger, hash)) fresh.push({ ...s, hash });
  }
  console.log(`SCAN   ${sessions.length} sessions (${live.length} live skipped, ${sessions.length - live.length - fresh.length} already mined) -> ${fresh.length} new`);
  if (fresh.length === 0) {
    console.log('raph: nothing new to mine');
    return 0;
  }

  let totalEvents = 0;
  let totalBad = 0;
  const failed = [];
  const processed = [];
  const byId = new Map();

  for (const s of fresh) {
    try {
      const text = readFileSync(s.path, 'utf8');
      const { events, badLines } = parseSessionLines(text);
      totalEvents += events.length;
      totalBad += badLines;
      const sessionId = path.basename(s.path, '.jsonl');
      const episodes = detectEpisodes(events, {
        sessionPath: s.path,
        sessionId,
        project: path.basename(project)
      });
      for (const ep of episodes) byId.set(ep.episode_id, ep);
      processed.push({ ...s, episodeCount: episodes.length });
    } catch (err) {
      // a broken session must not kill the run; unledgered files retry next time
      failed.push({ path: s.path, msg: err.message });
    }
  }

  const episodes = [...byId.values()];
  const counts = {};
  for (const ep of episodes) counts[ep.type] = (counts[ep.type] || 0) + 1;
  console.log(`PARSE  ${processed.length} sessions, ${totalEvents} events, ${totalBad} unparseable lines`);
  console.log(`FOUND  ${episodes.length} episodes: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);

  if (dryRun) {
    for (const ep of episodes) {
      const preview = ep.excerpt.replace(/\s+/g, ' ').slice(0, 80);
      console.log(`  [${ep.type}] ${path.basename(ep.source.path)}#L${ep.source.line_span[0]}-${ep.source.line_span[1]}  ${preview}`);
    }
    console.log('raph: dry run — nothing written, nothing marked as mined');
    return 0;
  }

  if (episodes.length > 0) {
    const runFile = path.join(p.state(), 'episodes', `${ulid()}.jsonl`);
    atomicWrite(runFile, episodes.map((e) => JSON.stringify(e)).join('\n') + '\n');
    console.log(`WROTE  ${episodes.length} episodes -> ${runFile}`);
  }

  // write-last: only fully processed sessions enter the ledger
  const now = new Date().toISOString();
  appendLedger(processed.map((s) => ({
    hash: s.hash,
    path: s.path,
    processed_at: now,
    episodes: s.episodeCount,
    miner: MINER
  })));
  console.log(`LEDGER +${processed.length} sessions`);

  if (failed.length > 0) {
    console.error(`raph: ${failed.length} session(s) failed and will retry next run:`);
    for (const f of failed) console.error(`  ${f.path}: ${f.msg}`);
    return 3;
  }
  return 0;
}
