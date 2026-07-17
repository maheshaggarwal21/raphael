// Decision ledger (Phase 16.8b, from the gstack audit — docs/atlas-upgrade-plan.md
// addendum). A durable, append-only record of the durable calls a project has made —
// architecture, scope, vendor, "we decided X because Y". Distinct from:
//   - lessons  (advice: "do/don't do X" — go through the validate chokepoint), and
//   - academy checkpoints (transient build state).
// The point is to STOP RE-LITIGATING settled questions: the active set is surfaced
// at session start so the agent doesn't re-open a decision the owner already made.
//
// Storage is one JSONL line per record (append-only, never rewritten). A decision
// can SUPERSEDE earlier ones; supersede is monotonic, so history stays intact and
// "what holds now" is computed at read time. Secrets are scrubbed before anything
// is written OR shown (invariant #2), because decision text is user-pasted prose
// and gets injected. Decisions are advisory DATA — nothing in one commands an agent.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { decisionId } from './ulid.js';
import { scrubSecrets } from './scrub.js';
import { p } from './paths.js';

const MAX_TITLE = 120;
const MAX_TEXT = 1000;

const clip = (s, n) => {
  const scrubbed = scrubSecrets(String(s ?? '')).text ?? String(s ?? '');
  return scrubbed.trim().slice(0, n);
};

// Append a decision. `supersedes` is a list of dec_ ids this one replaces.
// Returns the stored record.
export function recordDecision({ title, rationale = '', supersedes = [], tags = [], now = new Date() } = {}) {
  const t = clip(title, MAX_TITLE);
  if (!t) throw new Error('E-DECISION: a decision needs a non-empty title');
  const rec = {
    id: decisionId(now.getTime()),
    ts: now.toISOString(),
    title: t,
    rationale: clip(rationale, MAX_TEXT),
    supersedes: (Array.isArray(supersedes) ? supersedes : [supersedes]).filter((x) => /^dec_/.test(String(x))),
    tags: (tags || []).map((x) => String(x).slice(0, 40)).slice(0, 8)
  };
  const file = p.decisionsLedger();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
}

// All records, oldest first. Corrupt lines are skipped, not fatal.
export function readDecisions() {
  const file = p.decisionsLedger();
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

// The decisions that currently hold: any id named in some record's `supersedes`
// is retired. Newest first. Pure over the records array.
export function activeDecisions(records = readDecisions()) {
  const superseded = new Set();
  for (const r of records) for (const id of r.supersedes ?? []) superseded.add(id);
  return records
    .filter((r) => !superseded.has(r.id))
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
}

// The session-start block: the active decisions, compact, data-framed. Returns ''
// when there are none (capability-check — never inject an empty ceremony).
export function decisionsDigest(records = readDecisions(), { max = 8 } = {}) {
  const active = activeDecisions(records).slice(0, max);
  if (!active.length) return '';
  const lines = active.map((d) => `- ${d.title}${d.rationale ? ` — ${d.rationale}` : ''}`);
  return lines.join('\n');
}

export function renderDecisions(records = readDecisions()) {
  const active = activeDecisions(records);
  const L = [];
  L.push(`raph decide — ${active.length} standing decision(s) of ${records.length} recorded`);
  if (!active.length) {
    L.push('');
    L.push('  none yet. Record one with: raph decide "<what was decided>" --why "<why>"');
    return L.join('\n');
  }
  L.push('');
  for (const d of active) {
    L.push(`  ${d.id.slice(0, 12)}…  ${d.title}`);
    if (d.rationale) L.push(`      why: ${d.rationale}`);
    if (d.supersedes?.length) L.push(`      supersedes: ${d.supersedes.map((s) => s.slice(0, 12) + '…').join(', ')}`);
    if (d.tags?.length) L.push(`      tags: ${d.tags.join(', ')}`);
  }
  L.push('');
  L.push('These are surfaced at session start so settled calls are not re-litigated.');
  return L.join('\n');
}
