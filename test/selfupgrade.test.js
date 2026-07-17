import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSelfUpgrade, renderSelfUpgrade } from '../src/lib/selfupgrade.js';

test('all three green on a feature branch = PASS', () => {
  const r = evaluateSelfUpgrade({ branch: 'feat/atlas', testsPassed: true, evalPassed: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.blockers, []);
  assert.match(renderSelfUpgrade(r), /PASS/);
});

test('the default branch is blocked even with green tests + eval', () => {
  for (const b of ['main', 'master']) {
    const r = evaluateSelfUpgrade({ branch: b, testsPassed: true, evalPassed: true });
    assert.equal(r.ok, false);
    assert.ok(r.blockers.includes('branch'));
  }
});

test('failing or un-run tests/eval block the merge', () => {
  const failed = evaluateSelfUpgrade({ branch: 'feat/x', testsPassed: false, evalPassed: true });
  assert.equal(failed.ok, false);
  assert.ok(failed.blockers.includes('tests'));

  const notRun = evaluateSelfUpgrade({ branch: 'feat/x', testsPassed: true, evalPassed: undefined });
  assert.equal(notRun.ok, false);
  assert.ok(notRun.blockers.includes('eval'));

  const text = renderSelfUpgrade(failed);
  assert.match(text, /BLOCKED/);
  assert.match(text, /no mutation/);
});

test('an unknown branch (git unavailable) blocks on branch', () => {
  const r = evaluateSelfUpgrade({ branch: null, testsPassed: true, evalPassed: true });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.includes('branch'));
  assert.match(renderSelfUpgrade(r), /could not determine/);
});
