// Self-use analytics (Phase 10). Turns the append-only audit log
// (state/events.jsonl) + the compiled index into the three signals the
// self-use period is meant to surface:
//   - token cost      : what recall actually costs per injection / per session
//   - retrieval miss  : active lessons that NEVER fire (dead weight, or triggers
//                       so narrow the lesson can't be found — the thing to fix)
//   - false-fire proxy: lessons that fire on prompts at a score barely over the
//                       trigger threshold (a noise signal; true false-fire needs
//                       a user "unhelpful" channel we don't have yet — labeled
//                       honestly as a proxy)
// Pure functions over plain arrays so the whole thing is testable without disk.

export const PROMPT_THRESHOLD = 4.0;   // matches inject.js user-prompt gate
export const LOW_SCORE_MARGIN = 0.5;   // avg prompt score < 4.5 = "just cleared the bar"

export function computeStats(events, activeLessons = []) {
  const injected = events.filter((e) => e.event === 'injected');

  const perLesson = new Map(); // id -> aggregate
  const sessions = new Map();  // session_id -> tokens
  let tokensTotal = 0;
  let sessionStart = 0;
  let userPrompt = 0;
  let capHits = 0;
  let first = null;
  let last = null;

  for (const e of injected) {
    tokensTotal += Number(e.tokens) || 0;
    if (e.hook === 'session-start') sessionStart++;
    else if (e.hook === 'user-prompt') userPrompt++;
    if (e.cap_reached) capHits++;
    if (e.ts) {
      if (!first || e.ts < first) first = e.ts;
      if (!last || e.ts > last) last = e.ts;
    }
    const sid = e.session_id || 'unknown';
    sessions.set(sid, (sessions.get(sid) || 0) + (Number(e.tokens) || 0));

    for (const l of e.lessons ?? []) {
      let agg = perLesson.get(l.id);
      if (!agg) {
        agg = {
          id: l.id, slug: l.slug, severity: l.severity,
          count: 0, scoreSum: 0, promptCount: 0, promptScoreSum: 0, lastFired: null
        };
        perLesson.set(l.id, agg);
      }
      agg.count++;
      agg.scoreSum += Number(l.score) || 0;
      if (e.hook === 'user-prompt') {
        agg.promptCount++;
        agg.promptScoreSum += Number(l.score) || 0;
      }
      if (e.ts && (!agg.lastFired || e.ts > agg.lastFired)) agg.lastFired = e.ts;
    }
  }

  const fired = [...perLesson.values()]
    .map((a) => ({
      id: a.id, slug: a.slug, severity: a.severity, count: a.count,
      avgScore: a.count ? Number((a.scoreSum / a.count).toFixed(2)) : 0,
      lastFired: a.lastFired
    }))
    .sort((x, y) => y.count - x.count || x.slug.localeCompare(y.slug));

  const firedIds = new Set(perLesson.keys());
  const neverFired = activeLessons
    .filter((l) => !firedIds.has(l.id))
    .map((l) => ({ id: l.id, slug: l.slug, severity: l.severity, category: l.category }))
    .sort((x, y) => x.slug.localeCompare(y.slug));

  const lowScoreFires = [...perLesson.values()]
    .filter((a) => a.promptCount > 0 && a.promptScoreSum / a.promptCount < PROMPT_THRESHOLD + LOW_SCORE_MARGIN)
    .map((a) => ({
      slug: a.slug, count: a.promptCount,
      avgScore: Number((a.promptScoreSum / a.promptCount).toFixed(2))
    }))
    .sort((x, y) => y.count - x.count || x.slug.localeCompare(y.slug));

  const totalSessionTokens = [...sessions.values()].reduce((a, b) => a + b, 0);

  // Atlas leverage: the latest `raph atlas bench` result per project — the
  // measured tokens-to-answer saving of the deterministic graph over a raw
  // grep-and-read. Not injection cost; a separate, honest efficiency signal.
  const latestBench = new Map();
  for (const e of events) {
    if (e.event !== 'atlas-bench') continue;
    const proj = e.project || 'unknown';
    const prev = latestBench.get(proj);
    if (!prev || (e.ts && e.ts > (prev.ts || ''))) latestBench.set(proj, e);
  }
  const atlasBench = [...latestBench.values()]
    .map((e) => ({
      project: e.project || 'unknown',
      ratio: e.ratio ?? null,
      questions: Number(e.questions) || 0,
      rawTokens: Number(e.rawTokens) || 0,
      graphTokens: Number(e.graphTokens) || 0,
      saved: Number(e.saved) || 0,
      ts: e.ts || null
    }))
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  return {
    window: { from: first, to: last },
    injections: {
      total: injected.length,
      sessionStart,
      userPrompt,
      tokensTotal,
      tokensAvg: injected.length ? Math.round(tokensTotal / injected.length) : 0,
      sessions: sessions.size,
      tokensPerSessionAvg: sessions.size ? Math.round(totalSessionTokens / sessions.size) : 0,
      capHits
    },
    lessons: {
      active: activeLessons.length,
      firedCount: fired.length,
      fired,
      neverFired,
      lowScoreFires
    },
    atlas: { benches: atlasBench },
    review: {
      approved: events.filter((e) => e.event === 'approved').length,
      rejected: events.filter((e) => e.event === 'rejected').length,
      suppressed: events.filter((e) => e.event === 'suppressed-by-rejection-memory').length
    }
  };
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

export function renderStats(s, { topN = 8, listN = 12 } = {}) {
  const L = [];
  L.push('raph stats — self-use report (from the injection audit log)');

  const hasInj = s.injections.total > 0;
  const hasReview = s.review.approved + s.review.rejected + s.review.suppressed > 0;
  const benches = s.atlas?.benches ?? [];

  if (!hasInj && !hasReview && !benches.length) {
    L.push('');
    L.push('  nothing recorded yet — approve some lessons and use the agent with');
    L.push('  injection on ("raph on"), then check back. Mining and review work regardless.');
    return L.join('\n');
  }

  L.push('');
  L.push('Injection cost');
  if (hasInj) {
    const win = s.window.from ? `${s.window.from.slice(0, 10)} -> ${s.window.to.slice(0, 10)}` : 'n/a';
    L.push(`  injections : ${s.injections.total}  (${s.injections.sessionStart} session-start, ${s.injections.userPrompt} user-prompt)`);
    L.push(`  tokens     : ${s.injections.tokensTotal.toLocaleString()} total  ~${s.injections.tokensAvg}/injection`);
    L.push(`  sessions   : ${s.injections.sessions}  ~${s.injections.tokensPerSessionAvg} tokens/session  ${s.injections.capHits} hit the 1,200 cap`);
    L.push(`  window     : ${win}`);
  } else {
    L.push('  no injections yet — the recall hooks have not fired in a live session.');
    L.push('  (Turn injection on with "raph on" and use a hooked agent; then this fills in.)');
  }

  L.push('');
  if (hasInj) {
    L.push(`Lesson firing  (${s.lessons.firedCount} of ${s.lessons.active} active lessons have ever fired)`);
    if (s.lessons.fired.length) {
      L.push('  most useful (top fired):');
      for (const f of s.lessons.fired.slice(0, topN)) {
        L.push(`    ${String(f.count).padStart(4)}x  ${f.slug}  [${f.severity}]  avg score ${f.avgScore}`);
      }
    }
    L.push('');
    const nf = s.lessons.neverFired;
    L.push(`  never fired : ${nf.length}/${s.lessons.active} (${pct(nf.length, s.lessons.active)}%)  <- dead weight or a retrieval miss (triggers too narrow)`);
    for (const l of nf.slice(0, listN)) {
      L.push(`      - ${l.slug}  [${l.category}/${l.severity}]`);
    }
    if (nf.length > listN) L.push(`      ...and ${nf.length - listN} more (raph stats --json for the full list)`);

    if (s.lessons.lowScoreFires.length) {
      L.push('');
      L.push(`  noise watch : ${s.lessons.lowScoreFires.length} lesson(s) fire on prompts barely over the ${PROMPT_THRESHOLD} threshold`);
      L.push('               (a proxy — a true false-fire signal needs a user "unhelpful" mark, not built yet)');
      for (const l of s.lessons.lowScoreFires.slice(0, listN)) {
        L.push(`      - ${l.slug}  ${l.count}x  avg ${l.avgScore}`);
      }
    }
    L.push('');
    L.push('What to do with this:');
    L.push('  - never-fired security lessons are fine (they guard rare paths); never-fired');
    L.push('    everyday lessons usually need better triggers (raph show <id>, edit keywords/paths).');
    L.push('  - a noise-watch lesson that is not helping: tighten its triggers or reject it.');
  } else {
    L.push(`Lessons : ${s.lessons.active} active, awaiting their first live injection.`);
  }

  if (benches.length) {
    L.push('');
    L.push('Atlas leverage  (tokens-to-answer, deterministic graph vs raw grep-and-read)');
    for (const b of benches) {
      if (b.ratio != null) {
        L.push(`  ${b.project} : ${b.ratio}x fewer  (${b.rawTokens.toLocaleString()} grep+read -> ${b.graphTokens.toLocaleString()} graph over ${b.questions} question(s)${b.ts ? `, ${b.ts.slice(0, 10)}` : ''})`);
      } else {
        L.push(`  ${b.project} : no readable candidate files to compare${b.ts ? ` (${b.ts.slice(0, 10)})` : ''}`);
      }
    }
    L.push('  (zero model tokens to build or measure — run "raph atlas bench" to refresh)');
  }

  L.push('');
  L.push('Review funnel');
  L.push(`  approved ${s.review.approved} · rejected ${s.review.rejected} · suppressed ${s.review.suppressed}`);
  return L.join('\n');
}
