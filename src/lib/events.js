import { mkdirSync, appendFileSync, existsSync, readFileSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { p } from './paths.js';

// Append-only audit trail: injections, approvals, rejections, suppressions.
//
// The WRITE model is deliberate and stays: crash-safe, lock-free, auditable.
// What was missing was a READ story — no rotation existed anywhere, and 17 call
// sites (including the session-start injection path) parsed the ENTIRE file
// every time. At ~700 bytes per injection event that grows without bound, so the
// cost of a hook fire grew with how much the product had been used (audit
// 2026-07-26). Rotation + a windowed read fix that without changing the model.

export const ROTATE_BYTES = 5 * 1024 * 1024; // rotate past 5MB
export const KEEP_SEGMENTS = 4;              // ~20MB of history, then the oldest goes

function segmentFiles() {
  const file = p.events();
  const dir = path.dirname(file);
  const base = path.basename(file);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(`${base}.`) && /\.\d+$/.test(n))
    .sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()))
    .map((n) => path.join(dir, n));
}

// Roll events.jsonl to events.jsonl.1 (and shift the rest along) once it passes
// the cap. Best-effort by design: a failed rotation must never cost an event.
export function rotateEventsIfLarge({ maxBytes = ROTATE_BYTES, keep = KEEP_SEGMENTS } = {}) {
  const file = p.events();
  try {
    if (!existsSync(file) || statSync(file).size <= maxBytes) return { rotated: false };
    for (let i = keep; i >= 1; i--) {
      const from = `${file}.${i}`;
      if (!existsSync(from)) continue;
      if (i === keep) rmSync(from, { force: true }); // the oldest falls off
      else renameSync(from, `${file}.${i + 1}`);
    }
    renameSync(file, `${file}.1`);
    return { rotated: true };
  } catch {
    return { rotated: false };
  }
}

export function logEvent(event) {
  const file = p.events();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

function parseLines(text, out) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a corrupt line, keep going */ }
  }
  return out;
}

// Read the trail back. Corrupt lines are skipped, not fatal — an audit log with
// one bad line must not take down every reader.
//
// `sinceDays` reads only as far back as it needs: the current segment, then
// older segments while any of their events are still inside the window. A
// caller that genuinely wants everything (stats' all-time retrieval miss) simply
// omits it and pays for the whole history, as before.
export function readEvents({ sinceDays = null } = {}) {
  const events = [];
  const cutoff = sinceDays == null ? null : Date.now() - sinceDays * 86400000;

  if (existsSync(p.events())) parseLines(readFileSync(p.events(), 'utf8'), events);

  for (const seg of segmentFiles()) {
    let segEvents = [];
    try { segEvents = parseLines(readFileSync(seg, 'utf8'), []); } catch { continue; }
    events.unshift(...segEvents);
    if (cutoff != null) {
      const oldest = Date.parse(segEvents[0]?.ts ?? '') || 0;
      if (oldest && oldest < cutoff) break; // this segment already predates the window
    }
  }

  if (cutoff == null) return events;
  return events.filter((e) => (Date.parse(e.ts ?? '') || 0) >= cutoff);
}
