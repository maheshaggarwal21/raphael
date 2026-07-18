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

// Regression: `raph contribute <slug>` with NO --out used to export nothing.
// outIdx === -1 made the filter drop args[0] (the slug itself).
test('command: `contribute <slug>` with no --out writes the export file', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const { writeActiveLesson } = await import('./helpers.js');
  const contributeCmd = (await import('../src/commands/contribute.js')).default;

  const home = mkdtempSync(pathMod.join(os.tmpdir(), 'raph-contrib-cmd-'));
  const cwd = mkdtempSync(pathMod.join(os.tmpdir(), 'raph-contrib-cwd-'));
  const origCwd = process.cwd();
  process.env.RAPHAEL_HOME = home;
  const origLog = console.log;
  console.log = () => {};
  try {
    writeActiveLesson({
      slug: 'debounce-inputs-well',
      title: 'Debounce expensive input handlers',
      lesson: 'Debounce expensive search input handlers so keystrokes do not flood the backend API.',
      injection: { headline: 'Debounce expensive input handlers to avoid flooding the API.', tokens: 12 },
      provenance: { created_by: 'test', source_kind: 'session-transcript', human_edited: false, tier: 'user' }
    });
    process.chdir(cwd);
    const code = await contributeCmd(['debounce-inputs-well']);
    assert.equal(code, 0);
    assert.ok(existsSync(pathMod.join(cwd, 'raphael-contrib', 'debounce-inputs-well.md')),
      'export file should be written under the default raphael-contrib dir');
  } finally {
    console.log = origLog;
    process.chdir(origCwd);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    delete process.env.RAPHAEL_HOME;
  }
});
