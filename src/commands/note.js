import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lessonId } from '../lib/ulid.js';
import { slugify } from '../lib/slug.js';
import { writeCandidate } from '../lib/candidates.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'lesson.schema.json');
const CATEGORIES = JSON.parse(readFileSync(schemaPath, 'utf8')).properties.category.enum;
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function deriveTitle(text) {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0].trim();
  const title = firstSentence.length >= 8 ? firstSentence : text.trim();
  return title.slice(0, 80);
}

export default async function note(args) {
  const flagIdxs = new Set();
  for (const f of ['--title', '--category', '--severity', '--keywords']) {
    const i = args.indexOf(f);
    if (i >= 0) {
      flagIdxs.add(i);
      flagIdxs.add(i + 1);
    }
  }
  const text = args.find((a, i) => !a.startsWith('--') && !flagIdxs.has(i))?.trim();

  if (!text) {
    console.error('raph: usage: raph note "<lesson text>" [--title t] [--category c] [--severity s] [--keywords a,b,c]');
    return 1;
  }
  if (text.length < 20) {
    console.error('raph: a lesson needs at least one full sentence (20+ characters) so future-you understands it');
    return 1;
  }
  if (text.length > 700) {
    console.error(`raph: lesson text is ${text.length} chars; the cap is 700 — distill it (that is the whole point)`);
    return 1;
  }

  const category = flagValue(args, '--category') ?? 'process';
  if (!CATEGORIES.includes(category)) {
    console.error(`raph: unknown category "${category}" — pick one of: ${CATEGORIES.join(', ')}`);
    return 1;
  }
  const severity = flagValue(args, '--severity') ?? 'medium';
  if (!SEVERITIES.includes(severity)) {
    console.error(`raph: unknown severity "${severity}" — pick one of: ${SEVERITIES.join(', ')}`);
    return 1;
  }

  // keywords make a note findable by the per-prompt hook and raph search —
  // without them a note only ever surfaces in the session-start digest
  const keywords = (flagValue(args, '--keywords') ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  const title = (flagValue(args, '--title') ?? deriveTitle(text)).slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  const headline = text.replace(/\s+/g, ' ').trim().slice(0, 180);

  const data = {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: slugify(title),
    title,
    status: 'candidate',
    category,
    severity,
    scope: { stacks: [], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords, paths: [] },
    lesson: text,
    evidence: {
      refs: [],
      observations: 1,
      distinct_projects: 1,
      source_mix: { user_note: 1 },
      first_seen: today,
      last_seen: today
    },
    provenance: {
      created_by: 'raphael/note@0.1.0',
      source_kind: 'manual',
      human_edited: true,
      tier: 'user'
    },
    injection: {
      headline,
      tokens: Math.min(60, Math.max(1, Math.ceil(headline.length / 4)))
    }
  };

  let result;
  try {
    result = writeCandidate(data);
  } catch (err) {
    console.error(`raph: note rejected — ${err.message}`);
    console.error('      lessons cannot contain URLs, secrets, or agent-directed instructions');
    return 1;
  }

  if (result.existed) {
    console.log(`raph: an identical candidate already exists at ${result.path}`);
    return 0;
  }
  if (result.quarantined) {
    console.log(`raph: QUARANTINED -> ${result.path}`);
    console.log('      the text reads as agent-directed; a human must review the full body before it can ever activate');
    return 0;
  }
  console.log(`raph: candidate saved -> ${result.path}`);
  console.log('      candidates never activate without review');
  return 0;
}
