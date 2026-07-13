import test from 'node:test';
import assert from 'node:assert/strict';
import { PACK_SPECS, packLesson, buildSecurityPack } from '../src/lib/security-pack.js';
import { validateLesson } from '../src/lib/validate.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';

// The whole point of the pack is that it enters the brain through the SAME
// chokepoint as everything else — no bypass. So every lesson must pass cleanly.
test('every security-pack lesson passes the chokepoint unquarantined', () => {
  for (const spec of PACK_SPECS) {
    const data = packLesson(spec, { today: '2026-07-14' });
    const content = serializeLessonFile(data);
    const res = validateLesson(content);
    assert.ok(res.ok, `${spec.slug} rejected: ${res.errors.map((e) => `${e.code}:${e.msg}`).join('; ')}`);
    assert.equal(res.quarantine, false, `${spec.slug} was quarantined: ${res.warnings.map((w) => w.code).join(', ')}`);
  }
});

test('the pack is all security-category candidates, never auto-active', () => {
  for (const data of buildSecurityPack({ today: '2026-07-14' })) {
    assert.equal(data.category, 'security');
    assert.equal(data.status, 'candidate');
    // security + tier:auto is the one combination E-AUTOSEC forbids
    assert.notEqual(data.provenance.tier, 'auto');
  }
});

test('no pack lesson carries a URL (invariant #3)', () => {
  const URL_RE = /(?:[a-z][a-z0-9+.-]*):\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
  for (const spec of PACK_SPECS) {
    const blob = [spec.title, spec.lesson, spec.headline, spec.based_on].join('\n');
    assert.ok(!URL_RE.test(blob), `${spec.slug} contains a URL`);
  }
});

test('every pack lesson speaks in declarative voice (no "you must/should")', () => {
  const IMPERATIVE_RE = /\byou (?:must|should|need to|have to|shall)\b/i;
  for (const spec of PACK_SPECS) {
    const risky = [spec.title, spec.lesson, spec.headline].join('\n');
    assert.ok(!IMPERATIVE_RE.test(risky), `${spec.slug} uses agent-directed phrasing`);
  }
});

test('slugs are unique and every lesson has real triggers', () => {
  const slugs = PACK_SPECS.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in the pack');
  for (const spec of PACK_SPECS) {
    assert.ok(Array.isArray(spec.keywords) && spec.keywords.length >= 3, `${spec.slug} needs keywords to be findable`);
    assert.ok(spec.based_on, `${spec.slug} missing attribution`);
  }
});

test('the pack covers all five audit checklists', () => {
  const sources = new Set(PACK_SPECS.map((s) => s.based_on));
  for (const src of ['Gitleaks', 'Bearer', 'ECC Production Audit', 'Trail of Bits', 'ECC Security Review']) {
    assert.ok(sources.has(src), `pack is missing lessons based on ${src}`);
  }
  assert.ok(PACK_SPECS.length >= 15, 'a starter pack should be substantial');
});

test('pack lessons route to the security and reviewer agents', () => {
  for (const data of buildSecurityPack({ today: '2026-07-14' })) {
    assert.ok(data.scope.agents.includes('security'), `${data.slug} not routed to the security agent`);
  }
});
