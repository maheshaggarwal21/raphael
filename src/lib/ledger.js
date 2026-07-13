import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { p } from './paths.js';

// The mined-work ledger is the miner's idempotency backbone: one JSONL line per
// session file already processed, keyed by the sha256 of the file's content.

export function loadLedger() {
  let raw;
  try {
    raw = readFileSync(p.minedLedger(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
  const ledger = new Map();
  // Malformed lines are skipped silently: the worst case is re-mining a source,
  // which is safe because episode ids are content-addressed.
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object' || typeof entry.hash !== 'string' || !entry.hash) continue;
    ledger.set(entry.hash, entry); // later duplicate wins
  }
  return ledger;
}

export function hasProcessed(ledgerMap, hash) {
  return ledgerMap.has(hash);
}

// CALLER CONTRACT: append ONLY at the end of a fully successful mine run
// (write-last semantics). A crash before this append means those sources are
// re-mined next run — a harmless no-op, since episode ids are content-addressed.
export function appendLedger(entries) {
  if (!Array.isArray(entries)) throw new Error('E-LEDGER: appendLedger expects an array of entries');
  if (entries.length === 0) return;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.hash !== 'string' || !entry.hash) {
      throw new Error('E-LEDGER: each entry must be an object with a non-empty string hash');
    }
  }
  const filePath = p.minedLedger();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e) + '\n').join('');
  appendFileSync(filePath, lines, 'utf8');
}
