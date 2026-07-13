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
    return { id: data.id, path: filePath, quarantined: result.quarantine, existed: true };
  }
  atomicWrite(filePath, content);
  return { id: data.id, path: filePath, quarantined: result.quarantine, existed: false };
}
