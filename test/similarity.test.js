import test from 'node:test';
import assert from 'node:assert/strict';
import { trigrams, jaccard, similarity } from '../src/lib/similarity.js';

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
