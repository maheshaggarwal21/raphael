// Evidence records: the proof behind every lesson's counts. Bulky and
// privacy-sensitive, so they live apart from lessons (sharded by year/month),
// are ALWAYS secret-scrubbed at write time, are never injected into any agent
// context, and are never included in exports.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import AjvModule from 'ajv';
import { evidenceId } from './ulid.js';
import { scrubSecrets } from './scrub.js';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

const Ajv = AjvModule.default ?? AjvModule;
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'evidence.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function evidencePath(id, observedAt) {
  const [year, month] = observedAt.slice(0, 7).split('-');
  return path.join(p.evidence(), year, month, `${id}.json`);
}

// Builds, validates, scrubs, and atomically writes one evidence record.
// Returns { id, path }. Throws with an E-coded message on invalid input.
export function writeEvidence(record) {
  const id = record.id ?? evidenceId();
  const full = { schema: 'raphael/evidence/v1', excerpt_redacted: false, ...record, id };

  if (full.excerpt) {
    const { text, found } = scrubSecrets(full.excerpt);
    full.excerpt = text;
    if (found.length > 0) full.excerpt_redacted = true;
  }

  if (!validateSchema(full)) {
    const detail = (validateSchema.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('; ');
    throw new Error(`E-EVIDENCE: invalid record: ${detail}`);
  }

  const filePath = evidencePath(id, full.observed_at);
  atomicWrite(filePath, JSON.stringify(full, null, 2) + '\n');
  return { id, path: filePath };
}

export function readEvidence(id, observedAt) {
  const filePath = evidencePath(id, observedAt);
  if (!existsSync(filePath)) throw new Error(`E-EVIDENCE: ${id} not found at ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// Locate an evidence record by id alone (lesson refs don't carry dates).
// The yy/mm shard tree stays small at personal scale, so a walk is fine.
export function findEvidence(id) {
  const root = p.evidence();
  if (!existsSync(root)) return null;
  for (const year of readdirSync(root)) {
    const yDir = path.join(root, year);
    let months;
    try {
      months = readdirSync(yDir);
    } catch {
      continue;
    }
    for (const month of months) {
      const file = path.join(yDir, month, `${id}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    }
  }
  return null;
}
