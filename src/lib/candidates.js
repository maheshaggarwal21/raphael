// Candidate writer. EVERY candidate passes validateLesson() before touching
// disk — this is the chokepoint invariant. Quarantine-flagged candidates land
// in brain/quarantine/ and can only reach the brain through explicit review.

import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { serializeLessonFile } from './frontmatter.js';
import { validateLesson } from './validate.js';
import { atomicWrite } from './files.js';
import { p } from './paths.js';

export function writeCandidate(data, body = '') {
  const content = serializeLessonFile(data, body);
  const result = validateLesson(content);
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.code}: ${e.msg}`).join('; ');
    throw new Error(`E-CANDIDATE: rejected by the chokepoint — ${detail}`);
  }

  const hash = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
  const dir = result.quarantine ? p.quarantine() : p.candidates();
  const filePath = path.join(dir, `C-${hash}.md`);

  if (existsSync(filePath)) {
    return { id: data.id, path: filePath, quarantined: result.quarantine, codes: quarantineCodes(result), existed: true };
  }
  atomicWrite(filePath, content);
  return { id: data.id, path: filePath, quarantined: result.quarantine, codes: quarantineCodes(result), existed: false };
}

// The codes that explain a quarantine, so the caller can NAME the flag instead of
// showing an opaque verdict (18.4 — trust at the point of action).
function quarantineCodes(result) {
  return [
    ...(result.errors ?? []).map((e) => e.code),
    ...(result.warnings ?? []).map((w) => w.code)
  ];
}
