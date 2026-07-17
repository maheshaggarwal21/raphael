import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLessonFile } from '../src/lib/frontmatter.js';
import { exportableLesson, renderContribution } from '../src/lib/contribute.js';
import { makeLesson } from './helpers.js';

const lessonObj = (overrides = {}) => parseLessonFile(makeLesson(overrides)).data;

test('export strips local traces: projects, path globs, evidence refs', () => {
  const lesson = lessonObj({
    scope: { stacks: ['node'], task_kinds: [], projects: ['my-secret-client-app'], agents: [] },
    triggers: { keywords: ['webhook'], paths: ['C:/Users/mahesh/**'] },
    evidence: { refs: [], observations: 3, distinct_projects: 2 }
  });
  lesson.evidence.refs = ['ev_01HZZZZZZZZZZZZZZZZZZZZZZZ'];
  const { data, content } = exportableLesson(lesson);
  assert.deepEqual(data.scope.projects, []);
  assert.deepEqual(data.triggers.paths, []);
  assert.equal(data.evidence.refs, undefined);
  // round-trips as a valid lesson file
  const { data: reread } = parseLessonFile(content);
  assert.equal(reread.slug, lesson.slug);
});

test('export re-scrubs secrets out of every text field', () => {
  const lesson = lessonObj({
    lesson: 'The deploy failed when AKIAIOSFODNN7EXAMPLE was rotated mid-release (seen twice).',
    counter_indications: 'None known.'
  });
  const { content } = exportableLesson(lesson);
  assert.ok(!content.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.match(content, /<SECRET:aws-key>/);
});

test('only ACTIVE lessons export; candidates are refused', () => {
  const lesson = lessonObj({ status: 'candidate' });
  assert.throws(() => exportableLesson(lesson), /E-CONTRIBUTE.*ACTIVE/);
});

test('an export that cannot pass the chokepoint is refused, not written', () => {
  // an invalid category survives scrubbing but fails schema validation
  const lesson = lessonObj({ category: 'not-a-real-category' });
  assert.throws(() => exportableLesson(lesson), /E-CONTRIBUTE.*chokepoint/);
});

test('renderContribution names the slug and the stripping', () => {
  const { data } = exportableLesson(lessonObj());
  const out = renderContribution(data);
  assert.match(out, /webhook-idempotency/);
  assert.match(out, /re-scrubbed/);
});
