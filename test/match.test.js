import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLesson, rank, globToRegex, extractPaths } from '../src/lib/match.js';

const RECENT = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
const STALE = '2024-01-01';

function entry(over = {}) {
  return {
    id: over.id ?? 'les_TESTTESTTESTTESTTESTTESTTE',
    slug: over.slug ?? 'webhook-idempotency',
    severity: over.severity ?? 'high',
    scope: { stacks: ['node'], projects: [], agents: [], ...(over.scope ?? {}) },
    triggers: { keywords: ['webhook', 'idempoten'], paths: ['**/webhook*/**'], ...(over.triggers ?? {}) },
    evidence: { observations: 5, distinct_projects: 2, last_seen: RECENT, ...(over.evidence ?? {}) },
    injection: { headline: 'Webhook redelivery caused a double charge — no event-id dedup.', tokens: 20 }
  };
}

test('keyword hits score 4.0 each, capped, with readable reasons', () => {
  const one = scoreLesson(entry(), { text: 'my webhook is broken' });
  assert.equal(one.reasons.some((r) => r.startsWith('keyword:webhook+4.0')), true);

  const two = scoreLesson(entry(), { text: 'webhook idempotency problem' });
  assert.ok(two.score >= 8.0); // both keywords hit ("idempoten" is a stem)

  const many = entry({ triggers: { keywords: ['a1', 'a2', 'a3', 'a4', 'a5'] } });
  const capped = scoreLesson(many, { text: 'a1 a2 a3 a4 a5' });
  const kwReason = capped.reasons.find((r) => r.startsWith('keyword:'));
  assert.ok(kwReason.endsWith('+12.0')); // 4.0 × cap(3), not × 5
});

test('stack overlap scores 3.0; empty stacks mean any-stack +1.0', () => {
  const s = scoreLesson(entry(), { stacks: ['node', 'docker'] });
  assert.ok(s.reasons.some((r) => r.startsWith('stack:node+3.0')));

  const any = scoreLesson(entry({ scope: { stacks: [] } }), { stacks: ['python'] });
  assert.ok(any.reasons.includes('any-stack+1.0'));

  const miss = scoreLesson(entry(), { stacks: ['python'] });
  assert.equal(miss.reasons.some((r) => r.startsWith('stack:')), false);
});

test('trigger paths match path-looking tokens pulled from the text', () => {
  const paths = extractPaths('please fix src/webhooks/stripe.js and re-run tests');
  assert.deepEqual(paths, ['src/webhooks/stripe.js']);
  const s = scoreLesson(entry(), { text: 'fix src/webhooks/stripe.js', paths });
  assert.ok(s.reasons.some((r) => r.startsWith('path:')));
});

test('globToRegex: ** spans dirs, * stays in one segment, leading **/ optional', () => {
  const re = globToRegex('**/webhook*/**');
  assert.equal(re.test('src/webhooks/stripe.js'), true);
  assert.equal(re.test('webhooks/handler.js'), true);
  assert.equal(re.test('src/payments/charge.js'), false);
  assert.equal(globToRegex('src/*.js').test('src/a.js'), true);
  assert.equal(globToRegex('src/*.js').test('src/deep/a.js'), false);
});

test('prior is bounded at 1.0: half observations, half recency', () => {
  const full = scoreLesson(entry(), {});
  assert.ok(full.reasons.includes('prior+1.0')); // 5 obs + recent

  const stale = scoreLesson(entry({ evidence: { observations: 5, last_seen: STALE } }), {});
  assert.ok(stale.reasons.includes('prior+0.5'));

  const thin = scoreLesson(entry({ evidence: { observations: 1, last_seen: STALE } }), {});
  assert.ok(thin.reasons.includes('prior+0.1'));
});

test('already-injected lessons drop by 10 and fall out of ranked results', () => {
  const e = entry();
  const injected = new Set([e.id]);
  const s = scoreLesson(e, { text: 'webhook bug', stacks: ['node'], injected });
  assert.ok(s.reasons.includes('already-injected-10.0'));
  assert.ok(s.score < 0);
  assert.equal(rank([e], { text: 'webhook bug', stacks: ['node'], injected }, 4.0).length, 0);
});

test('agent scoping filters only when retrieval names an agent', () => {
  const e = entry({ scope: { stacks: ['node'], agents: ['debugger', 'reviewer'] } });
  assert.equal(scoreLesson(e, { agent: 'designer' }), null);
  assert.notEqual(scoreLesson(e, { agent: 'debugger' }), null);
  assert.notEqual(scoreLesson(e, {}), null); // plain session sees everything
});

test('project-pinned lessons never leak into other or unknown projects', () => {
  const e = entry({ scope: { stacks: ['node'], projects: ['acme-shop'] } });
  assert.equal(scoreLesson(e, { project: 'other-app' }), null);
  assert.equal(scoreLesson(e, {}), null); // unknown project = excluded
  assert.notEqual(scoreLesson(e, { project: 'ACME-Shop' }), null); // name compare is case-insensitive
});

test('rank sorts by score, then severity, then slug — deterministic', () => {
  const high = entry({ slug: 'b-high', severity: 'high', triggers: { keywords: ['x'] } });
  const crit = entry({ id: 'les_TESTTESTTESTTESTTESTTES2', slug: 'a-crit', severity: 'critical', triggers: { keywords: ['x'] } });
  const ranked = rank([high, crit], { text: 'x marks it', stacks: ['node'] }, 0);
  assert.equal(ranked[0].entry.slug, 'a-crit'); // same score → severity wins
  assert.equal(ranked[1].entry.slug, 'b-high');
});

test('globToRegex: ? is a single-char wildcard, not a quantifier; invalid input never throws', () => {
  // REGRESSION (audit 2026-07-26): '?' was not escaped, so it acted as a regex
  // quantifier — 'file?.js' matched 'file.js' — and a leading '?' threw
  // "Nothing to repeat", which scoreLesson swallowed into a silently dead trigger.
  const one = globToRegex('src/file?.js');
  assert.equal(one.test('src/file1.js'), true, '? matches exactly one char');
  assert.equal(one.test('src/file.js'), false, '? must NOT match zero chars');
  assert.equal(one.test('src/file12.js'), false, '? must NOT match two chars');
  assert.equal(one.test('src/file/.js'), false, '? must not cross a separator');

  // a pattern starting with '?' used to throw
  assert.doesNotThrow(() => globToRegex('?abc'));
  assert.equal(globToRegex('?abc').test('xabc'), true);

  // regex metacharacters stay literal
  assert.equal(globToRegex('src/a+b.js').test('src/a+b.js'), true);
  assert.equal(globToRegex('src/a+b.js').test('src/aab.js'), false);
  assert.equal(globToRegex('src/(x).js').test('src/(x).js'), true);

  // a pattern with a REAL space no longer over-matches (the old space sentinel)
  const spaced = globToRegex('my docs/notes.md');
  assert.equal(spaced.test('my docs/notes.md'), true);
  assert.equal(spaced.test('mystery/docs/x/notes.md'), false, 'a literal space is not **');

  // edges: empty pattern, and ** still spans separators
  assert.equal(globToRegex('').test(''), true);
  assert.equal(globToRegex('**/webhook*/**').test('a/b/webhooks/x.js'), true);
  assert.equal(globToRegex('src/*.js').test('src/a/b.js'), false, '* stays in one segment');
});
