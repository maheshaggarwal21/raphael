// Optimizer loop (Phase 14 meta layer, docs/company-vision.md). One actionable
// "what should I prune / act on" screen for the brain, composed from the health
// engines already built: the retire sweep (confidence + retrieval), the retrieval
// miss (never-fired lessons), the confidence distribution, and agent coverage.
// It only ever RECOMMENDS — pruning a lesson is `raph retire --confirmed`, an agent
// change is a human roster edit. Pure over plain arrays; zero model tokens.

import { retireCandidates } from './freshness.js';
import { computeConfidence, confidenceBand } from './confidence.js';
import { AGENTS } from './agents.js';

export function buildOptimization({ lessons = [], events = [], agents = AGENTS, now = new Date() } = {}) {
  // 1. Retire candidates — the gated, security-exempt sweep (16.8a).
  const retire = retireCandidates(lessons, { events, now });

  // 2. Retrieval miss (all-time): active lessons that never fired. Security is
  //    reported separately — a never-fired security lesson guards a rare path and
  //    is NOT dead weight (honors the security floor).
  const injected = events.filter((e) => e.event === 'injected');
  const firedIds = new Set(injected.flatMap((e) => (e.lessons ?? []).map((l) => l.id)));
  const missed = lessons.filter((l) => !firedIds.has(l.id));
  const missedNonSec = missed.filter((l) => l.category !== 'security');

  // 3. Confidence distribution.
  const dist = { high: 0, medium: 0, low: 0 };
  for (const l of lessons) dist[confidenceBand(computeConfidence(l, { now }))]++;

  // 4. Agent coverage: how many active lessons are scoped to each roster agent.
  //    Informational — zero-coverage does NOT mean "prune the agent" (an agent
  //    still sees every un-scoped lesson); it flags where targeted advice is thin.
  const coverage = agents
    .map((a) => ({ slug: a.slug, scopedLessons: lessons.filter((l) => (l.scope?.agents ?? []).includes(a.slug)).length }))
    .sort((x, y) => x.scopedLessons - y.scopedLessons || x.slug.localeCompare(y.slug));

  return {
    ready: retire.ready,
    reason: retire.ready ? null : retire.reason,
    lessonCount: lessons.length,
    retire: retire.items,
    retrievalMiss: {
      total: missed.length,
      excludingSecurity: missedNonSec.length,
      sample: missedNonSec.slice(0, 8).map((l) => l.slug)
    },
    confidence: dist,
    agentCoverage: coverage
  };
}

export function renderOptimization(rep) {
  const L = [];
  L.push(`raph optimize — pruning + coverage over ${rep.lessonCount} active lesson(s)`);
  L.push('  (recommendations only — nothing is changed here)');

  L.push('');
  L.push('Retire candidates (low confidence + never retrieved)');
  if (!rep.ready) {
    L.push(`  skipped — ${rep.reason}`);
  } else if (!rep.retire.length) {
    L.push('  none — no active lesson is both low-confidence and never-retrieved.');
  } else {
    for (const it of rep.retire) L.push(`  ${it.slug}  [conf ${it.confidence}/10, ${it.category}, ${it.ageDays}d]  -> raph retire ${it.slug} --confirmed`);
  }

  L.push('');
  L.push(`Retrieval miss: ${rep.retrievalMiss.excludingSecurity}/${rep.lessonCount} non-security lessons have never fired`);
  if (rep.retrievalMiss.sample.length) {
    L.push(`  e.g. ${rep.retrievalMiss.sample.join(', ')}${rep.retrievalMiss.excludingSecurity > rep.retrievalMiss.sample.length ? ', …' : ''}`);
    L.push('  (fix triggers with "raph show <id>" then edit keywords/paths, or retire if obsolete)');
  }

  L.push('');
  L.push(`Confidence: ${rep.confidence.high} high · ${rep.confidence.medium} medium · ${rep.confidence.low} low`);

  L.push('');
  L.push('Agent coverage (targeted lessons per role — informational, not a prune list)');
  const thin = rep.agentCoverage.filter((a) => a.scopedLessons === 0).map((a) => a.slug);
  if (thin.length) L.push(`  no targeted lessons yet: ${thin.join(', ')}`);
  const covered = rep.agentCoverage.filter((a) => a.scopedLessons > 0);
  for (const a of covered) L.push(`  ${a.slug}: ${a.scopedLessons}`);
  if (!covered.length) L.push('  (no lesson is agent-scoped yet — every lesson applies to all roles)');

  return L.join('\n');
}
