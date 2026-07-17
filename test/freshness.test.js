import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lintFreshness,
  lintStaleness,
  referencedPaths,
  classifyPath,
  findContradictions,
  lintLessons,
  renderLint
} from '../src/lib/freshness.js';

function lesson(over = {}) {
  return {
    id: 'les_00000000000000000000000001',
    slug: 'demo-lesson',
    title: 'A timeless principle about validation',
    category: 'correctness',
    severity: 'medium',
    triggers: { keywords: [], paths: [] },
    lesson: 'Validate every input at the boundary before trusting it.',
    ...over
  };
}

test('freshness flags a pinned version, a year, time-relative wording, and pointers', () => {
  assert.deepEqual(lintFreshness(lesson()), []); // timeless = clean

  const dated = lintFreshness(lesson({ lesson: 'Claude Code v2.1.168 currently needs the --bare flag.' }));
  const signals = dated.map((f) => f.why);
  assert.ok(signals.some((w) => /version/.test(w)));
  assert.ok(signals.some((w) => /time-relative/.test(w)));

  const year = lintFreshness(lesson({ lesson: 'As of 2026 the API changed shape.' }));
  assert.ok(year.some((f) => f.signal === 'dated' && f.evidence === '2026'));

  const ptr = lintFreshness(lesson({ lesson: 'See src/lib/x.js line 42 — TODO revisit.' }));
  assert.ok(ptr.some((f) => f.signal === 'pointer'));
});

test('referencedPaths keeps only atlas-checkable paths, deduped', () => {
  const rp = referencedPaths(lesson({
    triggers: { keywords: [], paths: ['src/lib/validate.js', 'config', '.env', 'package.json'] },
    lesson: 'Prefer ./src/lib/validate.js and README.md over ad-hoc checks in x.js.'
  }));
  assert.ok(rp.includes('src/lib/validate.js'));
  assert.ok(rp.includes('README.md'));
  assert.ok(rp.includes('x.js'));
  // unindexed/bare hints are dropped — the atlas can't verify them, so no false stale
  assert.ok(!rp.includes('config'));
  assert.ok(!rp.includes('.env'));
  assert.ok(!rp.includes('package.json')); // .json not indexed by the atlas
  assert.equal(rp.filter((x) => x === 'src/lib/validate.js').length, 1); // deduped across trigger + ./-normalised
});

test('classifyPath: present / moved / gone against atlas file labels', () => {
  const files = ['src/lib/validate.js', 'src/commands/init.js'];
  assert.equal(classifyPath('src/lib/validate.js', files).status, 'present');
  assert.equal(classifyPath('validate.js', files).status, 'present'); // suffix match
  assert.equal(classifyPath('lib/init.js', files).status, 'moved');   // basename survives elsewhere
  assert.equal(classifyPath('src/lib/gone.js', files).status, 'gone');
});

test('staleness is atlas-provable and skipped without an atlas', () => {
  const l = lesson({ triggers: { keywords: [], paths: ['src/lib/removed.js'] } });
  assert.deepEqual(lintStaleness(l, null), []);       // no atlas -> no claim
  assert.deepEqual(lintStaleness(l, []), []);          // empty atlas -> no claim
  const stale = lintStaleness(l, ['src/lib/validate.js']);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].severity, 'stale');
  assert.equal(stale[0].path, 'src/lib/removed.js');
});

test('contradiction: opposite advice on a shared topic is surfaced, agreement is not', () => {
  const a = lesson({ id: 'les_A', slug: 'money-floats-ok', triggers: { keywords: ['money', 'float'], paths: [] }, lesson: 'You should use floats for money, they are simpler.' });
  const b = lesson({ id: 'les_B', slug: 'money-no-floats', triggers: { keywords: ['money', 'float'], paths: [] }, lesson: 'Never use floats for money; store integer cents.' });
  const c = lesson({ id: 'les_C', slug: 'money-cents', triggers: { keywords: ['money', 'float'], paths: [] }, lesson: 'Always store money as integer cents for exactness.' });

  const found = findContradictions([a, b, c]);
  const pair = found.find((f) => (f.a.slug === 'money-floats-ok' && f.b.slug === 'money-no-floats') || (f.a.slug === 'money-no-floats' && f.b.slug === 'money-floats-ok'));
  assert.ok(pair, 'a<->b opposite advice on floats should be flagged');
  // b and c agree (both anti-float) -> no contradiction between them
  assert.ok(!found.some((f) => [f.a.slug, f.b.slug].sort().join() === ['money-cents', 'money-no-floats'].sort().join()));
});

test('contradiction needs a real topical overlap (>=2 shared terms)', () => {
  const a = lesson({ id: 'les_A', slug: 'a-one', triggers: { keywords: ['cache'], paths: [] }, lesson: 'Always use a cache.' });
  const b = lesson({ id: 'les_B', slug: 'b-one', triggers: { keywords: ['cache'], paths: [] }, lesson: 'Never use a cache.' });
  assert.equal(findContradictions([a, b]).length, 0); // only one shared term -> not enough signal
});

test('lintLessons aggregates counts and renderLint stays advisory', () => {
  const lessons = [
    lesson({ id: 'les_1', slug: 'dated-one', lesson: 'Currently the v1.2.3 client is required.' }),
    lesson({ id: 'les_2', slug: 'stale-one', triggers: { keywords: [], paths: ['src/gone.js'] }, lesson: 'Guard src/gone.js carefully.' })
  ];
  const rep = lintLessons(lessons, { atlasFiles: ['src/lib/validate.js'] });
  assert.ok(rep.counts.freshness >= 1);
  assert.equal(rep.counts.staleness, 1);
  assert.equal(rep.atlasChecked, true);
  const text = renderLint(rep);
  assert.match(text, /advisory only/);
  assert.match(text, /STALE/);
  assert.match(text, /raph retire/);
});

test('renderLint on a clean brain says clean, and notes a skipped atlas check', () => {
  const clean = renderLint(lintLessons([lesson()], { atlasFiles: null }));
  assert.match(clean, /clean/);
  assert.match(clean, /staleness skipped/);
});
