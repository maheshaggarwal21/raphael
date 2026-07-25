import test from 'node:test';
import assert from 'node:assert/strict';
import { trigrams, jaccard, similarity, contentWords, wordOverlap, nearDuplicates, DUP_WORD_THRESHOLD } from '../src/lib/similarity.js';

test('identical texts score 1', () => {
  assert.equal(similarity('webhook handlers must dedupe', 'webhook handlers must dedupe'), 1);
});

test('unrelated texts score near 0', () => {
  assert.ok(similarity('webhook handlers must dedupe on event id', 'css grid layouts break in safari') < 0.1);
});

test('near-duplicates score high despite small edits', () => {
  const a = 'Payment webhook handlers without event-id dedup produce duplicate charges.';
  const b = 'Payment webhook handlers without event id dedup can produce duplicated charges.';
  assert.ok(similarity(a, b) > 0.6);
});

test('normalization ignores case and punctuation', () => {
  assert.equal(similarity('Hello, World!', 'hello world'), 1);
});

test('empty and tiny inputs behave sanely', () => {
  assert.equal(jaccard(trigrams(''), trigrams('')), 1);
  assert.equal(similarity('', 'something long enough here'), 0);
  assert.equal(similarity('ab', 'ab'), 1);
});

// --- near-duplicate shortlisting (approve-time gate) --------------------------

test('contentWords strips stopwords, short tokens, and punctuation', () => {
  const w = contentWords('The engines.node floor is a minimum, not a pin!');
  assert.ok(w.has('engines.node'), 'keeps a dotted identifier intact');
  assert.ok(w.has('minimum') && w.has('floor') && w.has('pin'));
  for (const stop of ['the', 'is', 'a', 'not']) assert.ok(!w.has(stop), `stopword leaked: ${stop}`);
});

test('wordOverlap scores a re-worded duplicate above an unrelated pair', () => {
  // the real pair that slipped past the trigram dedupe and had to be retired by hand
  const kept = 'Treat an engines.node floor as a minimum, not a pin. A package.json engines.node range like >=18 is a minimum floor, not a pin: it still allows current Node, so an end-of-life floor is a nudge, not a hard failure. Only a pinned range is stuck on an EOL major.';
  const dup = 'Open floor version constraint treated as hard EOL pin. A version constraint like engines.node >=18 declares a minimum floor, not a pinned release. Flagging >=18 as a failure because 18 is EOL overlooks that the constraint allows supported versions above 18.';
  const unrelated = 'Hash passwords with a slow KDF. A fast general-purpose hash lets an attacker brute-force a stolen table quickly; a slow key-derivation function with a work factor makes offline cracking impractical.';

  const dupScore = wordOverlap(kept, dup);
  const unrelatedScore = wordOverlap(kept, unrelated);
  assert.ok(dupScore > unrelatedScore, `duplicate (${dupScore}) should outscore unrelated (${unrelatedScore})`);
  assert.ok(dupScore >= DUP_WORD_THRESHOLD, `duplicate ${dupScore} should clear the shortlist threshold`);
  // and the trigram signal alone would NOT have caught it — that is why this exists
  assert.ok(similarity(kept, dup) < 0.6, 'trigram similarity stays under the hard-dedupe threshold');
});

test('nearDuplicates ranks hits, reports which signal fired, and respects the limit', () => {
  const corpus = [
    { slug: 'kdf', text: 'Hash passwords with a slow KDF so offline cracking is impractical.' },
    { slug: 'floor', text: 'Treat an engines.node floor as a minimum, not a pin: >=18 still allows current Node, so an EOL floor is a nudge and not a hard failure.' }
  ];
  const hits = nearDuplicates('Open floor version constraint treated as hard EOL pin: engines.node >=18 declares a minimum floor, not a pinned release, so an EOL floor is not a failure.', corpus);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].slug, 'floor');
  assert.ok(['topic-words', 'wording'].includes(hits[0].signal));
  assert.ok(hits[0].score >= DUP_WORD_THRESHOLD);
  assert.equal(nearDuplicates('x', corpus, { limit: 0 }).length, 0);
});

test('nearDuplicates stays quiet on an empty corpus and on genuinely distinct lessons (no false alarm)', () => {
  assert.deepEqual(nearDuplicates('anything at all', []), []);
  assert.deepEqual(nearDuplicates('anything at all', undefined), []);
  const corpus = [{ slug: 'kdf', text: 'Hash passwords with a slow key-derivation function so offline cracking is impractical.' }];
  assert.deepEqual(nearDuplicates('Reserve space for async images so the layout does not shift as content arrives.', corpus), []);
});
