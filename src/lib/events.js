import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { p } from './paths.js';

// Append-only audit trail: injections, approvals, rejections, suppressions.
export function logEvent(event) {
  const file = p.events();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
}
