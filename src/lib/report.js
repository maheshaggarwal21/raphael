// The board report (Phase 14, docs/company-vision.md Part 6 item 3): what the
// company did in the last N days, in one screen — build activity, brain
// changes, recall cost, retrieval misses, adoptions, and what needs the owner.
// Pure computation over data that already exists (academy states, the audit
// log, the adoption ledger, the compiled index); reads only, no model, no
// network. `now` is a parameter so every window is testable.

import { listProjects, readState } from './academy.js';
import { readEvents } from './events.js';
import { listAdoptions } from './provenance.js';
import { loadIndex } from './compile.js';

export const DEFAULT_DAYS = 7;

export function computeWeekly({ states = [], events = [], adoptions = [], activeLessons = [], now = new Date(), days = DEFAULT_DAYS } = {}) {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const inWindow = (ts) => typeof ts === 'string' && ts >= from && ts <= to;

  // Build activity: what each project's checkpoint log says happened this window.
  const builds = states
    .map((s) => {
      const notes = (s.log || []).filter((l) => inWindow(l.at));
      return {
        project: s.project,
        status: s.status,
        notesInWindow: notes.length,
        latestNote: notes.length ? notes[notes.length - 1].note : null,
        tests: s.tests?.count ?? null,
        lessonsWritten: s.lessons?.count ?? null
      };
    })
    .filter((b) => b.notesInWindow > 0)
    .sort((a, b) => b.notesInWindow - a.notesInWindow);

  // Brain changes: the review/adopt funnel inside the window.
  const win = events.filter((e) => inWindow(e.ts));
  const count = (name) => win.filter((e) => e.event === name).length;
  const brain = {
    approved: count('approved'),
    autoApproved: count('auto-approved'),
    rejected: count('rejected'),
    suppressed: count('suppressed-by-rejection-memory'),
    adopted: count('adopted'),
    adoptBlocked: count('adopt-blocked'),
    adoptRevoked: count('adopt-revoked')
  };

  // Recall cost inside the window.
  const injected = win.filter((e) => e.event === 'injected');
  const recall = {
    injections: injected.length,
    tokens: injected.reduce((a, e) => a + (Number(e.tokens) || 0), 0),
    sessions: new Set(injected.map((e) => e.session_id || 'unknown')).size,
    capHits: injected.filter((e) => e.cap_reached).length
  };

  // Atlas leverage: bench runs inside the window, with the best measured ratio
  // (the deterministic graph's tokens-to-answer saving over a raw grep-and-read).
  const benchWin = win.filter((e) => e.event === 'atlas-bench');
  const latestBench = benchWin.reduce((m, e) => (!m || (e.ts || '') > (m.ts || '') ? e : m), null);
  const atlas = {
    benches: benchWin.length,
    bestRatio: benchWin.reduce((m, e) => (e.ratio != null && (m == null || e.ratio > m) ? e.ratio : m), null),
    latest: latestBench
      ? { project: latestBench.project || 'unknown', ratio: latestBench.ratio ?? null, questions: Number(latestBench.questions) || 0 }
      : null
  };

  // Retrieval miss is an ALL-TIME signal (a lesson that never fired is dead
  // weight regardless of the window) — computed over the full log on purpose.
  const firedIds = new Set(
    events.filter((e) => e.event === 'injected').flatMap((e) => (e.lessons || []).map((l) => l.id))
  );
  const neverFired = activeLessons.filter((l) => !firedIds.has(l.id));
  const misses = {
    active: activeLessons.length,
    neverFired: neverFired.length,
    sample: neverFired.slice(0, 5).map((l) => l.slug)
  };

  // Adoptions whose latest ledger entry falls in the window.
  const adopted = adoptions
    .filter((a) => inWindow(a.ts))
    .map((a) => ({
      id: a.id,
      source: a.source,
      kind: a.kind,
      status: a.status,
      lessons: (a.taken || []).filter((t) => t.type === 'lesson').length,
      skills: (a.taken || []).filter((t) => t.type === 'skill-draft').length
    }));

  // What happens next / what waits on the owner — current state, not windowed.
  const next = states
    .filter((s) => s.status !== 'done')
    .map((s) => ({
      project: s.project,
      status: s.status,
      next: s.current?.next_action || null,
      boundary: s.boundary?.reason || null
    }));

  return { window: { from, to, days }, builds, brain, recall, atlas, misses, adoptions: adopted, next };
}

// Disk wrapper — the one the CLI verb and the console both call.
export function readWeekly({ now = new Date(), days = DEFAULT_DAYS } = {}) {
  const states = listProjects().map((name) => readState(name)).filter(Boolean);
  const { lessons } = loadIndex();
  return computeWeekly({ states, events: readEvents(), adoptions: listAdoptions(), activeLessons: lessons, now, days });
}

export function renderWeekly(r) {
  const L = [];
  L.push(`raph report weekly — the board report (${r.window.from.slice(0, 10)} -> ${r.window.to.slice(0, 10)})`);

  L.push('');
  L.push('Build activity');
  if (r.builds.length) {
    for (const b of r.builds) {
      L.push(`  ${b.project} [${b.status}] — ${b.notesInWindow} checkpoint note(s)${b.tests != null ? `, ${b.tests} tests green` : ''}${b.lessonsWritten != null ? `, ${b.lessonsWritten} lessons written back` : ''}`);
      if (b.latestNote) L.push(`    latest: ${b.latestNote}`);
    }
  } else {
    L.push('  no academy checkpoints this window');
  }

  L.push('');
  L.push('Brain changes');
  L.push(`  activated : ${r.brain.approved} approved by hand + ${r.brain.autoApproved} auto-approved (dial)`);
  L.push(`  rejected  : ${r.brain.rejected} (+${r.brain.suppressed} suppressed by rejection memory)`);
  L.push(`  adopt     : ${r.brain.adopted} run(s), ${r.brain.adoptBlocked} blocked by the reviewer, ${r.brain.adoptRevoked} revoked`);

  L.push('');
  L.push('Recall cost');
  if (r.recall.injections) {
    L.push(`  ${r.recall.injections} injection(s) across ${r.recall.sessions} session(s) — ${r.recall.tokens.toLocaleString()} tokens, ${r.recall.capHits} cap hit(s)`);
  } else {
    L.push('  no injections this window');
  }

  if (r.atlas && r.atlas.benches) {
    L.push('');
    L.push('Atlas leverage');
    const a = r.atlas;
    const best = a.bestRatio != null ? `${a.bestRatio}x fewer tokens to answer (best)` : 'no readable-file comparison';
    L.push(`  ${a.benches} bench run(s) — ${best}${a.latest ? `; latest: ${a.latest.project}, ${a.latest.questions} question(s)` : ''}`);
  }

  L.push('');
  L.push(`Retrieval miss (all-time): ${r.misses.neverFired}/${r.misses.active} active lessons have never fired`);
  if (r.misses.sample.length) L.push(`  e.g. ${r.misses.sample.join(', ')}${r.misses.neverFired > r.misses.sample.length ? ', …' : ''}`);

  if (r.adoptions.length) {
    L.push('');
    L.push('Adoptions this window');
    for (const a of r.adoptions) {
      L.push(`  ${a.id.slice(0, 12)}…  ${a.kind}  ${a.status}  ${a.lessons} lesson(s) + ${a.skills} skill draft(s) — ${a.source}`);
    }
  }

  L.push('');
  L.push('Next / waiting on the owner');
  if (r.next.length) {
    for (const n of r.next) {
      L.push(`  ${n.project} [${n.status}]${n.boundary ? ` OWNER: ${n.boundary}` : n.next ? ` next: ${n.next}` : ''}`);
    }
  } else {
    L.push('  all academy projects are done — pick the next build');
  }
  return L.join('\n');
}
