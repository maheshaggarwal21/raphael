// Academy checkpoint store (ARCHITECTURE §12). The durable state that makes an
// autonomous build survive a Claude limit reset OR a PC restart: every step writes
// here, and any fresh session reads it to resume from the exact next action.
//
// State lives under ~/.raphael/academy/<project>/state.json (outside the project
// repos, so it survives even if a repo is reset). It is plain JSON, written
// atomically (tmp+rename), and never contains secrets.
//
// The autonomy boundary is enforced by convention + the `boundary` field: when a
// build reaches something that deploys / signs in / spends / publishes / pushes to a
// public remote, it calls recordBoundary() and STOPS. A resuming session that sees a
// boundary block does not proceed autonomously — it surfaces the ask to the owner.

import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

const SCHEMA = 'raphael/academy-state/v1';
export const STATUSES = ['in-progress', 'blocked-limit', 'blocked-boundary', 'done'];

function now() {
  return new Date().toISOString();
}

function statePath(project) {
  return path.join(p.academyProject(project), 'state.json');
}

// MISSING and CORRUPT are different answers. readState used to return null for
// both, and startProject treats null as "nothing here" — so a truncated state
// file (interrupted write, full disk, bad sector) was silently OVERWRITTEN with
// a blank project, destroying the milestones, the log, the `tried` dead-ends and
// the whole driver record: exactly the data the resume design exists to protect
// (audit 2026-07-26, finding 3.8). A corrupt file is now quarantined and thrown.
export function readState(project, { onCorrupt = 'throw' } = {}) {
  const fp = statePath(project);
  if (!existsSync(fp)) return null;
  let raw;
  try {
    raw = readFileSync(fp, 'utf8');
  } catch (err) {
    if (onCorrupt === 'null') return null;
    throw new Error(`E-ACADEMY: cannot read the state for "${project}" (${err.message}) — fix or move ${fp}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('state is not an object');
    return parsed;
  } catch (err) {
    if (onCorrupt === 'null') return null;
    // Preserve the evidence before anything can write over it.
    let kept = null;
    try {
      kept = `${fp}.corrupt-${Date.now()}`;
      renameSync(fp, kept);
    } catch {
      kept = null;
    }
    throw new Error(
      `E-ACADEMY: the state for "${project}" is unreadable (${err.message}). ` +
      (kept ? `The damaged file was kept at ${kept}. ` : `It is still at ${fp}. `) +
      'Nothing was overwritten — restore it, or run "raph academy start" to begin again.'
    );
  }
}

export function writeState(project, state) {
  atomicWrite(statePath(project), JSON.stringify(state, null, 2) + '\n');
  return state;
}

export function listProjects() {
  const dir = p.academy();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(statePath(name)));
}

// Parse "M1:Scaffold,M2:Keeper" into [{id:'M1', title:'Scaffold', done:false}, ...].
export function parseMilestones(spec) {
  return String(spec || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      const id = (i >= 0 ? s.slice(0, i) : s).trim();
      const title = (i >= 0 ? s.slice(i + 1) : s).trim();
      return { id, title, done: false };
    });
}

export function startProject(project, { title, workspace, milestones = [] } = {}) {
  const existing = readState(project);
  if (existing) return existing; // idempotent — never clobber a live build
  mkdirSync(p.academyProject(project), { recursive: true });
  const state = {
    schema: SCHEMA,
    project,
    title: title || project,
    workspace: workspace || null,
    status: 'in-progress',
    milestones,
    current: {
      milestone: milestones[0]?.id || null,
      step: 'project not started',
      next_action: 'scaffold the project'
    },
    boundary: null,
    log: [{ at: now(), note: `started: ${title || project}` }],
    created_at: now(),
    updated_at: now()
  };
  return writeState(project, state);
}

// Merge a checkpoint patch. Recognized fields: milestone, step, next, status, note,
// done (a milestone id to mark complete), tests (latest green test count), lessons
// (lessons written back to the brain so far), tried (a dead-end approach to record
// so a post-limit resume does NOT repeat it). Anything else is ignored on purpose.
export function checkpoint(project, patch = {}) {
  const state = readState(project);
  if (!state) throw new Error(`E-ACADEMY: no project "${project}" — start it first`);

  if (patch.milestone) state.current.milestone = patch.milestone;
  if (patch.step) state.current.step = patch.step;
  if (patch.next) state.current.next_action = patch.next;
  for (const field of ['tests', 'lessons']) {
    if (patch[field] === undefined) continue;
    const n = Number(patch[field]);
    if (!Number.isInteger(n) || n < 0) throw new Error(`E-ACADEMY: --${field} must be a non-negative integer`);
    state[field] = { count: n, at: now() };
  }
  if (patch.status) {
    if (!STATUSES.includes(patch.status)) throw new Error(`E-ACADEMY: bad status "${patch.status}"`);
    state.status = patch.status;
  }
  if (patch.done) {
    const m = state.milestones.find((x) => x.id === patch.done);
    if (m) m.done = true;
  }
  if (patch.tried) {
    const note = String(patch.tried).trim();
    if (note) state.tried = [...(state.tried || []), { at: now(), note }];
  }
  if (patch.note) state.log.push({ at: now(), note: patch.note });
  state.updated_at = now();
  // A plain checkpoint clears a prior limit block (we are clearly running again).
  if (state.status === 'blocked-limit' && !patch.status) state.status = 'in-progress';
  return writeState(project, state);
}

// The build hit the autonomy boundary. Record WHAT the human must do and STOP.
export function recordBoundary(project, reason) {
  const state = readState(project);
  if (!state) throw new Error(`E-ACADEMY: no project "${project}"`);
  state.status = 'blocked-boundary';
  state.boundary = { reason, at: now() };
  state.current.next_action = `OWNER ACTION NEEDED: ${reason}`;
  state.log.push({ at: now(), note: `boundary: ${reason}` });
  state.updated_at = now();
  return writeState(project, state);
}

// Record that a Claude usage limit stopped us; note when to resume if known.
export function recordLimit(project, { resetAt } = {}) {
  const state = readState(project);
  if (!state) throw new Error(`E-ACADEMY: no project "${project}"`);
  state.status = 'blocked-limit';
  state.limit = { at: now(), reset_at: resetAt || null };
  state.log.push({ at: now(), note: `limit hit${resetAt ? `, resets ${resetAt}` : ''}` });
  state.updated_at = now();
  return writeState(project, state);
}

// A one-screen human summary of where a build stands.
export function renderStatus(state) {
  if (!state) return 'no such academy project';
  const done = state.milestones.filter((m) => m.done).length;
  const lines = [];
  lines.push(`Academy project: ${state.project} — ${state.title}`);
  lines.push(`  status:    ${state.status}`);
  lines.push(`  workspace: ${state.workspace || '(none)'}`);
  lines.push(`  progress:  ${done}/${state.milestones.length} milestones`);
  for (const m of state.milestones) lines.push(`    [${m.done ? 'x' : ' '}] ${m.id} ${m.title}`);
  if (state.tests) lines.push(`  tests:     ${state.tests.count} green (recorded ${state.tests.at.slice(0, 10)})`);
  if (state.lessons) lines.push(`  lessons:   ${state.lessons.count} written back to the brain`);
  lines.push(`  current:   ${state.current.milestone || '—'} · ${state.current.step}`);
  lines.push(`  NEXT:      ${state.current.next_action}`);
  if (state.tried?.length) {
    lines.push(`  TRIED (dead ends — do not repeat):`);
    for (const t of state.tried) lines.push(`    - ${t.note}`);
  }
  // Judgement calls the autopilot made in place of a human. The whole point of
  // letting a stage decide for itself is that the owner can read what it decided
  // afterwards — an unread decision is indistinguishable from a silent guess.
  const decided = [];
  for (const [kind, rec] of Object.entries(state.driver?.stages ?? {})) {
    for (const d of rec?.decisions ?? []) decided.push({ kind, note: d });
  }
  if (decided.length > 0) {
    lines.push('  DECIDED (the autopilot chose these itself — review them):');
    for (const d of decided) lines.push(`    - [${d.kind}] ${d.note}`);
  }
  if (state.boundary) lines.push(`  BOUNDARY:  ${state.boundary.reason} (since ${state.boundary.at})`);
  if (state.status === 'blocked-limit' && state.limit) lines.push(`  LIMIT:     hit ${state.limit.at}, resets ${state.limit.reset_at || 'unknown'}`);
  lines.push(`  updated:   ${state.updated_at}`);
  return lines.join('\n');
}
