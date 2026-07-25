// 18.2 (preference category + its decay policy) + 18.13 (surface the boundary)
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLine } from '../src/lib/inject.js';
import { computeConfidence } from '../src/lib/confidence.js';
import { validateLesson } from '../src/lib/validate.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';
import { makeLesson } from './helpers.js';

// --- 18.2 preference lessons ---------------------------------------------------

test('preference is a valid category through the real chokepoint', () => {
  const content = makeLesson({ status: 'active', category: 'preference' });
  const res = validateLesson(content);
  assert.ok(res.ok, `rejected: ${res.errors.map((e) => e.code).join(', ')}`);
  assert.equal(res.quarantine, false);
});

test('a stated preference does not rot with age, but is not treated as expert-curated either', () => {
  const old = { evidence: { observations: 1, distinct_projects: 1, last_seen: '2020-01-01' }, provenance: { tier: 'user' } };
  const asPreference = computeConfidence({ ...old, category: 'preference' });
  const asObservation = computeConfidence({ ...old, category: 'correctness' });
  assert.ok(asPreference > asObservation, 'age must not quietly retire a stated preference');
  assert.ok(asPreference >= 5, 'it holds a floor');
  // still below the curated expert floor — a preference is a convention, not vetted expertise
  const curated = computeConfidence({ ...old, category: 'correctness', provenance: { tier: 'curated' } });
  assert.ok(asPreference <= curated, 'a preference must not outrank a curated lesson');
});

test('the preference floor does not lift other categories (no accidental blanket bump)', () => {
  const base = { evidence: { observations: 1, distinct_projects: 1, last_seen: '2020-01-01' }, provenance: { tier: 'user' } };
  for (const cat of ['correctness', 'tooling', 'process', 'design']) {
    assert.ok(computeConfidence({ ...base, category: cat }) < 5, `${cat} must not get the preference floor`);
  }
});

// --- 18.13 surface the boundary ------------------------------------------------

test('renderLine labels the boundary as its own clause when the lesson has one', () => {
  const line = renderLine({
    id: 'les_x', title: 't',
    evidence: { observations: 2, distinct_projects: 1 },
    injection: { headline: 'Retry storms amplify an outage' },
    counter_indications: 'Does not apply to idempotent reads behind a cache.'
  }, { withBoundary: true });
  assert.match(line, /Retry storms amplify an outage/);
  assert.match(line, /not when: Does not apply to idempotent reads/);
});

test('a lesson with no boundary renders exactly as before (no empty ceremony)', () => {
  const entry = { id: 'les_y', title: 't', evidence: { observations: 1, distinct_projects: 1 }, injection: { headline: 'H' } };
  assert.equal(renderLine(entry), '[les_y] (seen 1x / 1 project) H');
  assert.equal(renderLine({ ...entry, counter_indications: '   ' }), '[les_y] (seen 1x / 1 project) H', 'whitespace-only is not a boundary');
  assert.equal(renderLine({ ...entry, counter_indications: null }), '[les_y] (seen 1x / 1 project) H');
});

test('a long boundary is clamped so one lesson cannot eat the recall budget (edge)', () => {
  const line = renderLine({
    id: 'les_z', title: 't',
    evidence: { observations: 1, distinct_projects: 1 },
    injection: { headline: 'H' },
    counter_indications: 'y'.repeat(500)
  }, { withBoundary: true });
  assert.ok(line.length < 300, `boundary was not clamped: ${line.length} chars`);
  assert.match(line, /…$/);
});

test('the per-prompt nudge stays terse: the boundary is digest-only (budget decision)', () => {
  const entry = {
    id: 'les_p', title: 't',
    evidence: { observations: 1, distinct_projects: 1 },
    injection: { headline: 'H' },
    counter_indications: 'Does not apply behind a cache.'
  };
  assert.ok(!renderLine(entry).includes('not when:'), 'per-prompt default must stay terse');
  assert.ok(renderLine(entry, { withBoundary: true }).includes('not when:'), 'the digest opts in');
});
