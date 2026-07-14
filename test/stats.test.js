import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, renderStats, PROMPT_THRESHOLD } from '../src/lib/stats.js';

// A small synthetic audit log + active-lesson set covering every metric.
const ACTIVE = [
  { id: 'les_A', slug: 'env-no-commit', severity: 'high', category: 'security' },
  { id: 'les_B', slug: 'webhook-dedupe', severity: 'high', category: 'correctness' },
  { id: 'les_C', slug: 'never-fires-one', severity: 'low', category: 'style' },
  { id: 'les_D', slug: 'never-fires-two', severity: 'medium', category: 'security' }
];

const EVENTS = [
  { event: 'approved', id: 'les_A', slug: 'env-no-commit' },
  { event: 'approved', id: 'les_B', slug: 'webhook-dedupe' },
  { event: 'rejected', id: 'les_X', slug: 'bad-idea' },
  { event: 'suppressed-by-rejection-memory', episode_id: 'ep1' },
  { event: 'injected', ts: '2026-06-01T10:00:00Z', hook: 'session-start', session_id: 's1', tokens: 200, cap_reached: false,
    lessons: [{ id: 'les_A', slug: 'env-no-commit', severity: 'high', score: 6.0 }] },
  { event: 'injected', ts: '2026-06-01T10:05:00Z', hook: 'user-prompt', session_id: 's1', tokens: 40, cap_reached: false,
    lessons: [{ id: 'les_A', slug: 'env-no-commit', severity: 'high', score: 8.0 }] },
  { event: 'injected', ts: '2026-06-02T09:00:00Z', hook: 'user-prompt', session_id: 's2', tokens: 30, cap_reached: true,
    lessons: [{ id: 'les_B', slug: 'webhook-dedupe', severity: 'high', score: 4.2 }] }
];

test('computeStats tallies injection cost and sessions', () => {
  const s = computeStats(EVENTS, ACTIVE);
  assert.equal(s.injections.total, 3);
  assert.equal(s.injections.sessionStart, 1);
  assert.equal(s.injections.userPrompt, 2);
  assert.equal(s.injections.tokensTotal, 270);
  assert.equal(s.injections.tokensAvg, 90); // 270/3
  assert.equal(s.injections.sessions, 2);   // s1, s2
  assert.equal(s.injections.tokensPerSessionAvg, 135); // 270/2
  assert.equal(s.injections.capHits, 1);
  assert.equal(s.window.from, '2026-06-01T10:00:00Z');
  assert.equal(s.window.to, '2026-06-02T09:00:00Z');
});

test('fired lessons aggregate by id, sorted by count, with avg score', () => {
  const s = computeStats(EVENTS, ACTIVE);
  assert.equal(s.lessons.fired.length, 2);
  const a = s.lessons.fired.find((f) => f.id === 'les_A');
  assert.equal(a.count, 2);
  assert.equal(a.avgScore, 7.0); // (6.0 + 8.0)/2
  assert.equal(a.lastFired, '2026-06-01T10:05:00Z');
  assert.equal(s.lessons.fired[0].id, 'les_A'); // count 2 sorts before count 1
});

test('never-fired = active lessons with no injected event', () => {
  const s = computeStats(EVENTS, ACTIVE);
  const slugs = s.lessons.neverFired.map((l) => l.slug);
  assert.deepEqual(slugs, ['never-fires-one', 'never-fires-two']); // sorted
  assert.equal(s.lessons.active, 4);
  assert.equal(s.lessons.firedCount, 2);
});

test('low-score-fires flags only user-prompt fires near the threshold', () => {
  const s = computeStats(EVENTS, ACTIVE);
  // les_B fired once on a prompt at 4.2 (< 4.5) -> flagged.
  // les_A prompt fire was 8.0 -> not flagged, even though it also fired.
  assert.equal(s.lessons.lowScoreFires.length, 1);
  assert.equal(s.lessons.lowScoreFires[0].slug, 'webhook-dedupe');
  assert.ok(s.lessons.lowScoreFires[0].avgScore < PROMPT_THRESHOLD + 0.5);
});

test('review funnel counts approvals, rejections, suppressions', () => {
  const s = computeStats(EVENTS, ACTIVE);
  assert.deepEqual(s.review, { approved: 2, rejected: 1, suppressed: 1 });
});

test('empty log yields a clean zeroed report and a friendly render', () => {
  const s = computeStats([], ACTIVE);
  assert.equal(s.injections.total, 0);
  assert.equal(s.lessons.neverFired.length, 4);
  const text = renderStats(s);
  assert.match(text, /nothing recorded yet/);
});

test('renderStats surfaces the headline signals', () => {
  const text = renderStats(computeStats(EVENTS, ACTIVE));
  assert.match(text, /Injection cost/);
  assert.match(text, /never fired : 2\/4/);
  assert.match(text, /env-no-commit/);
  assert.match(text, /Review funnel/);
});
