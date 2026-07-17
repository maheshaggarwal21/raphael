import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSelfPatch, chokepointTouched, renderSelfPatch, CHOKEPOINT_FILES } from '../src/lib/selfpatch.js';

const GREEN = { branch: 'feat/x', testsPassed: true, evalPassed: true };

test('chokepointTouched matches the security-critical files (any path form)', () => {
  assert.deepEqual(chokepointTouched(['src/lib/foo.js']), []);
  assert.deepEqual(chokepointTouched(['src/lib/validate.js']), ['src/lib/validate.js']);
  assert.deepEqual(chokepointTouched(['src\\lib\\scrub.js']), ['src/lib/scrub.js']); // windows sep
  assert.ok(CHOKEPOINT_FILES.includes('src/lib/validate.js'));
});

test('a clean non-chokepoint patch on a green branch is CLEAR TO PRESENT', () => {
  const r = evaluateSelfPatch({ ...GREEN, changedFiles: ['src/lib/atlas.js', 'test/atlas.test.js'] });
  assert.equal(r.ok, true);
  assert.equal(r.present, true);        // §11.11 — always present, never merge
  assert.equal(r.heavyweight, false);
  assert.match(renderSelfPatch(r), /CLEAR TO PRESENT/);
});

test('touching a chokepoint file is heavyweight — blocked until acknowledged', () => {
  const files = ['src/lib/validate.js'];
  const noAck = evaluateSelfPatch({ ...GREEN, changedFiles: files });
  assert.equal(noAck.ok, false);
  assert.equal(noAck.heavyweight, true);
  assert.ok(noAck.blockers.includes('chokepoint-ack'));

  const acked = evaluateSelfPatch({ ...GREEN, changedFiles: files, chokepointAck: true });
  assert.equal(acked.ok, true);
  assert.equal(acked.heavyweight, true); // still flagged, but acknowledged
});

test('a copyleft near-verbatim port is blocked regardless of the gate', () => {
  const r = evaluateSelfPatch({ ...GREEN, changedFiles: ['src/lib/x.js'], licenseFamily: 'copyleft' });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.includes('copyleft-port'));
  assert.equal(r.copyleftBlocked, true);
});

test('the self-upgrade gate still applies (default branch / red tests block)', () => {
  const onMain = evaluateSelfPatch({ branch: 'main', testsPassed: true, evalPassed: true, changedFiles: ['src/lib/x.js'] });
  assert.equal(onMain.ok, false);
  assert.ok(onMain.blockers.includes('branch'));

  const redTests = evaluateSelfPatch({ ...GREEN, testsPassed: false, changedFiles: ['src/lib/x.js'] });
  assert.equal(redTests.ok, false);
  assert.ok(redTests.blockers.includes('tests'));
  assert.match(renderSelfPatch(redTests), /BLOCKED/);
});
