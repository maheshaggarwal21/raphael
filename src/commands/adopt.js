// `raph adopt` — the Scout pipeline's command surface (ARCHITECTURE §13).
// Drop a URL, file, repo directory, or skill file; Raphael digests it through
// the six-layer gauntlet into candidate lessons + staged skill drafts. Every
// adoption is recorded in the provenance ledger; `revoke` is the one-click undo.

import { adoptSource, revokeAdoption } from '../lib/adopt.js';
import { loadSource } from '../lib/adopt.js';
import { listAdoptions } from '../lib/provenance.js';
import { getModelCaller } from '../lib/provider.js';
import { autoApproveStaged } from '../lib/autoapprove.js';
import { loadConfig } from '../lib/config.js';

const HELP = `raph adopt — digest external material into reviewable knowledge

Usage:
  raph adopt <url | path> [--dry-run] [--yes] [--skill] [--model m]
        Fetch/read the source, screen it with the reviewer agent, and stage
        candidate lessons (review queue) + skill drafts (staged/skills/).
        URLs: https only, read-only, bounded — content is scanned, never run.
        --dry-run  read + license + scrub only; no model calls, nothing written
        --skill    treat a local file as a skill file
  raph adopt list
        Show the provenance ledger: every adoption, its license, verdict,
        status, and what it produced.
  raph adopt revoke <id | source>
        Undo an adoption: staged candidates are removed, active lessons are
        retired, skill drafts deleted. Recorded, never silent.

Nothing an adoption produces activates without review (or the auto-approve
dial, where security lessons still always need a human).`;

function fmtLicense(l) {
  return l?.detected ? `${l.id} (${l.family})` : 'unknown';
}

export default async function adopt(args) {
  const sub = args[0];

  if (!sub || sub === 'help') {
    console.log(HELP);
    return sub ? 0 : 1;
  }

  if (sub === 'list') {
    const all = listAdoptions();
    if (all.length === 0) {
      console.log('raph: no adoptions yet — try "raph adopt <url|path>"');
      return 0;
    }
    for (const a of all) {
      const lessons = (a.taken ?? []).filter((t) => t.type === 'lesson').length;
      const skills = (a.taken ?? []).filter((t) => t.type === 'skill-draft').length;
      console.log(`${a.id}  [${a.status.toUpperCase()}]  ${a.kind}  ${a.source}`);
      console.log(`  ${a.ts?.slice(0, 16) ?? '?'}  license: ${fmtLicense(a.license)}  ->  ${lessons} lesson(s), ${skills} skill draft(s)`);
    }
    return 0;
  }

  if (sub === 'revoke') {
    const ref = args[1];
    if (!ref) {
      console.error('raph: usage: raph adopt revoke <id | source>');
      return 1;
    }
    try {
      const r = revokeAdoption(ref, { log: (s) => console.log(s) });
      if (r.already) console.log(`raph: ${r.adoption} was already revoked`);
      else console.log(`REVOKED ${r.adoption} — ${r.removed.length} item(s) undone (ledger keeps the history)`);
      return 0;
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
  }

  // default: adopt <source>
  const src = sub;
  const dryRun = args.includes('--dry-run');
  const kindHint = args.includes('--skill') ? 'skill' : null;
  const modelIdx = args.indexOf('--model');

  const cfg = loadConfig();
  const learning = cfg.learning ?? {};
  const config = {
    adopt_model: (modelIdx >= 0 ? args[modelIdx + 1] : undefined) ?? learning.adopt_model ?? learning.extract_model ?? 'claude-haiku-4-5-20251001',
    adopt_review_model: learning.adopt_review_model,
    dedupe_threshold: learning.dedupe_threshold ?? 0.6,
    rejection_expiry_days: learning.rejection_expiry_days ?? 180
  };

  if (dryRun) {
    try {
      const material = await loadSource(src, { kindHint });
      const estimate = Math.ceil((material.text.length / 3.5) * 2) + 2000; // review + extract passes
      console.log(`PLAN   ${material.kind}: ${material.source}`);
      console.log(`       ${material.text.length.toLocaleString()} chars${material.truncated ? ' (truncated at the adopt cap)' : ''} -> ~${(estimate / 1000).toFixed(1)}k tokens on ${config.adopt_model}`);
      console.log(`       license: ${fmtLicense(material.license)}`);
      console.log('raph: dry run — no model calls, nothing written');
      return 0;
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
  }

  let provider;
  try {
    provider = getModelCaller(cfg);
  } catch (err) {
    console.error(`raph: ${err.message}`);
    return 1;
  }
  console.log(`MODEL  provider=${provider.provider} (${provider.reason})${provider.provider === 'subscription' ? ' — fixed-price, no API metering' : ''}`);

  let result;
  try {
    result = await adoptSource(src, { callModel: provider.callModel, config, log: (s) => console.log(s), kindHint });
  } catch (err) {
    if (err.code === 'E-LIMIT') {
      console.error(`raph: STOPPED — ${err.message}`);
      console.error('      nothing was recorded; run the same adopt again after the limit resets');
      return 4;
    }
    console.error(`raph: ${err.message}`);
    return 1;
  }

  if (result.outcome === 'blocked') {
    console.error(`BLOCKED ${result.adoption} — reviewer: ${result.verdict.summary}`);
    for (const r of result.verdict.risks ?? []) console.error(`  [${r.kind}] ${r.detail}`);
    console.error('raph: nothing was staged; the block is recorded in "raph adopt list"');
    return 2;
  }

  console.log(`ADOPTED ${result.adoption}${result.truncated ? ' (material truncated at the adopt cap)' : ''}`);
  console.log(`FUNNEL  ${result.staged.length} lesson candidate(s) staged, ${result.skills.length} skill draft(s), ${result.dropped.length} dropped by gates`);
  for (const d of result.dropped) console.log(`  [dropped] ${d.title} — ${d.why}`);

  // the dial at 'wide' may activate reviewer-passed, non-security adoptions
  let autoActivated = 0;
  const eligible = result.staged.filter((s) => !s.quarantined);
  if (eligible.length > 0) {
    const auto = autoApproveStaged(eligible, { origin: 'adopted', config: cfg, adoption: result.adoption, log: (s) => console.log(s) });
    autoActivated = auto.activated.length;
    for (const sk of auto.skipped) console.log(`  [held] ${sk.slug} — ${sk.why}`);
  }
  if (autoActivated > 0) console.log(`AUTO    ${autoActivated} lesson(s) activated into the auto tier — undo all with "raph adopt revoke ${result.adoption}"`);
  if (result.staged.length - autoActivated > 0) console.log('NEXT    review with "raph queue" — nothing else activates without approval');
  if (result.skills.length > 0) console.log(`DRAFTS  staged/skills/ — a skill instructs agents; review before installing`);
  return 0;
}
