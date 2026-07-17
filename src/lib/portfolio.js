// Portfolio registry (Phase 14, docs/company-vision.md Part 6 item 6): the
// company's project table. One row per Academy build — status, milestone
// progress, recorded green-test count, lessons written back to the brain, and
// what recall spent inside that project. Pure aggregation over data that
// already exists (academy checkpoints + the injection audit log); reads only,
// no model, no network.
//
// tests/lessons come from explicit `raph academy checkpoint --tests/--lessons`
// records, NOT from lesson scope attribution — scope.projects is empty on the
// real brain's writeback lessons, so deriving the count from the index would
// silently report 0 for every project.

import { listProjects, readState } from './academy.js';
import { readEvents } from './events.js';

// Pure: plain arrays in, plain object out — tests need no disk.
export function buildPortfolio({ states = [], events = [] } = {}) {
  const injected = events.filter((e) => e.event === 'injected');

  const projects = states
    .map((s) => {
      const milestones = s.milestones || [];
      const inj = injected.filter((e) => e.project === s.project);
      return {
        project: s.project,
        title: s.title || s.project,
        status: s.status,
        workspace: s.workspace || null,
        milestones: { done: milestones.filter((m) => m.done).length, total: milestones.length },
        tests: s.tests?.count ?? null,
        lessonsWritten: s.lessons?.count ?? null,
        recall: {
          injections: inj.length,
          tokens: inj.reduce((a, e) => a + (Number(e.tokens) || 0), 0)
        },
        boundary: s.boundary?.reason || null,
        next: s.status === 'done' ? null : s.current?.next_action || null,
        updated_at: s.updated_at || null
      };
    })
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return {
    projects,
    totals: {
      projects: projects.length,
      done: projects.filter((x) => x.status === 'done').length,
      inProgress: projects.filter((x) => x.status === 'in-progress').length,
      blocked: projects.filter((x) => String(x.status).startsWith('blocked')).length,
      tests: projects.reduce((a, x) => a + (x.tests || 0), 0),
      lessonsWritten: projects.reduce((a, x) => a + (x.lessonsWritten || 0), 0),
      recallTokens: projects.reduce((a, x) => a + x.recall.tokens, 0)
    }
  };
}

// Disk wrapper — the one the CLI verb and the console both call.
export function readPortfolio() {
  const states = listProjects().map((name) => readState(name)).filter(Boolean);
  return buildPortfolio({ states, events: readEvents() });
}

function cell(v, width) {
  return String(v ?? '—').padEnd(width);
}

export function renderPortfolio(pf) {
  const L = [];
  L.push('raph portfolio — every Academy project, one table');
  L.push('');
  if (!pf.projects.length) {
    L.push('  no academy projects yet — `raph academy start <name>` begins one.');
    return L.join('\n');
  }

  const nameW = Math.max(12, ...pf.projects.map((x) => x.project.length + 2));
  L.push(`  ${cell('project', nameW)}${cell('status', 18)}${cell('prog', 6)}${cell('tests', 7)}${cell('lessons', 9)}${cell('recall', 14)}updated`);
  for (const x of pf.projects) {
    const prog = `${x.milestones.done}/${x.milestones.total}`;
    const recall = x.recall.injections ? `${x.recall.tokens} tok/${x.recall.injections}x` : '—';
    L.push(`  ${cell(x.project, nameW)}${cell(x.status, 18)}${cell(prog, 6)}${cell(x.tests, 7)}${cell(x.lessonsWritten, 9)}${cell(recall, 14)}${(x.updated_at || '').slice(0, 10)}`);
    if (x.boundary) L.push(`  ${' '.repeat(nameW)}BOUNDARY: ${x.boundary}`);
    if (x.next) L.push(`  ${' '.repeat(nameW)}next: ${x.next}`);
  }

  const t = pf.totals;
  L.push('');
  L.push(`  totals: ${t.projects} project(s) — ${t.done} done, ${t.inProgress} in progress, ${t.blocked} blocked`);
  L.push(`          ${t.tests} green tests recorded · ${t.lessonsWritten} lessons written back · ${t.recallTokens} recall tokens spent in builds`);
  L.push('  (tests/lessons are what builds recorded via `raph academy checkpoint --tests/--lessons`;');
  L.push('   recall = injection tokens the hooks spent inside each project.)');
  return L.join('\n');
}
