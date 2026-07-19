import test from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_PACK_SPECS, packDesignLesson, buildDesignPack } from '../src/lib/design-pack.js';
import { validateLesson } from '../src/lib/validate.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';

// The design pack enters the brain through the SAME chokepoint as everything else.
test('every design-pack lesson passes the chokepoint unquarantined', () => {
  for (const spec of DESIGN_PACK_SPECS) {
    const data = packDesignLesson(spec, { today: '2026-07-20' });
    const res = validateLesson(serializeLessonFile(data));
    assert.ok(res.ok, `${spec.slug} rejected: ${res.errors.map((e) => `${e.code}:${e.msg}`).join('; ')}`);
    assert.equal(res.quarantine, false, `${spec.slug} was quarantined: ${res.warnings.map((w) => w.code).join(', ')}`);
  }
});

test('the pack is all design-category curated candidates, never auto-active', () => {
  for (const data of buildDesignPack({ today: '2026-07-20' })) {
    assert.equal(data.category, 'design');
    assert.equal(data.status, 'candidate');
    // curated tier is the taste-decay policy: confidence.js floors it at 6 and
    // makes it resist age-based auto-retire (design lessons are conventions, not bugs).
    assert.equal(data.provenance.tier, 'curated');
    assert.notEqual(data.provenance.tier, 'auto');
  }
});

test('no design-pack lesson carries a URL (invariant #3)', () => {
  const URL_RE = /(?:[a-z][a-z0-9+.-]*):\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
  for (const spec of DESIGN_PACK_SPECS) {
    const blob = [spec.title, spec.lesson, spec.headline, spec.based_on].join('\n');
    assert.ok(!URL_RE.test(blob), `${spec.slug} contains a URL`);
  }
});

test('every design-pack lesson speaks in declarative voice (no "you must/should")', () => {
  const IMPERATIVE_RE = /\byou (?:must|should|need to|have to|shall)\b/i;
  for (const spec of DESIGN_PACK_SPECS) {
    const risky = [spec.title, spec.lesson, spec.headline].join('\n');
    assert.ok(!IMPERATIVE_RE.test(risky), `${spec.slug} uses agent-directed phrasing`);
  }
});

test('slugs are unique and every lesson has real triggers + attribution', () => {
  const slugs = DESIGN_PACK_SPECS.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in the pack');
  for (const spec of DESIGN_PACK_SPECS) {
    assert.ok(Array.isArray(spec.keywords) && spec.keywords.length >= 3, `${spec.slug} needs keywords to be findable`);
    assert.ok(spec.based_on, `${spec.slug} missing attribution`);
  }
});

test('the pack covers both the knowledge (ui-ux-pro-max) and judgment (Anthropic) sources, and the a11y floor', () => {
  const sources = DESIGN_PACK_SPECS.map((s) => s.based_on).join(' ');
  assert.match(sources, /ui-ux-pro-max/, 'missing the deterministic-knowledge source');
  assert.match(sources, /Anthropic/, 'missing the judgment/taste source');
  assert.ok(DESIGN_PACK_SPECS.length >= 12, 'a design starter pack should be substantial');
  // the checkable accessibility floor must be represented (these gate the eval later)
  const slugs = new Set(DESIGN_PACK_SPECS.map((s) => s.slug));
  for (const need of ['body-contrast-at-least-4-5-to-1', 'keep-a-visible-keyboard-focus', 'respect-prefers-reduced-motion', 'reference-tokens-not-raw-hex']) {
    assert.ok(slugs.has(need), `pack missing the floor lesson: ${need}`);
  }
});

test('pack lessons route to the frontend and design agents', () => {
  for (const data of buildDesignPack({ today: '2026-07-20' })) {
    const routed = data.scope.agents;
    assert.ok(routed.includes('frontend') || routed.includes('design'), `${data.slug} not routed to a design agent`);
  }
});
