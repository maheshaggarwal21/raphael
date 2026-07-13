import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { distillEpisodes, estimateTokens, DISTILLER } from '../lib/distill.js';
import { callModel, apiKey } from '../lib/model.js';
import { loadLedger, hasProcessed, appendLedger } from '../lib/ledger.js';
import { loadConfig } from '../lib/config.js';
import { p } from '../lib/paths.js';

function loadPendingEpisodes() {
  const dir = p.episodesDir();
  if (!existsSync(dir)) return [];
  const ledger = loadLedger(p.distilledLedger());
  const episodes = [];
  const seen = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let ep;
      try {
        ep = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ep?.episode_id || seen.has(ep.episode_id)) continue;
      seen.add(ep.episode_id);
      if (!hasProcessed(ledger, ep.episode_id)) episodes.push(ep);
    }
  }
  return episodes;
}

export default async function distill(args) {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('--yes');
  const maxIdx = args.indexOf('--max-episodes');
  const modelIdx = args.indexOf('--model');

  let episodes = loadPendingEpisodes();
  if (maxIdx >= 0) episodes = episodes.slice(0, Number(args[maxIdx + 1]) || episodes.length);

  if (episodes.length === 0) {
    console.log('raph: no undistilled episodes — run "raph mine" first');
    return 0;
  }

  const cfg = loadConfig();
  const learning = cfg.learning ?? {};
  const config = {
    extract_model: (modelIdx >= 0 ? args[modelIdx + 1] : undefined) ?? learning.extract_model ?? 'claude-haiku-4-5-20251001',
    rubric_model: learning.rubric_model,
    max_candidates_per_run: learning.max_candidates_per_run ?? 10,
    dedupe_threshold: learning.dedupe_threshold ?? 0.6,
    rejection_expiry_days: learning.rejection_expiry_days ?? 180
  };

  const estimate = estimateTokens(episodes);
  console.log(`PLAN   ${episodes.length} episodes -> ~${(estimate / 1000).toFixed(1)}k tokens on ${config.extract_model} (cap: ${config.max_candidates_per_run} candidates)`);

  if (dryRun) {
    for (const ep of episodes) {
      console.log(`  [pending] ${ep.episode_id} (${ep.type}) from ${path.basename(ep.source?.path ?? '?')}`);
    }
    console.log('raph: dry run — no model calls, nothing written');
    return 0;
  }

  const confirmAbove = learning.confirm_above_tokens ?? 200000;
  if (estimate > confirmAbove && !yes) {
    console.error(`raph: estimated ${(estimate / 1000).toFixed(0)}k tokens exceeds the confirm threshold (${confirmAbove / 1000}k) — re-run with --yes to proceed`);
    return 1;
  }
  if (!apiKey()) {
    console.error('raph: E-APIKEY: set ANTHROPIC_API_KEY to run distillation');
    console.error('      (the /brain-learn skill flow inside Claude Code arrives with the plugin phase)');
    return 1;
  }

  const results = await distillEpisodes(episodes, { callModel, config, log: (s) => console.log(s) });

  const counts = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  const staged = (counts['staged'] ?? 0) + (counts['staged-quarantined'] ?? 0);
  console.log(`FUNNEL ${episodes.length} episodes -> ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

  // write-last: deferred and cap-deferred episodes stay out so they retry next run
  const done = results.filter((r) => r.outcome !== 'deferred' && r.outcome !== 'cap-deferred');
  const now = new Date().toISOString();
  appendLedger(
    done.map((r) => ({ hash: r.episode_id, outcome: r.outcome, path: r.path, processed_at: now, miner: DISTILLER })),
    p.distilledLedger()
  );
  console.log(`LEDGER +${done.length} episodes distilled`);
  if (staged > 0) console.log(`STAGED ${staged} candidate(s) await review — nothing activates without approval`);

  const deferred = (counts['deferred'] ?? 0);
  if (deferred > 0) {
    console.error(`raph: ${deferred} episode(s) deferred after model errors — they will retry next run`);
    return 3;
  }
  return 0;
}
