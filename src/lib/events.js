import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { p } from './paths.js';

// Append-only audit trail: injections, approvals, rejections, suppressions.
export function logEvent(event) {
  const file = p.events();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

// Read the whole trail back. Corrupt lines are skipped, not fatal — an audit
// log with one bad line must not take down every reader.
export function readEvents() {
  const events = [];
  if (existsSync(p.events())) {
    for (const line of readFileSync(p.events(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip a corrupt line, keep going */ }
    }
  }
  return events;
}
