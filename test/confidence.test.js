import test from 'node:test';
import assert from 'node:assert/strict';
import { computeConfidence, confidenceBand, ageDays } from '../src/lib/confidence.js';
import { retireCandidates } from '../src/lib/freshness.js';

const NOW = new Date('2026-07-17T00:00:00Z');

function lesson(over = {}) {
  return {
    id: over.id ?? 'les_1',
    slug: over.slug ?? 'demo',
    category: over.category ?? 'correctness',
    evidence: { observations: 1, distinct_projects: 1, last_seen: '2026-07-10', ...(over.evidence || {}) },
    provenance: { tier: 'user', human_edited: false, ...(over.provenance || {}) }
  };
}

test('confidence rises with breadth and repetition, within 0-10', () => {
  const weak = computeConfidence(lesson({ evidence: { observations: 1, distinct_projects: 1, last_seen: '2026-07-16' } }), { now: NOW });
  const strong = computeConfidence(lesson({ evidence: { observations: 8, distinct_projects: 3, last_seen: '2026-07-16' } }), { now: NOW });
  assert.ok(strong > weak);
  assert.ok(strong <= 10 && weak >= 0);
});

test('breadth (distinct projects) beats raw repetition in one project', () => {
  const oneProjectManyTimes = computeConfidence(lesson({ evidence: { observations: 8, distinct_projects: 1, last_seen: '2026-07-16' } }), { now: NOW });
  const manyProjectsFewTimes = computeConfidence(lesson({ evidence: { observations: 3, distinct_projects: 3, last_seen: '2026-07-16' } }), { now: NOW });
  assert.ok(manyProjectsFewTimes > oneProjectManyTimes);
});

test('age decays evidence-based confidence', () => {
  const fresh = computeConfidence(lesson({ evidence: { observations: 5, distinct_projects: 2, last_seen: '2026-07-16' } }), { now: NOW });
  const old = computeConfidence(lesson({ evidence: { observations: 5, distinct_projects: 2, last_seen: '2025-07-16' } }), { now: NOW }); // ~1yr
  assert.ok(old < fresh);
});

test('curated tier floors at 6 and resists age; auto is discounted', () => {
  const curatedOld = computeConfidence(lesson({ provenance: { tier: 'curated' }, evidence: { observations: 0, distinct_projects: 0, last_seen: '2020-01-01' } }), { now: NOW });
  assert.ok(curatedOld >= 6, `curated floor, got ${curatedOld}`);
  const auto = computeConfidence(lesson({ provenance: { tier: 'auto' }, evidence: { observations: 4, distinct_projects: 2, last_seen: '2026-07-16' } }), { now: NOW });
  const user = computeConfidence(lesson({ provenance: { tier: 'user' }, evidence: { observations: 4, distinct_projects: 2, last_seen: '2026-07-16' } }), { now: NOW });
  assert.ok(auto < user);
});

test('confidenceBand + ageDays helpers', () => {
  assert.equal(confidenceBand(8), 'high');
  assert.equal(confidenceBand(5), 'medium');
  assert.equal(confidenceBand(2), 'low');
  assert.equal(ageDays(lesson({ evidence: { last_seen: '2026-07-07' } }), NOW), 10);
  assert.equal(ageDays({ evidence: {} }, NOW), null);
});

test('retire sweep needs injection history before it will judge', () => {
  const lessons = [lesson({ id: 'les_x', slug: 'weak-old', evidence: { observations: 0, distinct_projects: 0, last_seen: '2026-01-01' } })];
  const r = retireCandidates(lessons, { events: [{ event: 'injected', lessons: [] }], now: NOW });
  assert.equal(r.ready, false); // <20 injections
  assert.equal(r.items.length, 0);
});

test('retire sweep flags low-confidence never-fired aged lessons, exempts security + fired', () => {
  const injectedEvents = Array.from({ length: 25 }, (_, i) => ({ event: 'injected', session_id: `s${i}`, lessons: i === 0 ? [{ id: 'les_fired' }] : [] }));
  const lessons = [
    lesson({ id: 'les_weak', slug: 'weak-old', evidence: { observations: 0, distinct_projects: 0, last_seen: '2026-01-01' } }), // low + old + never fired -> flagged
    lesson({ id: 'les_fired', slug: 'fired-one', evidence: { observations: 0, distinct_projects: 0, last_seen: '2026-01-01' } }), // fired -> exempt
    lesson({ id: 'les_new', slug: 'new-one', evidence: { observations: 0, distinct_projects: 0, last_seen: '2026-07-16' } }),   // too new -> exempt
    lesson({ id: 'les_sec', slug: 'sec-one', category: 'security', evidence: { observations: 0, distinct_projects: 0, last_seen: '2026-01-01' } }) // security -> exempt
  ];
  const r = retireCandidates(lessons, { events: injectedEvents, now: NOW });
  assert.equal(r.ready, true);
  const slugs = r.items.map((i) => i.slug);
  assert.deepEqual(slugs, ['weak-old']);
});
