// 18.7 (skill description lint) + 18.10 (effort routing on lesson confidence)
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSkillDescription } from '../src/lib/skillfactory.js';
import { routeEffortWithLessons, EFFORT_ORDER, ROUTE_MIN_CONFIDENCE } from '../src/lib/policy.js';

// --- 18.7 -----------------------------------------------------------------------

test('a well-routed description passes clean', () => {
  const issues = lintSkillDescription(
    'Use when reviewing a database migration for lock duration and rollback safety before it ships.',
    { name: 'migration-review' }
  );
  assert.deepEqual(issues, [], `unexpected: ${JSON.stringify(issues)}`);
});

test('vague wording is caught — the lint must actually fire (regression)', () => {
  // this exact case silently passed at first: `\b` inside a template literal is
  // the BACKSPACE character, not a word boundary, so the regex never matched
  const codes = lintSkillDescription('A general helper utility for various things').map((i) => i.code);
  assert.ok(codes.includes('SKILL-DESC-VAGUE'), `vague wording must be flagged, got: ${codes.join(',')}`);
});

test('the two opposite failures are both caught: too thin and too bloated', () => {
  assert.ok(lintSkillDescription('Does stuff').some((i) => i.code === 'SKILL-DESC-THIN'));
  const bloated = lintSkillDescription('use ' + 'word '.repeat(80));
  assert.ok(bloated.some((i) => i.code === 'SKILL-DESC-BLOATED'));
});

test('a description with no trigger cue, and one that just echoes the name, are flagged', () => {
  assert.ok(lintSkillDescription('Database migration review helper tooling').some((i) => i.code === 'SKILL-DESC-NO-TRIGGER'));
  assert.ok(lintSkillDescription('migration review', { name: 'migration-review' }).some((i) => i.code === 'SKILL-DESC-ECHO'));
});

test('a missing description is an error, not a warning (edge)', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const issues = lintSkillDescription(empty);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].level, 'error');
    assert.equal(issues[0].code, 'SKILL-DESC-MISSING');
  }
});

// --- 18.10 ----------------------------------------------------------------------

test('a strong, well-evidenced lesson match recommends exactly one step cheaper', () => {
  const r = routeEffortWithLessons('high', [{ confidence: 9, score: 8.2, slug: 'money-cents' }]);
  assert.equal(r.downgraded, true);
  assert.equal(r.from, 'high');
  assert.equal(r.effort, 'medium');
  assert.equal(EFFORT_ORDER.indexOf(r.effort), EFFORT_ORDER.indexOf('high') - 1, 'one step, never a leap');
  assert.match(r.why, /already covers this step/);
  assert.equal(r.lesson, 'money-cents');
});

test('a weak match changes nothing — it recommends, it does not gamble', () => {
  for (const m of [
    { confidence: ROUTE_MIN_CONFIDENCE - 1, score: 9 }, // well-matched but poorly evidenced
    { confidence: 9, score: 1.0 },                      // confident lesson, weak match
    {}
  ]) {
    const r = routeEffortWithLessons('high', [m]);
    assert.equal(r.downgraded, false, `should not downgrade on ${JSON.stringify(m)}`);
    assert.equal(r.effort, 'high');
  }
  assert.equal(routeEffortWithLessons('high', []).downgraded, false);
  assert.equal(routeEffortWithLessons('high').downgraded, false);
});

test('an already-escalated step is never downgraded, and low never goes lower (edge)', () => {
  const esc = routeEffortWithLessons('high', [{ confidence: 10, score: 9 }], { escalated: true });
  assert.equal(esc.downgraded, false);
  assert.match(esc.why, /already escalated/);
  const low = routeEffortWithLessons('low', [{ confidence: 10, score: 9 }]);
  assert.equal(low.downgraded, false);
  assert.match(low.why, /cheapest/);
});

test('an unknown effort falls back to medium rather than throwing (fail-safe)', () => {
  const r = routeEffortWithLessons('turbo', [{ confidence: 10, score: 9 }]);
  assert.ok(EFFORT_ORDER.includes(r.effort));
  assert.equal(r.effort, 'low', 'medium downgraded one step');
});
