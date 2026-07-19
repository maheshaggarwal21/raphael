// Regenerate global-brain/ — the owner-curated GLOBAL BRAIN that seeds every
// new install (§2.1 two-brain model). Sources: the security pack specs (the
// owner's reviewed set). Run after editing PACK_SPECS; commit the output.
//
//   node scripts/build-global-brain.mjs
//
// Rules:
//   - lesson IDs are FIXED once assigned (existing lessons.json wins) so every
//     user's copy shares identity; dedupe across brains is by slug + id
//   - manifest.version bumps ONLY when lesson content actually changed
//   - per-lesson sha256 over canonical JSON (EOL-proof) — verified at seed
//     and at down-sync before anything touches the chokepoint

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_SPECS, packLesson } from '../src/lib/security-pack.js';
import { DESIGN_PACK_SPECS, packDesignLesson } from '../src/lib/design-pack.js';
import { validateLesson } from '../src/lib/validate.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'global-brain');
const lessonsFile = path.join(outDir, 'lessons.json');
const manifestFile = path.join(outDir, 'manifest.json');

const previous = existsSync(lessonsFile) ? JSON.parse(readFileSync(lessonsFile, 'utf8')) : [];
const prevBySlug = new Map(previous.map((l) => [l.slug, l]));
const prevManifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;

const today = new Date().toISOString().slice(0, 10);
const lessons = [];
// The global brain seeds every fresh install: the owner-reviewed security pack +
// the frontend-design pack (both curated tier). Each spec becomes a fixed-id lesson.
const sources = [
  ...PACK_SPECS.map((spec) => ({ spec, pack: packLesson })),
  ...DESIGN_PACK_SPECS.map((spec) => ({ spec, pack: packDesignLesson }))
];
for (const { spec, pack } of sources) {
  const prev = prevBySlug.get(spec.slug);
  const lesson = pack(spec, { today: prev?.evidence?.first_seen ?? today, id: prev?.id ?? null });
  // stability: everything except the id comes from the spec deterministically
  const check = validateLesson(serializeLessonFile(lesson, ''));
  if (!check.ok) {
    console.error(`REFUSED ${spec.slug}: ${check.errors.map((e) => e.code).join(', ')}`);
    process.exitCode = 1;
    continue;
  }
  lessons.push(lesson);
}

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const entries = lessons.map((l) => ({ slug: l.slug, id: l.id, category: l.category, severity: l.severity, sha256: sha(l) }));
const contentChanged = !prevManifest || JSON.stringify(prevManifest.lessons) !== JSON.stringify(entries);
const version = prevManifest ? (contentChanged ? prevManifest.version + 1 : prevManifest.version) : 1;

mkdirSync(outDir, { recursive: true });
writeFileSync(lessonsFile, JSON.stringify(lessons, null, 1) + '\n', 'utf8');
writeFileSync(manifestFile, JSON.stringify({
  schema: 'raphael/global-brain/v1',
  version,
  generated: contentChanged ? today : (prevManifest?.generated ?? today),
  count: lessons.length,
  lessons: entries
}, null, 1) + '\n', 'utf8');

console.log(`global-brain: ${lessons.length} lesson(s), version ${version}${contentChanged ? ' (content changed)' : ' (unchanged)'}`);
