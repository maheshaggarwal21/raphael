// The autopilot heartbeat (Phase 17.3, docs/autopilot-vision.md §4.1).
// `raph pulse` runs the whole background lifecycle once, at session end:
//
//   mine (zero tokens, ledger-incremental)
//     -> distill within budget (subscription model calls; the machine curator
//        activates what passes — curateStaged is called INSIDE distill)
//     -> quarantine sweep (30-day silent tombstones)
//     -> probation retire (machine/auto-tier lessons the retire sweep flags)
//     -> index rebuild
//     -> one 'pulse' event (feeds stats + the weekly digest)
//
// Contracts, in order of importance:
//   FAIL OPEN  — no step may throw out of runPulse; a broken pulse records
//                what it saw and exits clean. It can never corrupt the brain
//                (every write path is the same chokepoint-guarded code the
//                CLI verbs use) and never blocks the user.
//   NO PROMPTS — pulse runs headless. It acts only when mode=autopilot AND
//                the project has consent; otherwise it is a silent no-op.
//                It NEVER grants consent itself.
//   BUDGETED   — per-run episode cap + max distill runs per day; an E-LIMIT
//                stops cleanly and the ledgers make the next pulse resume.
//   ONE AT A TIME — a lock file (stale after 30 min) serializes pulses from
//                overlapping session ends.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, getMode, hasConsent } from './config.js';
import { readEvents, logEvent } from './events.js';
import { readActiveLessons, retireCandidates } from './freshness.js';
import { retireRefs } from './review.js';
import { sweepQuarantine } from './curator.js';
import { refreshAtlasIfStale } from './atlas.js';
import { ensureGuard } from './guard.js';
import { syncGlobalBrain } from './globalbrain.js';
import { maybeBundleContributions } from './contribute.js';
import { buildIndex } from './compile.js';
import { p } from './paths.js';

export const PULSE_LOCK_STALE_MS = 30 * 60 * 1000;
const RETIRES_PER_PULSE = 3;

export function pulseBudget(cfg) {
  const a = cfg?.autopilot ?? {};
  return {
    maxEpisodes: Number.isInteger(a.max_episodes_per_pulse) && a.max_episodes_per_pulse > 0 ? a.max_episodes_per_pulse : 8,
    dailyDistillRuns: Number.isInteger(a.daily_distill_runs) && a.daily_distill_runs >= 0 ? a.daily_distill_runs : 3
  };
}

// Count today's pulse runs that actually spent model tokens (distilled > 0).
export function distillRunsToday(events, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return events.filter((e) => e.event === 'pulse' && String(e.ts ?? '').slice(0, 10) === today && (e.distilled ?? 0) > 0).length;
}

export function lockFile() {
  return path.join(p.state(), 'pulse.lock');
}

export function acquireLock(now = Date.now()) {
  const file = lockFile();
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, ts: now }), { flag: 'wx' });
    return true;
  } catch {
    // lock exists — steal it only if stale (a crashed pulse must not wedge us)
    try {
      const held = JSON.parse(readFileSync(file, 'utf8'));
      if (now - (held.ts ?? 0) > PULSE_LOCK_STALE_MS) {
        writeFileSync(file, JSON.stringify({ pid: process.pid, ts: now }));
        return true;
      }
    } catch {
      // unreadable lock = stale
      try { writeFileSync(file, JSON.stringify({ pid: process.pid, ts: now })); return true; } catch { /* give up */ }
    }
    return false;
  }
}

export function releaseLock() {
  try { rmSync(lockFile(), { force: true }); } catch { /* best effort */ }
}

// The probation sweep: act on the retire suggestions, but ONLY for lessons a
// machine activated (tier auto/machine). Human-approved lessons stay
// suggestions forever — autopilot never deletes what a human chose.
export function probationRetire({ events, log = () => {} } = {}) {
  const lessons = readActiveLessons();
  const sweep = retireCandidates(lessons, { events });
  if (!sweep.ready || sweep.items.length === 0) return { retired: [], reason: sweep.reason ?? null };
  const tierOf = new Map(lessons.map((l) => [l.id, l.provenance?.tier]));
  const refs = sweep.items
    .filter((i) => ['auto', 'machine'].includes(tierOf.get(i.id)))
    .slice(0, RETIRES_PER_PULSE)
    .map((i) => i.id);
  if (refs.length === 0) return { retired: [], reason: 'no machine-tier retire candidates' };
  const res = retireRefs(refs, { confirmed: true, reason: 'autopilot probation sweep (low confidence, never fired)' });
  const retired = res.results.filter((r) => r.outcome === 'retired').map((r) => r.slug);
  for (const s of retired) log(`  [retired] ${s} — probation sweep`);
  return { retired, reason: null };
}

// One heartbeat. deps are injectable for tests: { mine, distill } default to
// the real command functions (loaded lazily to avoid import cycles).
export async function runPulse({ project, log = () => {}, deps = {} } = {}) {
  const startedAt = Date.now();
  const summary = {
    project: project ?? null,
    ran: false, skipped: null,
    mined: 0, distilled: 0, curated: 0,
    expired: 0, retired: 0, atlas: null, guard: null,
    limited: false, errors: []
  };

  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    summary.skipped = `config unreadable: ${err.message}`;
    return summary;
  }

  if (getMode(cfg) !== 'autopilot') {
    summary.skipped = 'mode is curator — pulse is a no-op (raph auto full to enable)';
    return summary;
  }
  if (project && hasConsent(cfg, project) !== true) {
    summary.skipped = 'no consent for this project — pulse will not touch it';
    return summary;
  }
  if (!acquireLock()) {
    summary.skipped = 'another pulse is already running';
    return summary;
  }

  try {
    summary.ran = true;
    const mine = deps.mine ?? (await import('../commands/mine.js')).default;
    const distill = deps.distill ?? (await import('../commands/distill.js')).default;
    const budget = pulseBudget(cfg);

    // 1. mine — zero tokens, ledger-incremental; consent was checked above
    if (project) {
      try {
        const eventsBefore = countPendingEpisodeFiles();
        await mine(['--project', project]);
        summary.mined = Math.max(0, countPendingEpisodeFiles() - eventsBefore);
      } catch (err) {
        summary.errors.push(`mine: ${err.message}`);
      }
    }

    // 2. distill within budget — the machine curator runs inside distill
    try {
      const events = readEvents();
      const runs = distillRunsToday(events);
      if (budget.dailyDistillRuns === 0 || runs >= budget.dailyDistillRuns) {
        log(`  [budget] ${runs}/${budget.dailyDistillRuns} distill runs today — mining only`);
      } else {
        const eventsBefore = readEvents().filter((e) => e.event === 'machine-curated' || e.event === 'auto-approved').length;
        const ledgerBefore = countLedgerLines(p.distilledLedger());
        const code = await distill(['--yes', '--max-episodes', String(budget.maxEpisodes)]);
        if (code === 4) summary.limited = true;
        summary.distilled = Math.max(0, countLedgerLines(p.distilledLedger()) - ledgerBefore);
        summary.curated = Math.max(0,
          readEvents().filter((e) => e.event === 'machine-curated' || e.event === 'auto-approved').length - eventsBefore);
      }
    } catch (err) {
      if (err?.code === 'E-LIMIT') summary.limited = true;
      else summary.errors.push(`distill: ${err.message}`);
    }

    // 3. quarantine hygiene — silent 30-day tombstones
    try {
      summary.expired = sweepQuarantine({ log }).expired.length;
    } catch (err) {
      summary.errors.push(`quarantine: ${err.message}`);
    }

    // 4. probation retire — machine-tier lessons only
    try {
      summary.retired = probationRetire({ events: readEvents(), log }).retired.length;
    } catch (err) {
      summary.errors.push(`retire: ${err.message}`);
    }

    // 5. global-brain down-sync (17.6) — weekly, pinned URL, hash-verified,
    // fail-open. Local lessons always win the dedupe.
    if (cfg.autopilot?.sync_global !== false) {
      try {
        const sync = await (deps.syncGlobal ?? syncGlobalBrain)({ log });
        if (sync.checked) summary.globalSync = sync.updated ? `v${sync.version}: +${sync.activated?.length ?? 0}` : sync.why;
      } catch (err) {
        summary.errors.push(`global-sync: ${err.message}`);
      }
    }

    // 6. contribution bundle (17.7) — permission #2 only, weekly, LOCAL STAGE
    // only (sending is always the user's own act; no network here)
    try {
      const bundle = (deps.bundle ?? maybeBundleContributions)({ config: cfg, log });
      if (bundle.built) summary.bundle = `${bundle.count} lesson(s) staged`;
    } catch (err) {
      summary.errors.push(`bundle: ${err.message}`);
    }

    // 6b. atlas freshness (17.4) — zero tokens; rebuild only when HEAD moved
    // (or daily for non-git projects). The next session's hooks then inject a
    // current digest with no one running `raph atlas` ever.
    if (project) {
      try {
        const atlas = (deps.refreshAtlas ?? refreshAtlasIfStale)(project);
        summary.atlas = atlas.refreshed ? `refreshed (${atlas.why})` : 'fresh';
        if (atlas.refreshed) log(`  [atlas] rebuilt — ${atlas.why} (${atlas.files} files, 0 tokens)`);
      } catch (err) {
        summary.errors.push(`atlas: ${err.message}`);
      }
    }

    // 6c. guard auto-install (owner ask 2026-07-18): a consented project that
    // is a git repo gets the pre-commit secret hook automatically — zero
    // clicks, zero tokens. Foreign hooks are NEVER clobbered; a non-repo dir
    // is a no-op. Opt out: autopilot.auto_guard: false in config.yaml.
    if (project && cfg.autopilot?.auto_guard !== false) {
      try {
        const guard = (deps.ensureGuard ?? ensureGuard)(project);
        summary.guard = guard.status;
        if (guard.status === 'installed') log(`  [guard] pre-commit secret hook installed in ${project}`);
        if (guard.status === 'foreign-hook') log('  [guard] a non-raphael pre-commit hook exists — left untouched (raph guard install --force to replace)');
      } catch (err) {
        summary.errors.push(`guard: ${err.message}`);
      }
    }

    // 7. index freshness
    try { buildIndex(); } catch (err) { summary.errors.push(`index: ${err.message}`); }
  } finally {
    releaseLock();
    summary.durationMs = Date.now() - startedAt;
    try {
      logEvent({
        event: 'pulse',
        project: summary.project,
        ran: summary.ran, skipped: summary.skipped,
        mined: summary.mined, distilled: summary.distilled, curated: summary.curated,
        expired: summary.expired, retired: summary.retired, atlas: summary.atlas,
        guard: summary.guard,
        limited: summary.limited, errors: summary.errors.slice(0, 5),
        durationMs: summary.durationMs
      });
    } catch { /* the event log must never break the pulse */ }
  }
  return summary;
}

function countLedgerLines(file) {
  if (!existsSync(file)) return 0;
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

// Episode LINES across run files — a cheap proxy for "episodes mined so far",
// diffed before/after mine to report how many this pulse added.
function countPendingEpisodeFiles() {
  const dir = p.episodesDir();
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      try {
        count += readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
      } catch { /* skip torn file */ }
    }
  } catch {
    return 0;
  }
  return count;
}
