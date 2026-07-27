import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLesson, rank, globToRegex, extractPaths, keywordHits, isNegatedAt, hasQueryHit } from '../src/lib/match.js';

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

// --- observation run 2026-07-27: F5 + F6 regressions -------------------------
// Both were measured against the real 74-lesson brain before being fixed, and
// both assertions fail on the pre-fix scorer (verified by reverting each change).

test('F5: a curated CRITICAL lesson outranks a lesson mined once', () => {
  // The exact shape that lost every session on the real brain: severity was only
  // a tie-break, so it never got consulted across different scores, and one mined
  // observation (+0.1 of prior) beat the entire severity ladder.
  const criticalCurated = entry({
    slug: 'check-ownership-to-stop-idor',
    severity: 'critical',
    scope: { stacks: [] },                       // any-stack, like the security pack
    evidence: { observations: 0, last_seen: RECENT } // curated => no mined observations
  });
  const mediumMinedOnce = entry({
    slug: 'inline-single-call-site-abstractions',
    severity: 'medium',
    scope: { stacks: [] },
    evidence: { observations: 1, last_seen: RECENT }
  });

  // session-start context: no task text at all, so only stack + severity + prior score
  const ctx = { stacks: [], text: '', paths: [], injected: new Set() };
  const crit = scoreLesson(criticalCurated, ctx);
  const mined = scoreLesson(mediumMinedOnce, ctx);

  assert.ok(
    crit.score > mined.score,
    `critical curated (${crit.score}) must outrank mined-once (${mined.score})`
  );
  assert.ok(crit.reasons.some((r) => r.startsWith('severity:critical+')));

  // and it must actually come out on top of the ranking, not merely score higher
  const ranked = rank([mediumMinedOnce, criticalCurated], ctx, 0);
  assert.equal(ranked[0].entry.slug, 'check-ownership-to-stop-idor');
});

test('F5: severity amplifies relevance but never manufactures it', () => {
  // A CRITICAL lesson scoped to stacks this project does not use must NOT be
  // dragged over the digest threshold by its severity alone.
  const offStack = entry({
    severity: 'critical',
    scope: { stacks: ['rails'] },
    evidence: { observations: 1, last_seen: RECENT }
  });
  const s = scoreLesson(offStack, { stacks: ['node'], text: '', paths: [] });
  assert.equal(s.reasons.some((r) => r.startsWith('severity:')), false);
  assert.ok(s.score < 1.0, `no relevance signal => stays below the digest threshold (got ${s.score})`);

  // low severity earns nothing even when relevant — the ladder bottoms out at 0
  const low = scoreLesson(entry({ severity: 'low', scope: { stacks: [] } }), { text: '', stacks: [] });
  assert.equal(low.reasons.some((r) => r.startsWith('severity:')), false);
});

test('F6: a keyword inside a negated phrase is not a hit', () => {
  const dbLesson = entry({
    slug: 'secure-the-production-database-connection',
    scope: { stacks: [] },
    triggers: { keywords: ['database'], paths: [] }
  });

  // The real Gatepost brief sentence that scored this lesson at 5.50.
  const negated = scoreLesson(dbLesson, { text: 'persistence is local files. no database.' });
  assert.equal(
    negated.reasons.some((r) => r.startsWith('keyword:')),
    false,
    '"No database." must not score a database lesson'
  );

  // success case: an ordinary mention still hits
  const plain = scoreLesson(dbLesson, { text: 'the database connection pool leaks' });
  assert.ok(plain.reasons.some((r) => r.startsWith('keyword:database+4.0')));

  // edge: one negated mention must not suppress a genuine one elsewhere
  const mixed = scoreLesson(dbLesson, { text: 'no database yet, but the database migration is next' });
  assert.ok(
    mixed.reasons.some((r) => r.startsWith('keyword:database+4.0')),
    'a real mention still counts even if another is negated'
  );
});

test('F6: negation helpers handle the boundaries', () => {
  assert.equal(keywordHits('no database', 'database'), 0);
  assert.equal(keywordHits('a database', 'database'), 1);
  assert.equal(keywordHits('database first', 'database'), 1);   // nothing before it
  assert.equal(keywordHits('', 'database'), 0);                  // empty text
  assert.equal(keywordHits('database', ''), 0);                  // empty keyword
  assert.equal(keywordHits('never use eval; eval is unsafe', 'eval'), 1); // 1 negated, 1 not

  // the window is bounded — a negator far away does not reach
  assert.equal(isNegatedAt('no ' + 'x'.repeat(60) + ' database', 63), false);
});

test('F15: hasQueryHit is the one definition of "the query matched"', () => {
  // query-derived signals count
  assert.equal(hasQueryHit(['keyword:webhook+4.0']), true);
  assert.equal(hasQueryHit(['path:src/a.js+2.0']), true);

  // context and attestation do NOT — this is the whole bug: three lessons
  // scoring only on these were presented as ranked search answers.
  assert.equal(hasQueryHit(['any-stack+1.0', 'prior+0.6']), false);
  assert.equal(hasQueryHit(['stack:node+3.0', 'prior+0.5']), false);
  assert.equal(hasQueryHit(['severity:critical+0.75', 'prior+0.5']), false);

  // edges
  assert.equal(hasQueryHit([]), false);
  assert.equal(hasQueryHit(undefined), false);
});
