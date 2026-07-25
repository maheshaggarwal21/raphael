// 18.9 theme packs (testing, performance) + 18.12 slopsquatting lesson
import test from 'node:test';
import assert from 'node:assert/strict';
import { TESTING_PACK_SPECS, PERFORMANCE_PACK_SPECS, buildTestingPack, buildPerformancePack } from '../src/lib/theme-packs.js';
import { PACK_SPECS, buildSecurityPack } from '../src/lib/security-pack.js';
import { validateLesson } from '../src/lib/validate.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';

const ALL = [
  ['testing', buildTestingPack, TESTING_PACK_SPECS],
  ['performance', buildPerformancePack, PERFORMANCE_PACK_SPECS]
];

test('every theme-pack lesson passes the chokepoint unquarantined', () => {
  for (const [name, build] of ALL) {
    for (const data of build({ today: '2026-07-25' })) {
      const res = validateLesson(serializeLessonFile(data));
      assert.ok(res.ok, `${name}/${data.slug} rejected: ${res.errors.map((e) => e.code).join(', ')}`);
      assert.equal(res.quarantine, false, `${name}/${data.slug} quarantined`);
    }
  }
});

test('theme packs are curated candidates in a valid category, never auto-tier', () => {
  const cats = { testing: 'process', performance: 'performance' };
  for (const [name, build] of ALL) {
    for (const data of build({ today: '2026-07-25' })) {
      assert.equal(data.status, 'candidate');
      assert.equal(data.provenance.tier, 'curated');
      assert.equal(data.category, cats[name]);
      assert.notEqual(data.provenance.tier, 'auto');
    }
  }
});

test('no theme-pack lesson carries a URL or agent-directed voice (invariant #3)', () => {
  const URL_RE = /(?:[a-z][a-z0-9+.-]*):\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
  const IMPERATIVE_RE = /\byou (?:must|should|need to|have to|shall)\b/i;
  for (const [, , specs] of ALL) {
    for (const s of specs) {
      const blob = [s.title, s.lesson, s.headline].join('\n');
      assert.ok(!URL_RE.test(blob), `${s.slug} contains a URL`);
      assert.ok(!IMPERATIVE_RE.test(blob), `${s.slug} uses agent-directed phrasing`);
    }
  }
});

test('slugs are unique within and across the theme packs, and carry real triggers', () => {
  const all = [...TESTING_PACK_SPECS, ...PERFORMANCE_PACK_SPECS];
  const slugs = all.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug across theme packs');
  for (const s of all) {
    assert.ok(s.keywords.length >= 3, `${s.slug} needs keywords to be findable`);
    assert.ok(s.lesson.length > 80, `${s.slug} lesson is too thin to be durable`);
  }
});

// --- 18.12 slopsquatting -------------------------------------------------------

test('the security pack carries the slopsquatting-defense lesson, chokepoint-clean', () => {
  const spec = PACK_SPECS.find((s) => s.slug === 'verify-a-package-exists-before-installing-it');
  assert.ok(spec, 'the slopsquatting lesson must ship in the security pack');
  assert.match(spec.lesson, /registry/i);
  const built = buildSecurityPack({ today: '2026-07-25' }).find((l) => l.slug === spec.slug);
  assert.equal(built.category, 'security');
  const res = validateLesson(serializeLessonFile(built));
  assert.ok(res.ok, `rejected: ${res.errors.map((e) => e.code).join(', ')}`);
  assert.equal(res.quarantine, false);
});
