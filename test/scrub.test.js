import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets } from '../src/lib/scrub.js';

test('catches AWS access keys', () => {
  const { text, found } = scrubSecrets('config used AKIAIOSFODNN7EXAMPLE for uploads');
  assert.ok(text.includes('<SECRET:aws-key>'));
  assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(found.includes('aws-key'));
});

test('catches GitHub tokens', () => {
  const { text } = scrubSecrets('export GH=ghp_abcdefghijklmnopqrst123456');
  assert.ok(text.includes('<SECRET:'));
  assert.ok(!text.includes('ghp_abcdefghijklmnopqrst123456'));
});

test('catches key=value style secrets', () => {
  const { text } = scrubSecrets('set API_KEY=supersecretvalue123 in the env');
  assert.ok(text.includes('<SECRET:kv-secret>'));
  assert.ok(!text.includes('supersecretvalue123'));
});

test('catches private key blocks', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
  const { text } = scrubSecrets(`found this in the repo:\n${pem}`);
  assert.ok(text.includes('<SECRET:private-key>'));
  assert.ok(!text.includes('MIIEowIBAAKCAQEA'));
});

test('catches high-entropy blobs', () => {
  const { text } = scrubSecrets('token was Zx9kQ2mP8vR4tY7wN3jH6bL1cF5dG0aS see logs');
  assert.ok(text.includes('<SECRET:high-entropy>'));
});

test('leaves ordinary prose alone', () => {
  const input =
    'Committing environment files leaks credentials permanently via git history; add ignore rules before the first commit. Internationalization is complicated.';
  const { text, found } = scrubSecrets(input);
  assert.equal(text, input);
  assert.equal(found.length, 0);
});
