// 18.9 — theme packs beyond security and design.
//
// Same shape and same door as every other pack: each spec is expanded into a full
// lesson and goes through validateLesson() via writeCandidate(), landing as a
// reviewable CANDIDATE at tier "curated". No URLs, declarative voice (a statement
// of cause and better choice, never an order aimed at an agent — invariant #3).
//
// These two were picked because they are the failure classes that cost the most
// rework and are least likely to be already in a fresh brain: tests that pass
// without proving anything, and performance work done by guess instead of measure.

import { lessonId } from './ulid.js';

export const TESTING_PACK_SPECS = [
  {
    slug: 'a-regression-test-must-fail-without-the-fix',
    title: 'A regression test has to fail before the fix to prove anything',
    severity: 'high',
    keywords: ['test', 'regression', 'bug fix', 'coverage', 'tdd'],
    lesson:
      'A regression test written after a fix and never seen failing proves only that the code runs; it can assert the wrong thing entirely and still pass forever. Running it once against the unfixed code, watching it fail, then applying the fix is what demonstrates the test actually pins the behaviour that broke.',
    headline: 'A regression test never seen failing proves nothing — watch it fail first, then fix.'
  },
  {
    slug: 'assert-the-behaviour-not-that-it-merely-ran',
    title: 'Assert what the code did, not that it produced something',
    severity: 'medium',
    keywords: ['test', 'assertion', 'smoke test', 'toBeDefined', 'quality'],
    lesson:
      'Assertions like "is defined", "did not throw", or "renders" pass for almost any implementation, including a broken one, so they buy coverage numbers without buying confidence. An assertion naming the expected value or observable effect is what actually fails when the behaviour regresses.',
    headline: 'Existence assertions pass for broken code too — assert the expected value or effect.'
  },
  {
    slug: 'test-the-failure-path-not-only-the-happy-one',
    title: 'Cover the error path, not only the happy path',
    severity: 'high',
    keywords: ['test', 'error handling', 'edge case', 'failure', 'coverage'],
    lesson:
      'Error branches are where most production incidents live and where tests are thinnest, because the happy path is the one that was in mind while writing. Every guard clause, catch, and early return that a test never exercises is a branch shipping unverified.',
    headline: 'Untested error branches are where incidents live — cover the failure path, not just the happy one.'
  },
  {
    slug: 'a-test-that-depends-on-clock-or-order-is-flaky',
    title: 'Tests that depend on time, order, or the network are flaky by construction',
    severity: 'medium',
    keywords: ['flaky', 'test', 'timing', 'sleep', 'ordering', 'isolation'],
    lesson:
      'A test relying on real sleeps, wall-clock time, iteration order of an unordered collection, or a live network call fails intermittently for reasons unrelated to the code, and a suite that cries wolf stops being read. Injecting the clock, seeding randomness, sorting before comparing, and stubbing the network make a failure mean something.',
    headline: 'Real clocks, ordering assumptions, and live network calls make tests cry wolf — inject and stub them.'
  },
  {
    slug: 'fixtures-must-not-restate-the-implementation',
    title: 'Derive test fixtures from real samples, not from assumptions',
    severity: 'high',
    keywords: ['fixture', 'mock', 'schema', 'api', 'contract', 'test data'],
    lesson:
      'A fixture hand-written from an assumed response shape encodes the same misunderstanding as the parser it is testing, so both agree and both are wrong the moment real data arrives. Fixtures captured from an actual response or a published schema are what expose an envelope mismatch before production does.',
    headline: 'A fixture invented from assumptions confirms the same mistake as the parser — capture real samples.'
  }
];

export const PERFORMANCE_PACK_SPECS = [
  {
    slug: 'measure-before-optimising-anything',
    title: 'Measure before optimising',
    severity: 'high',
    keywords: ['performance', 'profiling', 'optimisation', 'benchmark', 'slow'],
    lesson:
      'Intuition about which line is slow is wrong often enough that optimisation work chosen by guess usually complicates the code without moving the number. A profile or timing measurement identifying the actual hot path is what separates a change that helps from one that only looks industrious.',
    headline: 'Guessed hot spots are usually wrong — profile first, then optimise what the measurement names.'
  },
  {
    slug: 'a-query-inside-a-loop-is-an-n-plus-one',
    title: 'Queries inside a loop become N+1 under real data',
    severity: 'high',
    keywords: ['n+1', 'database', 'query', 'orm', 'loop', 'performance'],
    lesson:
      'A query issued per iteration looks harmless against ten seed rows and collapses against ten thousand real ones, because the cost grows with the data rather than the code. Fetching the set in one query, or eager-loading the association, keeps the cost flat as the table grows.',
    headline: 'A query per loop iteration is fine on seed data and fatal on real data — batch or eager-load it.'
  },
  {
    slug: 'unbounded-result-sets-fail-at-scale',
    title: 'Unbounded list endpoints fail as the table grows',
    severity: 'high',
    keywords: ['pagination', 'limit', 'unbounded', 'memory', 'api', 'list'],
    lesson:
      'An endpoint or query with no limit returns whatever the table holds, so it passes every test at small scale and exhausts memory or times out once the data is real. A required limit with pagination bounds the cost regardless of how much data accumulates.',
    headline: 'A query with no LIMIT grows until it breaks — bound and paginate list results.'
  },
  {
    slug: 'cache-invalidation-needs-a-stated-rule',
    title: 'A cache without a stated invalidation rule serves stale data',
    severity: 'medium',
    keywords: ['cache', 'invalidation', 'ttl', 'stale', 'consistency'],
    lesson:
      'A cache added for speed without deciding when entries expire or are evicted eventually serves data that contradicts the source of truth, and the resulting bug looks like a logic error rather than a caching one. Writing down the expiry or invalidation trigger alongside the cache is what keeps the staleness bounded and debuggable.',
    headline: 'A cache with no invalidation rule serves contradictions that read as logic bugs — state the expiry.'
  },
  {
    slug: 'blocking-work-on-the-request-path-costs-every-user',
    title: 'Slow work on the request path is paid by every caller',
    severity: 'medium',
    keywords: ['async', 'blocking', 'latency', 'queue', 'background', 'request'],
    lesson:
      'Sending an email, resizing an image, or calling a third party inline makes every request wait for the slowest dependency and couples request success to that dependency being up. Moving work that the caller does not need the result of onto a queue keeps the response fast and the failure isolated.',
    headline: 'Inline non-essential work makes every caller wait on the slowest dependency — queue it.'
  }
];

// Expand a spec into a full valid lesson for a given theme.
export function packThemeLesson(spec, theme, { today = '(undated)', id = null } = {}) {
  const headline = spec.headline;
  return {
    schema: 'raphael/lesson/v1',
    id: id ?? lessonId(),
    slug: spec.slug,
    title: spec.title,
    status: 'candidate',
    category: theme.category,
    severity: spec.severity,
    scope: {
      stacks: spec.stacks ?? [],
      task_kinds: spec.task_kinds ?? [],
      projects: [],
      agents: spec.agents ?? theme.agents
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
      created_by: `raphael/${theme.name}-pack`,
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

const TESTING_THEME = { name: 'testing', category: 'process', agents: ['developer', 'reviewer', 'debugger'] };
const PERFORMANCE_THEME = { name: 'performance', category: 'performance', agents: ['developer', 'reviewer', 'architect'] };

export function buildTestingPack(opts = {}) {
  return TESTING_PACK_SPECS.map((s) => packThemeLesson(s, TESTING_THEME, opts));
}

export function buildPerformancePack(opts = {}) {
  return PERFORMANCE_PACK_SPECS.map((s) => packThemeLesson(s, PERFORMANCE_THEME, opts));
}
