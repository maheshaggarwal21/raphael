// Curated frontend-design starter pack (Phase 20 / agent-architecture-final.md A4).
//
// Frontend design is the craft AI lags at most, and a brand-new brain knows nothing
// about it. This pack seeds the mistakes that make AI-built UI read as generic
// "slop", plus the accessibility floor and the token/copy discipline that separate
// shipped-quality work from a demo. It is distilled from two studied resources
// (docs/frontend-design-skills-audit.md): the ui-ux-pro-max deterministic design-rule
// tables (styles, anti-patterns, the accessibility/touch/performance "must haves")
// and Anthropic's own frontend-design judgment skill (the named AI-slop clusters,
// spend-boldness-in-one-place, copy-as-design-material). Attribution names below are
// NOT links or instructions.
//
// Same shape and same door as every other lesson: each entry goes through
// validateLesson() via writeCandidate(), lands as a reviewable CANDIDATE, is tagged
// category "design", carries NO URLs, and is written in declarative voice (a
// statement of cause + better choice, never a command at an agent — invariant #3).
//
// Taste-decay policy (agent-architecture-final.md §5): design lessons are taste
// conventions, not recurring bugs, so they ship at tier "curated" — which
// confidence.js floors at 6 and makes resist age-based decay, so they are never
// swept out by the never-fired-and-aged auto-retire. They retire only by an explicit
// human `raph retire`, exactly like a reversed convention should.

import { lessonId } from './ulid.js';

// severity here means "how badly getting this wrong hurts the result": critical =
// breaks usability/accessibility for real users; high = reads as templated/cheap;
// medium = polish. agents route the lesson to the frontend/design lenses.
export const DESIGN_PACK_SPECS = [
  {
    slug: 'avoid-the-ai-slop-visual-defaults',
    title: 'Avoid the generic looks AI-built UI clusters around',
    severity: 'high',
    based_on: 'Anthropic frontend-design',
    agents: ['frontend', 'design'],
    keywords: ['design', 'ui', 'slop', 'generic', 'landing', 'gradient', 'template', 'aesthetic'],
    lesson:
      'AI-generated interfaces cluster around a few tells regardless of the subject: a warm cream background with a high-contrast serif and a terracotta accent, a near-black background with one acid-green accent, plus excessive centered layouts, purple gradients, uniform rounded corners, and the Inter font by default. Where the brief pins a direction, follow it; where an axis is left free, a design that spends it on one of these defaults reads as templated rather than made for this product.',
    headline: 'Generic AI UI has named tells (cream+serif+terracotta, purple gradients, centered, Inter) — spend free choices on the subject, not the default.'
  },
  {
    slug: 'ground-the-design-in-the-subject',
    title: 'Derive the design from the actual product, not a generic template',
    severity: 'high',
    based_on: 'Anthropic frontend-design',
    agents: ['frontend', 'design'],
    keywords: ['design', 'brief', 'brand', 'identity', 'distinctive', 'hero'],
    lesson:
      'A distinctive interface comes from the subject\'s own world — its materials, vocabulary, and what makes it specific — not from a layout applied to every product. When the brief does not pin down the product, naming it, its audience, and the page\'s single job first is what turns a competent-but-generic result into one that could only belong to this product.',
    headline: 'Distinctive design comes from the product\'s own world — name the subject, audience, and one job before styling.'
  },
  {
    slug: 'spend-boldness-in-one-place',
    title: 'Give a design one signature element and keep the rest quiet',
    severity: 'medium',
    based_on: 'Anthropic frontend-design',
    agents: ['frontend', 'design'],
    keywords: ['design', 'signature', 'restraint', 'hierarchy', 'focal'],
    lesson:
      'A memorable interface has one signature element it is remembered by, with everything around it disciplined and quiet; decoration on every element competes with itself and reads as noise. Concentrating the boldness in one place and cutting anything that does not serve the brief is what makes a design feel intentional rather than busy.',
    headline: 'One signature element, everything else quiet — scattered boldness reads as noise.'
  },
  {
    slug: 'body-contrast-at-least-4-5-to-1',
    title: 'Keep text contrast at or above 4.5:1',
    severity: 'critical',
    based_on: 'ui-ux-pro-max (WCAG AA)',
    agents: ['frontend', 'design'],
    keywords: ['contrast', 'accessibility', 'wcag', 'color', 'text', 'gray'],
    lesson:
      'Body text below a 4.5:1 contrast ratio against its background is unreadable for many users and fails WCAG AA. Gray-on-gray and low-contrast "subtle" text is the common way this slips in; every text/background pair meeting 4.5:1 (3:1 for large text) keeps the interface usable.',
    headline: 'Body text under 4.5:1 contrast fails WCAG AA and loses real readers — check every text/background pair.'
  },
  {
    slug: 'touch-targets-at-least-44px',
    title: 'Make interactive targets at least 44x44px',
    severity: 'high',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['touch', 'target', 'mobile', 'button', 'tap', 'accessibility'],
    lesson:
      'Tap targets smaller than about 44x44px are hard to hit reliably on touch devices and cause mis-taps, especially when packed close together. Interactive controls sized to at least 44x44px with 8px or more of spacing between them stay usable on a phone.',
    headline: 'Touch targets under ~44x44px cause mis-taps on mobile — size and space them for a thumb.'
  },
  {
    slug: 'respect-prefers-reduced-motion',
    title: 'Honor prefers-reduced-motion',
    severity: 'high',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['motion', 'animation', 'reduced-motion', 'accessibility', 'vestibular'],
    lesson:
      'Animation that ignores the prefers-reduced-motion setting can trigger nausea or vestibular problems for users who asked the system to reduce motion. Gating non-essential motion behind that media query, and keeping essential transitions minimal, respects that request instead of overriding it.',
    headline: 'Motion that ignores prefers-reduced-motion harms some users — gate non-essential animation behind the query.'
  },
  {
    slug: 'keep-a-visible-keyboard-focus',
    title: 'Never remove the visible focus indicator',
    severity: 'critical',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['focus', 'keyboard', 'accessibility', 'outline', 'a11y', 'navigation'],
    lesson:
      'Removing focus outlines (a common "cleanup") leaves keyboard and screen-reader users unable to see where they are, making the interface unusable without a mouse. A clear, styled focus state on every interactive element — restyled if the default is ugly, never deleted — keeps keyboard navigation possible.',
    headline: 'Deleting focus outlines strands keyboard users — restyle the focus state, never remove it.'
  },
  {
    slug: 'reference-tokens-not-raw-hex',
    title: 'Reference design tokens, not raw hex, in components',
    severity: 'medium',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design', 'developer'],
    keywords: ['token', 'hex', 'color', 'css variable', 'theme', 'dark mode'],
    lesson:
      'Hardcoded hex colors scattered through components make a palette change or a dark-mode variant a find-and-replace across the codebase, and they drift out of sync. Components that reference semantic tokens (CSS variables like --color-primary) instead of raw hex keep the palette in one place and make theming a single edit.',
    headline: 'Raw hex in components blocks theming and drifts — reference semantic tokens (CSS variables) instead.'
  },
  {
    slug: 'three-layer-token-architecture',
    title: 'Structure tokens as primitive to semantic to component',
    severity: 'low',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['token', 'design system', 'primitive', 'semantic', 'architecture', 'scale'],
    lesson:
      'A flat token list ties raw values directly to components, so a rebrand touches everything. A three-layer structure — primitive raw values, semantic aliases by purpose (--color-primary), then component tokens (--button-bg) referencing the semantic layer — lets a theme switch or rebrand change one layer and cascade cleanly.',
    headline: 'Three token layers (primitive to semantic to component) make a rebrand one edit, not a sweep.'
  },
  {
    slug: 'copy-is-design-material',
    title: 'Write interface copy as design material, active-voice and consistent',
    severity: 'medium',
    based_on: 'Anthropic frontend-design',
    agents: ['frontend', 'design'],
    keywords: ['copy', 'microcopy', 'label', 'button', 'ux writing', 'voice'],
    lesson:
      'Generic copy makes a design feel as templated as a generic layout. Controls that say exactly what happens in active voice ("Save changes", not "Submit"), an action that keeps the same name through the whole flow (a "Publish" button producing a "Published" toast), and naming things by what the user controls rather than how the system is built are what let people navigate an interface confidently.',
    headline: 'Copy is design material — active-voice controls, consistent action names, user-facing not system-facing terms.'
  },
  {
    slug: 'design-every-empty-loading-error-state',
    title: 'Design the empty, loading, and error states, not just the happy path',
    severity: 'high',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['empty state', 'loading', 'error', 'skeleton', 'states', 'edge case'],
    lesson:
      'A screen designed only for the full, successful case looks broken the moment it has zero results, is still loading, or hits an error. An empty state that invites the next action, a loading state that reserves space to avoid layout shift, and an error that explains what went wrong and how to fix it are part of the design, not afterthoughts.',
    headline: 'Zero-results, loading, and error states are part of the design — an unhandled one looks broken.'
  },
  {
    slug: 'reserve-space-to-avoid-layout-shift',
    title: 'Reserve space for async content to avoid layout shift',
    severity: 'medium',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design', 'developer'],
    keywords: ['cls', 'layout shift', 'image', 'performance', 'skeleton', 'dimensions'],
    lesson:
      'Content that loads without reserved space (images without dimensions, late-arriving data) shoves the layout around as it arrives, causing mis-clicks and a janky feel measured as Cumulative Layout Shift. Setting explicit dimensions or a skeleton placeholder for anything that loads asynchronously keeps the layout stable.',
    headline: 'Async content without reserved space shifts the layout (CLS) — set dimensions or a skeleton.'
  },
  {
    slug: 'pair-type-deliberately-not-inter-by-default',
    title: 'Pair display and body typefaces deliberately',
    severity: 'medium',
    based_on: 'Anthropic frontend-design',
    agents: ['frontend', 'design'],
    keywords: ['typography', 'font', 'type', 'pairing', 'inter', 'display'],
    lesson:
      'Typography carries the personality of a page, so reaching for the same default sans (Inter) on every project makes each one feel interchangeable. A deliberate pairing — a characterful display face used with restraint plus a complementary body face, on an intentional type scale — makes the type treatment itself a memorable part of the design.',
    headline: 'Default Inter everywhere makes pages interchangeable — pair a characterful display face with a body face deliberately.'
  },
  {
    slug: 'mobile-first-no-horizontal-scroll',
    title: 'Design mobile-first and never force horizontal scroll or block zoom',
    severity: 'high',
    based_on: 'ui-ux-pro-max',
    agents: ['frontend', 'design'],
    keywords: ['responsive', 'mobile', 'breakpoint', 'horizontal scroll', 'viewport', 'zoom'],
    lesson:
      'Fixed-pixel widths and desktop-first layouts break on phones with horizontal scrolling and content that overflows the viewport, and disabling zoom removes an accessibility escape hatch. Mobile-first breakpoints, fluid widths, and leaving pinch-zoom enabled keep the interface usable across screen sizes.',
    headline: 'Fixed-px desktop-first layouts break on phones — go mobile-first, no horizontal scroll, never disable zoom.'
  }
];

// Expand a spec into a full valid lesson (category "design", tier "curated",
// status "candidate"). Mirrors security-pack's packLesson but for design.
export function packDesignLesson(spec, { today = '(undated)', id = null } = {}) {
  const headline = spec.headline;
  return {
    schema: 'raphael/lesson/v1',
    id: id ?? lessonId(),
    slug: spec.slug,
    title: spec.title,
    status: 'candidate',
    category: 'design',
    severity: spec.severity,
    scope: {
      stacks: spec.stacks ?? [],
      task_kinds: spec.task_kinds ?? [],
      projects: [],
      agents: spec.agents ?? ['frontend', 'design']
    },
    triggers: { keywords: spec.keywords ?? [], paths: spec.paths ?? [] },
    lesson: spec.lesson,
    evidence: {
      refs: [],
      observations: 0,
      distinct_projects: 0,
      first_seen: today,
      last_seen: today
    },
    provenance: {
      created_by: `raphael/design-pack (based on ${spec.based_on})`,
      source_kind: 'imported',
      human_edited: false,
      tier: 'curated'
    },
    injection: {
      headline,
      tokens: Math.min(60, Math.max(1, Math.ceil(headline.length / 4)))
    }
  };
}

// The whole pack as ready-to-write lesson objects.
export function buildDesignPack(opts = {}) {
  return DESIGN_PACK_SPECS.map((spec) => packDesignLesson(spec, opts));
}
