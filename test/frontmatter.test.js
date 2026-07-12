import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLessonFile, serializeLessonFile } from '../src/lib/frontmatter.js';

test('roundtrip preserves data and body', () => {
  const data = { schema: 'raphael/lesson/v1', title: 'A test', evidence: { first_seen: '2026-05-02' } };
  const body = '## Notes\nSome human note.';
  const file = serializeLessonFile(data, body);
  const parsed = parseLessonFile(file);
  assert.deepEqual(parsed.data, data);
  assert.equal(parsed.body.trim(), body);
});

test('dates stay plain strings, never Date objects', () => {
  const parsed = parseLessonFile('---\nfirst_seen: 2026-05-02\n---\n');
  assert.equal(typeof parsed.data.first_seen, 'string');
});

test('windows line endings are handled', () => {
  const parsed = parseLessonFile('---\r\ntitle: hello there\r\n---\r\nbody text');
  assert.equal(parsed.data.title, 'hello there');
  assert.equal(parsed.body, 'body text');
});

test('missing frontmatter throws a coded error', () => {
  assert.throws(() => parseLessonFile('no frontmatter here'), /E-FRONTMATTER/);
});
