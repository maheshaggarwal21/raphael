import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lintFreshness,
  lintStaleness,
  referencedPaths,
  classifyPath,
  findContradictions,
  lintLessons,
  scopedToProject,
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

// REGRESSION (audit 2026-07-26): `raph lint` linted EVERY active lesson against
// the cwd project's atlas, so a lesson about another project's file was reported
// 'stale' — pushing the user to retire a valid lesson. The linter's own contract
// says staleness stays provable, and this graph proves nothing about that project.
test('lintLessons: staleness is only claimed for lessons in scope for the linted project', () => {
  const atlasFiles = ['src/lib/validate.js', 'src/lib/inject.js'];

  const foreign = {
    id: 'les_1', slug: 'moneycore-rounding', category: 'correctness', severity: 'medium',
    scope: { projects: ['onedesk'] },
    triggers: { keywords: [], paths: [] },
    lesson: 'Rounding in moneycore.js drifts when totals are summed as floats.'
  };
  const mine = {
    id: 'les_2', slug: 'validate-chokepoint', category: 'correctness', severity: 'medium',
    scope: { projects: ['raphael'] },
    triggers: { keywords: [], paths: [] },
    lesson: 'Every write path goes through src/lib/validate.js or it is not a write path.'
  };
  const unscoped = {
    id: 'les_3', slug: 'ghost-path', category: 'correctness', severity: 'low',
    scope: { projects: [] },
    triggers: { keywords: [], paths: [] },
    lesson: 'A helper in src/lib/deleted-helper.js used to own this and no longer exists.'
  };

  const rep = lintLessons([foreign, mine, unscoped], { atlasFiles, project: 'raphael' });
  const stale = (id) =>
    (rep.lessons.find((r) => r.id === id)?.findings ?? []).filter((f) => f.kind === 'staleness');

  assert.equal(stale('les_1').length, 0, "another project's file must NOT be called stale");
  assert.equal(rep.skippedStaleness, 1, 'and the skip is reported honestly');
  assert.equal(stale('les_2').length, 0, 'an in-scope lesson whose file exists is fine');
  assert.equal(stale('les_3').length, 1, 'an unscoped lesson claims to apply here, so it IS checked');

  // Failure/edge: with no project supplied, a SCOPED lesson cannot be judged...
  const noProject = lintLessons([foreign], { atlasFiles, project: null });
  assert.equal((noProject.lessons[0]?.findings ?? []).filter((f) => f.kind === 'staleness').length, 0);
  // ...and with no atlas at all nothing is claimed for anyone.
  const noAtlas = lintLessons([foreign, unscoped], { atlasFiles: null, project: 'raphael' });
  assert.equal(noAtlas.counts.staleness, 0);
  assert.equal(noAtlas.atlasChecked, false);
  assert.equal(noAtlas.skippedStaleness, 0, 'nothing to skip when nothing could be checked');
});

test('scopedToProject: in-scope, out-of-scope, unscoped, and unknown-project cases', () => {
  const scoped = { scope: { projects: ['raphael', 'assay'] } };
  assert.equal(scopedToProject(scoped, 'raphael'), true);
  assert.equal(scopedToProject(scoped, 'assay'), true);
  assert.equal(scopedToProject(scoped, 'onedesk'), false);
  assert.equal(scopedToProject(scoped, null), false, 'unknown project: refuse to guess');
  assert.equal(scopedToProject({ scope: { projects: [] } }, 'anything'), true);
  assert.equal(scopedToProject({}, 'anything'), true, 'no scope block at all = applies anywhere');
  assert.equal(scopedToProject({ scope: {} }, null), true);
});

// REGRESSION (audit 2026-07-26): the dated/pointer regexes fired on TIMELESS
// lessons — "Use 2048-bit RSA keys" read as a year, "aim for a 3:1 contrast
// ratio" as a line pointer. The design pack's contrast lessons are exactly that
// shape, so the linter was flagging the very lessons it exists to protect. The
// old tests only covered true positives.
test('lintFreshness: timeless numbers are not dates or line pointers', () => {
  const clean = [
    'Use 2048-bit RSA keys.',
    'Aim for a 3:1 contrast ratio for large text.',
    'Body text under 4.5:1 contrast fails WCAG AA.',
    'Touch targets should be at least 44x44px.',
    'Listen on port 8080 by default.',
    'Allow 300ms for the animation.'
  ];
  for (const text of clean) {
    assert.deepEqual(lintFreshness({ lesson: text }), [], `must not flag: ${text}`);
  }
});

test('lintFreshness: the real dated and pointer idioms still fire', () => {
  const flagged = (text, signal) => {
    const hits = lintFreshness({ lesson: text });
    assert.ok(hits.some((h) => h.signal === signal), `expected a ${signal} finding for: ${text}`);
  };
  flagged('This was fixed in 2024.', 'dated');
  flagged('As of 2019 the API changed.', 'dated');
  flagged('Pinned to v1.2.3.', 'dated');
  flagged('Use the latest version of the SDK.', 'dated');
  flagged('See line 42 of the handler.', 'pointer');
  flagged('The bug is in src/app.js:317.', 'pointer');
  flagged('TODO: revisit this after the migration.', 'pointer');
});

// Found by RUNNING the linter on the real 88-lesson brain after tightening the
// other patterns: "Node.js" ends in .js, so a lesson mentioning it was reported
// STALE against every project atlas — the linter inventing rot in prose.
test('referencedPaths ignores technology names that merely end in an indexed extension', () => {
  assert.deepEqual(referencedPaths({ lesson: 'Node.js fs throws ENOENT for backslash paths.' }), []);
  assert.deepEqual(referencedPaths({ lesson: 'Next.js and Vue.js both ship a dev server.' }), []);
  // a REAL path in the same sentence is still picked up
  assert.deepEqual(
    referencedPaths({ lesson: 'Node.js resolves this in src/lib/paths.js at startup.' }),
    ['src/lib/paths.js']
  );
  // and explicit trigger paths are untouched
  assert.deepEqual(
    referencedPaths({ triggers: { paths: ['src/app.js'] }, lesson: 'unrelated prose' }),
    ['src/app.js']
  );
});
