// The auto-approve dial (ARCHITECTURE §9 auto tier + §13's dial; owner decision
// §11.11 keeps the floor). Levels:
//
//   off       (curator default)  nothing activates without a human
//   standard  (arise default)    own MINED lessons that passed every gate
//   wide                          + ADOPTED lessons that passed the reviewer
//   full      (autopilot, §11.13) + security lessons — but ONLY through the
//             machine-curator path (lib/curator.js: reviewer screen + canary
//             gate + probation), never through this plain dial
//
// Outside THIS dial function at every level: security-category candidates and
// anything quarantined. Security rides only the curator's tier-'machine' path
// (the chokepoint's E-AUTOSEC blocks tier auto + security structurally even if
// this code were wrong); quarantined content never machine-activates anywhere
// — that is the one floor that survives §11.13.
//
// Blast-radius controls (§9 table): activated lessons carry provenance.tier
// 'auto' (visible, filterable, first to prune), a hard cap on total auto-tier
// lessons, a daily cap for adopted material, and every activation is a logged
// 'auto-approved' event. `raph adopt revoke` retires them by source in one step.

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseLessonFile, serializeLessonFile } from './frontmatter.js';
import { validateLesson } from './validate.js';
import { atomicWrite } from './files.js';
import { logEvent } from './events.js';
import { commitBrain } from './braingit.js';
import { buildIndex } from './compile.js';
import { p } from './paths.js';

export const DIAL_LEVELS = ['off', 'standard', 'wide', 'full'];
const DEFAULT_CAP = 30;
const DEFAULT_DAILY_CAP = 10;

// Fail closed: any unknown/missing value reads as 'off'.
export function dialLevel(cfg) {
  const v = cfg?.auto_approve?.level;
  return DIAL_LEVELS.includes(v) ? v : 'off';
}

export function dialCaps(cfg) {
  const a = cfg?.auto_approve ?? {};
  return {
    cap: Number.isInteger(a.cap) && a.cap >= 0 ? a.cap : DEFAULT_CAP,
    dailyCap: Number.isInteger(a.daily_cap) && a.daily_cap >= 0 ? a.daily_cap : DEFAULT_DAILY_CAP
  };
}

// Set the dial. The ONE place `raph auto` and the console's settings page both
// write through — validates, mutates cfg.auto_approve, returns the new view.
// Throws E-DIAL on bad input; the caller decides how to print it.
export function setDial(cfg, { level, cap, dailyCap } = {}) {
  let changed = false;
  if (level !== undefined) {
    if (!DIAL_LEVELS.includes(level)) {
      throw new Error(`E-DIAL: unknown level "${level}" — use off, standard, wide, or full`);
    }
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), level };
    changed = true;
  }
  if (cap !== undefined) {
    if (!Number.isInteger(cap) || cap < 0) throw new Error('E-DIAL: cap needs a non-negative integer');
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), cap };
    changed = true;
  }
  if (dailyCap !== undefined) {
    if (!Number.isInteger(dailyCap) || dailyCap < 0) throw new Error('E-DIAL: daily cap needs a non-negative integer');
    cfg.auto_approve = { ...(cfg.auto_approve ?? {}), daily_cap: dailyCap };
    changed = true;
  }
  return { changed, level: dialLevel(cfg), ...dialCaps(cfg) };
}

function walkLessons() {
  const out = [];
  const stack = [p.lessons()];
  while (stack.length) {
    const dir = stack.pop();
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  }
  return out;
}

export function countAutoTier() {
  // 'auto' (plain dial) and 'machine' (curator, §11.13) share the one cap —
  // both are machine-activated tiers a human never clicked.
  let n = 0;
  for (const file of walkLessons()) {
    try {
      const tier = parseLessonFile(readFileSync(file, 'utf8')).data.provenance?.tier;
      if (tier === 'auto' || tier === 'machine') n++;
    } catch { /* unreadable lesson — doctor's problem */ }
  }
  return n;
}

// Today's auto-approvals of adopted material, from the event log.
export function countAdoptedAutoToday(now = new Date()) {
  const file = p.events();
  if (!existsSync(file)) return 0;
  const today = now.toISOString().slice(0, 10);
  let n = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.event === 'auto-approved' && e.origin === 'adopted' && String(e.ts).slice(0, 10) === today) n++;
    } catch { /* torn line */ }
  }
  return n;
}

// Try to auto-activate freshly STAGED candidates (paths in candidates/ only —
// quarantine is outside the dial by construction).
//   staged: [{ path, ... }]   origin: 'mined' | 'adopted'
// Returns { level, activated: [...], skipped: [{ slug, why }] }.
export function autoApproveStaged(staged, { origin, config = {}, project = null, adoption = null, log = () => {} } = {}) {
  const level = dialLevel(config);
  const result = { level, activated: [], skipped: [] };
  if (!staged?.length || level === 'off') return result;
  if (origin === 'adopted' && level !== 'wide' && level !== 'full') return result;

  const { cap, dailyCap } = dialCaps(config);
  let autoCount = countAutoTier();
  let adoptedToday = origin === 'adopted' ? countAdoptedAutoToday() : 0;

  for (const item of staged) {
    let parsed;
    try {
      parsed = parseLessonFile(readFileSync(item.path, 'utf8'));
    } catch {
      result.skipped.push({ slug: item.slug ?? item.path, why: 'unreadable candidate' });
      continue;
    }
    const { data, body } = parsed;

    // Security never rides THIS plain dial at any level — at 'full' it goes
    // through the machine curator (reviewer + canary + probation) instead
    // (§11.13); below 'full' it waits for a human (§11.11 behavior).
    if (data.category === 'security') {
      const why = level === 'full'
        ? 'security-category — rides the machine-curator path, not the plain dial'
        : 'security-category — human review always (the dial never covers it)';
      result.skipped.push({ slug: data.slug, why });
      continue;
    }
    if (item.quarantined || data.status === 'quarantined') {
      result.skipped.push({ slug: data.slug, why: 'quarantined — human review always' });
      continue;
    }
    if (autoCount >= cap) {
      result.skipped.push({ slug: data.slug, why: `auto-tier cap reached (${cap}) — review the auto tier or raise auto_approve.cap` });
      continue;
    }
    if (origin === 'adopted' && adoptedToday >= dailyCap) {
      result.skipped.push({ slug: data.slug, why: `daily adopted-auto cap reached (${dailyCap}) — a flood is a signal, not a convenience` });
      continue;
    }

    const activated = {
      ...data,
      status: 'active',
      // §9: machine-gated lessons are tagged and narrow — this-project scope
      // for mined material when the project is known
      scope: {
        ...data.scope,
        projects: origin === 'mined' && project && project !== 'unknown' ? [project] : (data.scope?.projects ?? [])
      },
      provenance: { ...data.provenance, tier: 'auto' }
    };

    const content = serializeLessonFile(activated, body);
    const check = validateLesson(content); // E-AUTOSEC backstop lives here
    if (!check.ok) {
      result.skipped.push({ slug: data.slug, why: `chokepoint: ${check.errors.map((e) => e.code).join(', ')}` });
      continue;
    }

    const target = path.join(p.lessons(), activated.category, `${activated.slug}.${activated.id.slice(-8)}.md`);
    if (existsSync(target)) {
      result.skipped.push({ slug: data.slug, why: 'target already exists' });
      continue;
    }
    atomicWrite(target, content);
    rmSync(item.path, { force: true });
    autoCount++;
    if (origin === 'adopted') adoptedToday++;
    logEvent({ event: 'auto-approved', id: activated.id, slug: activated.slug, origin, level, ...(adoption ? { adoption } : {}) });
    result.activated.push({ id: activated.id, slug: activated.slug, path: target });
    log(`  [auto-approved] ${activated.slug} (tier: auto${origin === 'adopted' ? ', adopted' : ''})`);
  }

  if (result.activated.length > 0) {
    commitBrain(`auto-approve (${level}): ${result.activated.length} lesson(s) from ${origin}`);
    try { buildIndex(); } catch { /* next loadIndex() rebuilds */ }
  }
  return result;
}
