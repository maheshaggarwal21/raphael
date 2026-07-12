// validateLesson(): THE single deterministic chokepoint. Every path a lesson can
// take into the brain (mined, hand-written, imported pack) passes through here.
// No lesson file is ever written or injected without a clean pass.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import AjvModule from 'ajv';
import { parseLessonFile } from './frontmatter.js';
import { scrubSecrets } from './scrub.js';

const Ajv = AjvModule.default ?? AjvModule;
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'lesson.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateSchema = ajv.compile(schema);

// Any URL anywhere in a lesson file is a hard reject: URLs are the carrier for
// "fetch and run" attacks and a tracking/exfiltration vector.
const URL_RE = /(?:[a-z][a-z0-9+.-]*):\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;

const DENY = [
  [/ignore (?:all )?(?:previous|prior|above) (?:instructions|messages|context|rules)/i, 'instruction-override phrase'],
  [/\bsystem prompt\b/i, 'system-prompt reference'],
  [/\byou are (?:now|an?|the)\b/i, 'role-reassignment phrase'],
  [/\byou must now\b/i, 'agent-directed imperative'],
  [/\brun the following\b/i, 'command-execution phrase'],
  [/\bexecute (?:this|the following)\b/i, 'command-execution phrase'],
  [/\bcurl\s+\S+\s*\|\s*(?:ba)?sh\b/i, 'pipe-to-shell pattern'],
  [/<\s*function|<\s*\/?antml/i, 'tool-call-shaped markup'],
  [/"tool_use"|"tool_calls"/i, 'tool-call-shaped JSON']
];

// Invisible/steering unicode: bidi overrides, zero-width chars, BOM, and the
// U+E0000 tag block (encoded as surrogate pairs) used for ASCII smuggling.
const UNICODE_RE = /[‪-‮⁦-⁩​-‍﻿]|\uDB40[\uDC00-\uDC7F]/;

const BASE64_RE = /[A-Za-z0-9+/]{48,}={0,2}/;

// Lessons speak in declarative voice ("X causes Y"), never commands at the agent.
const IMPERATIVE_RE = /\byou (?:must|should|need to|have to|shall)\b/i;

export function validateLesson(content) {
  const errors = [];
  const warnings = [];
  let quarantine = false;
  let data = null;
  let body = '';

  try {
    ({ data, body } = parseLessonFile(content));
  } catch (err) {
    return { ok: false, errors: [{ code: 'E-FRONTMATTER', msg: err.message }], warnings, quarantine: false, data: null, body: '' };
  }

  if (!validateSchema(data)) {
    for (const e of validateSchema.errors ?? []) {
      errors.push({ code: 'E-SCHEMA', msg: `${e.instancePath || '(root)'} ${e.message}` });
    }
  }

  if (URL_RE.test(content)) {
    errors.push({ code: 'E-URL', msg: 'URLs are not allowed anywhere in a lesson' });
  }

  for (const [re, why] of DENY) {
    if (re.test(content)) {
      errors.push({ code: 'E-DENY', msg: `blocked pattern: ${why}` });
      quarantine = true;
    }
  }

  if (UNICODE_RE.test(content)) {
    errors.push({ code: 'E-UNICODE', msg: 'invisible or bidirectional unicode characters found' });
    quarantine = true;
  }

  if (BASE64_RE.test(content)) {
    errors.push({ code: 'E-BASE64', msg: 'long encoded blob found' });
    quarantine = true;
  }

  const { found } = scrubSecrets(content);
  if (found.length > 0) {
    errors.push({ code: 'E-SECRET', msg: `secret-looking content found: ${[...new Set(found)].join(', ')}` });
  }

  if (data) {
    const risky = [data.title, data.lesson, data.injection?.headline].filter(Boolean).join('\n');
    if (IMPERATIVE_RE.test(risky)) {
      quarantine = true;
      warnings.push({ code: 'W-IMPERATIVE', msg: 'agent-directed phrasing; quarantined until a human reviews the full text' });
    }
    if (data.provenance?.tier === 'auto' && data.category === 'security') {
      errors.push({ code: 'E-AUTOSEC', msg: 'security-category lessons can never be machine-approved (tier: auto)' });
    }
    if (data.status === 'quarantined') quarantine = true;
  }

  return { ok: errors.length === 0, errors, warnings, quarantine, data, body };
}
