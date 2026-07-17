import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOptimization, renderOptimization } from '../src/lib/optimizer.js';

const NOW = new Date('2026-07-17T00:00:00Z');

function lesson(over = {}) {
  return {
    id: over.id ?? 'les_1',
    slug: over.slug ?? 'demo',
    category: over.category ?? 'correctness',
    scope: over.scope ?? { agents: [] },
    evidence: over.evidence ?? { observations: 0, distinct_projects: 0, last_seen: '2026-01-01' },
    provenance: over.provenance ?? { tier: 'user' }
  };
}

const AGENTS = [{ slug: 'developer' }, { slug: 'reviewer' }, { slug: 'security' }];

function injections(n, firedMap = {}) {
  // n injected events; firedMap: sessionIndex -> [ids]
  return Array.from({ length: n }, (_, i) => ({ event: 'injected', session_id: `s${i}`, lessons: (firedMap[i] ?? []).map((id) => ({ id })) }));
}

test('optimizer gates the retire sweep on injection history', () => {
  const rep = buildOptimization({ lessons: [lesson()], events: injections(5), agents: AGENTS, now: NOW });
  assert.equal(rep.ready, false);
  assert.equal(rep.retire.length, 0);
});

test('optimizer surfaces retire candidates, retrieval miss, and agent coverage', () => {
  const lessons = [
    lesson({ id: 'les_weak', slug: 'weak-old' }), // low conf, never fired, old
    lesson({ id: 'les_fired', slug: 'fired-one', scope: { agents: ['developer'] } }),
    lesson({ id: 'les_sec', slug: 'sec-one', category: 'security' })
  ];
  const events = injections(25, { 0: ['les_fired'] }); // only les_fired ever fires
  const rep = buildOptimization({ lessons, events, agents: AGENTS, now: NOW });

  assert.equal(rep.ready, true);
  // weak-old flagged to retire; security exempt; fired-one not (it fired)
  assert.deepEqual(rep.retire.map((r) => r.slug), ['weak-old']);
  // retrieval miss excludes security: weak-old is the only non-security never-fired
  assert.equal(rep.retrievalMiss.excludingSecurity, 1);
  assert.ok(rep.retrievalMiss.sample.includes('weak-old'));
  // agent coverage: developer has 1 scoped lesson, reviewer + security have 0
  const dev = rep.agentCoverage.find((a) => a.slug === 'developer');
  assert.equal(dev.scopedLessons, 1);
  assert.equal(rep.agentCoverage.find((a) => a.slug === 'reviewer').scopedLessons, 0);

  const text = renderOptimization(rep);
  assert.match(text, /Retire candidates/);
  assert.match(text, /raph retire weak-old --confirmed/);
  assert.match(text, /no targeted lessons yet: reviewer, security/);
});
