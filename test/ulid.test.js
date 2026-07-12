import test from 'node:test';
import assert from 'node:assert/strict';
import { ulid, lessonId, evidenceId } from '../src/lib/ulid.js';

test('ulid is 26 chars of crockford base32', () => {
  const id = ulid();
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('ulid timestamps sort chronologically', () => {
  const a = ulid(1000000000000);
  const b = ulid(2000000000000);
  assert.ok(a.slice(0, 10) < b.slice(0, 10));
});

test('ids are unique across many generations', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(ulid());
  assert.equal(seen.size, 5000);
});

test('typed prefixes', () => {
  assert.match(lessonId(), /^les_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(evidenceId(), /^ev_[0-9A-HJKMNP-TV-Z]{26}$/);
});
