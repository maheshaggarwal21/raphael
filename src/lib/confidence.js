// Computed confidence (Phase 16.8a, from the gstack audit — docs/atlas-upgrade-plan.md
// addendum). A deterministic 0-10 score per lesson, derived from its evidence and
// decayed by age. gstack lets the model set a 1-10 confidence by hand; Raphael
// computes it from what it can actually measure, so it can't be gamed and is the
// same for everyone. Kept SEPARATE from the rank() scorer (which has its own bounded
// prior) — this is a health/retirement signal, not a retrieval weight. Zero tokens.
//
// Shape of the score (0-10):
//   evidence  = breadth (distinct projects) counts for more than raw repetition,
//               because a lesson seen across many projects generalises;
//   age decay = evidence ages with a ~180-day half-life (a fact observed once, long
//               ago, is weaker today) — applied to the evidence part only;
//   tier      = curated (human-vetted expert packs) floor at 6 and resist age;
//               auto (machine-derived) take a small discount;
//   human_edited adds a small bump (a person read and fixed the wording).

const HALF_LIFE_DAYS = 180;

export function computeConfidence(lesson, { now = new Date() } = {}) {
  const ev = lesson.evidence ?? {};
  const obs = Math.max(0, Number(ev.observations) || 0);
  const proj = Math.max(0, Number(ev.distinct_projects) || 0);

  // 0..4 from repetition (saturating), 0..4 from breadth (3+ projects = full).
  const obsScore = 4 * Math.min(1, Math.log2(1 + obs) / Math.log2(1 + 8));
  const projScore = 4 * Math.min(1, proj / 3);

  // Age decay on the evidence-derived part only.
  const seen = ev.last_seen || ev.first_seen || null;
  let decay = 1;
  if (seen) {
    const ageDays = (now.getTime() - Date.parse(seen)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > 0) decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }

  let c = (obsScore + projScore) * decay;
  if (lesson.provenance?.human_edited) c += 1;

  const tier = lesson.provenance?.tier;
  if (tier === 'curated') c = Math.max(c, 6);              // expert floor, resists age
  else if (tier === 'auto' || tier === 'machine') c *= 0.9; // machine-derived discount (probation)

  return Math.max(0, Math.min(10, Number(c.toFixed(1))));
}

export function confidenceBand(c) {
  if (c >= 7) return 'high';
  if (c >= 4) return 'medium';
  return 'low';
}

// Age of a lesson's evidence in whole days (null when it carries no date).
export function ageDays(lesson, now = new Date()) {
  const seen = lesson.evidence?.last_seen || lesson.evidence?.first_seen || null;
  if (!seen) return null;
  const d = (now.getTime() - Date.parse(seen)) / 86_400_000;
  return Number.isFinite(d) ? Math.round(d) : null;
}
