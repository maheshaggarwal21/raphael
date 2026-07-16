// Provenance ledger for the adopt pipeline (ARCHITECTURE §13). Every adoption —
// a URL, file, repo, or skill file the user asked Raphael to digest — writes a
// record here: where it came from, when, under what license, what the reviewer
// agent said, and the ids of everything it produced (`taken`). Lessons stay
// URL-free (the §0 rule); the URL lives HERE, exactly like evidence records.
//
// The ledger is append-only JSONL (crash-safe, auditable): a status change is a
// new line with the same id, and reads resolve last-line-wins per id. Revoking
// an adoption is therefore itself a recorded event, never an erasure.

import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { adoptionId } from './ulid.js';
import { p } from './paths.js';

export function contentHash(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

// ---- license detection ---------------------------------------------------
//
// Deterministic text heuristics over LICENSE files / SPDX markers. The verdict
// gates what the pipeline may do: `permissive`/`public-domain` allow attributed
// code adoption proposals; `copyleft` and `unknown` restrict adoption to ideas
// (lessons/skills) — unlicensed code is all-rights-reserved by default.

const LICENSE_PATTERNS = [
  // order matters: AGPL/LGPL headers must not fall through to the GPL match
  ['AGPL-3.0', 'copyleft', /GNU AFFERO GENERAL PUBLIC LICENSE/i],
  ['LGPL-3.0', 'weak-copyleft', /GNU LESSER GENERAL PUBLIC LICENSE/i],
  ['GPL-3.0', 'copyleft', /GNU GENERAL PUBLIC LICENSE\s+Version 3/i],
  ['GPL-2.0', 'copyleft', /GNU GENERAL PUBLIC LICENSE\s+Version 2/i],
  ['GPL', 'copyleft', /GNU GENERAL PUBLIC LICENSE/i],
  ['MPL-2.0', 'weak-copyleft', /Mozilla Public License,?\s*(?:Version\s*)?2\.0/i],
  ['Apache-2.0', 'permissive', /Apache License,?\s*Version 2\.0/i],
  ['MIT', 'permissive', /\bMIT License\b|Permission is hereby granted, free of charge, to any person obtaining a copy/i],
  ['ISC', 'permissive', /\bISC License\b|Permission to use, copy, modify, and\/or distribute this software/i],
  ['BSD', 'permissive', /Redistribution and use in source and binary forms/i],
  ['Unlicense', 'public-domain', /free and unencumbered software released into the public domain/i],
  ['CC0-1.0', 'public-domain', /\bCC0\b|Creative Commons Zero/i]
];

const SPDX_FAMILY = [
  [/^(MIT|ISC|Apache|BSD|Zlib|0BSD)/i, 'permissive'],
  [/^(LGPL|MPL|EPL)/i, 'weak-copyleft'],
  [/^A?GPL/i, 'copyleft'],
  [/^(Unlicense|CC0)/i, 'public-domain']
];

function familyOf(spdxId) {
  for (const [re, family] of SPDX_FAMILY) if (re.test(spdxId)) return family;
  return 'unknown';
}

export function detectLicense(text) {
  const t = String(text ?? '');
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/.exec(t);
  if (spdx) {
    const id = spdx[1];
    return { id, family: familyOf(id), detected: true };
  }
  for (const [id, family, re] of LICENSE_PATTERNS) {
    if (re.test(t)) return { id, family, detected: true };
  }
  return { id: 'unknown', family: 'unknown', detected: false };
}

const LICENSE_FILENAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md',
  'LICENCE.txt', 'COPYING', 'COPYING.md', 'UNLICENSE'
];

// License of a local repo directory: a LICENSE-style file wins; package.json's
// `license` field is the fallback. Anything unreadable resolves to unknown —
// "we don't know" must never upgrade to "we may copy".
export function detectLicenseFromDir(dir) {
  for (const name of LICENSE_FILENAMES) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    try {
      return { ...detectLicense(readFileSync(file, 'utf8')), source: name };
    } catch { /* unreadable license file — keep looking */ }
  }
  const pkg = path.join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const id = JSON.parse(readFileSync(pkg, 'utf8')).license;
      if (typeof id === 'string' && id.trim()) {
        return { id, family: familyOf(id), detected: true, source: 'package.json' };
      }
    } catch { /* malformed package.json — fall through */ }
  }
  return { id: 'unknown', family: 'unknown', detected: false, source: null };
}

// True when the license permits proposing copied/derived CODE (with attribution).
// Ideas (lessons, skill drafts written fresh) are always fine — this gate is
// only consulted for code adoption proposals.
export function allowsCodeAdoption(license) {
  return license?.family === 'permissive' || license?.family === 'public-domain';
}

// ---- the ledger ------------------------------------------------------------

function appendLine(record) {
  const file = p.adoptionsLedger();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

// Create a new adoption record. `taken` accumulates later via updateAdoption.
export function recordAdoption({ source, kind, license, hash, verdict, taken = [] }) {
  const record = {
    id: adoptionId(),
    ts: new Date().toISOString(),
    source: String(source),
    kind,                       // url | file | repo | skill | text
    license: license ?? { id: 'unknown', family: 'unknown', detected: false },
    hash: hash ?? null,
    verdict: verdict ?? null,   // the reviewer agent's structured verdict
    status: 'adopted',
    taken                       // [{ type: 'lesson'|'skill-draft', id, path? }]
  };
  appendLine(record);
  return record;
}

// Append-only update: re-emit the merged record under the same id.
export function updateAdoption(current, patch) {
  const merged = { ...current, ...patch, id: current.id, ts: new Date().toISOString() };
  appendLine(merged);
  return merged;
}

// All adoptions, last-line-wins per id, newest first.
export function listAdoptions() {
  const file = p.adoptionsLedger();
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec?.id) byId.set(rec.id, rec);
    } catch { /* a torn line never poisons the ledger */ }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
}

// Find one adoption by exact id, unambiguous id prefix, or exact source string.
export function findAdoption(ref) {
  const all = listAdoptions();
  const exact = all.find((a) => a.id === ref || a.source === ref);
  if (exact) return exact;
  const prefixed = all.filter((a) => a.id.startsWith(ref));
  return prefixed.length === 1 ? prefixed[0] : null;
}
