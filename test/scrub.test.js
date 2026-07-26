import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, isHighEntropyToken, SECRET_RULES } from '../src/lib/scrub.js';
import { lessonId, evidenceId, adoptionId, decisionId, ID_PREFIXES } from '../src/lib/ulid.js';

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

test('catches underscore-fenced env-var secrets (DB_PASSWORD, SESSION_SECRET, AUTH_TOKEN)', () => {
  // `\b` treats `_` as a word char and used to miss these — the most common .env leak.
  for (const line of [
    'DB_PASSWORD=hunter2superlongpassword',
    'SESSION_SECRET=abcdefgh12345678',
    'AUTH_TOKEN=deadbeefdeadbeef1234',
    'REDIS_PASSWORD = "someLongRedisPass1"'
  ]) {
    const { text, found } = scrubSecrets(line);
    assert.ok(found.includes('kv-secret'), `should flag: ${line}`);
    assert.ok(text.includes('<SECRET:kv-secret>'), `should scrub: ${line}`);
  }
});

test('kv-secret does not false-positive on ordinary env-var assignments', () => {
  // No secret keyword as a boundary-delimited segment -> must NOT flag.
  for (const line of [
    'DATABASE_HOST=localhost',
    'MAX_RETRIES=10',
    'PUBLIC_BASE_PATH=/static/assets',
    'NODE_ENV=production'
  ]) {
    const { found } = scrubSecrets(line);
    assert.ok(!found.includes('kv-secret'), `should NOT flag: ${line}`);
  }
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

// ---- 21.9: measured recall gaps + false positives (audit 2026-07-26) --------

test('kv-secret catches COMPOUND env names and quoted multi-word values', () => {
  // These four all returned found=[] before the fix — verified by probe, not assumed.
  for (const s of [
    'DJANGO_SECRET_KEY=iloveyoumydearwatsonandmore',
    'SECRET_KEY_BASE=correcthorsebatterystaplecorrect',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'password: "correct horse battery staple9"',
    "api_token_v2: 'abcdefghijklmnop'"
  ]) {
    const r = scrubSecrets(s);
    assert.ok(r.found.length > 0, `must flag: ${s}`);
    assert.equal(/iloveyou|correcthorse|wJalrX|correct horse|abcdefghij/.test(r.text), false, `must not leak the value of: ${s}`);
  }
  // and the cases that already worked keep working
  assert.ok(scrubSecrets('DB_PASSWORD=hunter2hunter2').found.includes('kv-secret'));
  assert.ok(scrubSecrets('api_key: sk-abcdefghijklmnop').found.includes('kv-secret'));
});

test('kv-secret does NOT fire on prose that merely mentions secrets', () => {
  for (const s of [
    'This lesson is about secret management in general',
    'a secret_key is needed for the handshake',
    'Rotate the api key regularly',
    'password requirements should be documented'
  ]) {
    assert.deepEqual(scrubSecrets(s).found, [], `must stay clean: ${s}`);
  }
});

test('bearer requires credential shape, so security PROSE is not rejected', () => {
  // was flagged 'bearer' before the fix, and E-SECRET then hard-rejected the
  // lesson — in the security category, the flagship pack.
  assert.deepEqual(scrubSecrets('the Bearer authorization-header must be validated').found, []);
  assert.deepEqual(scrubSecrets('Bearer tokens should never be logged in plaintext').found, []);
  // a real token still goes
  assert.ok(scrubSecrets('Authorization: Bearer eyJhbGci0OiJSUzI1NiIsInR5cCI6IkpXVCJ9').found.includes('bearer'));
  assert.ok(scrubSecrets('Bearer a1b2c3d4e5f6g7h8i9j0').found.includes('bearer'));
});

test('every Raphael id prefix is exempt from the entropy scan, derived from ulid.js', () => {
  // dec_ was minted from 16.8 but missing from scrub's hand-copied list, so
  // decision ids were mangled to <SECRET:high-entropy> and cross-references died.
  const makers = { les: lessonId, ev: evidenceId, adp: adoptionId, dec: decisionId };
  for (const [prefix, make] of Object.entries(makers)) {
    const id = make();
    assert.equal(isHighEntropyToken(id), false, `${prefix}_ ids must be exempt`);
    assert.equal(scrubSecrets(`superseded by ${id} in the ledger`).text.includes(id), true, `${id} must survive scrubbing`);
  }
  // the list itself covers every prefix the module mints
  for (const prefix of ID_PREFIXES) {
    assert.equal(isHighEntropyToken(`${prefix}_01JGXW5T9Q8ZK3M4N5P6R7S8T9`), false, `${prefix}_ must be exempt`);
  }
});

test('SECRET_RULES is table-driven: every named rule has a positive and a negative case', () => {
  // A table keyed off the rule list itself, so adding a rule without fixtures FAILS.
  const fixtures = {
    'private-key': ['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----', 'a private key should live in a secrets manager'],
    'aws-key': ['AKIAIOSFODNN7EXAMPLE', 'the AKIA prefix identifies an access key'],
    'github-token': ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'rotate your github token'],
    'github-pat': ['github_pat_11ABCDEFG0abcdefghijklmnop', 'a github pat is a credential'],
    'stripe-key': ['sk_live_abcdefghijklmnopqrst', 'use the stripe test mode key locally'],
    'slack-token': ['xoxb-1234567890-abcdefghijkl', 'slack tokens belong in the vault'],
    jwt: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMzQ1Njc4OTB9.SflKxwRJSMeKKF2QT4fwpM', 'a jwt has three dot-separated parts'],
    'url-credentials': ['postgres://user:hunter2@db.example.com/app', 'never put credentials in a connection url'],
    bearer: ['Bearer a1b2c3d4e5f6g7h8i9j0', 'Bearer tokens must be validated'],
    'kv-secret': ['SESSION_SECRET=s3cretvalue123', 'session secret handling is documented']
  };

  assert.equal(SECRET_RULES.length, Object.keys(fixtures).length, 'a new rule needs fixtures here');
  for (const [name] of SECRET_RULES) {
    const pair = fixtures[name];
    assert.ok(pair, `rule "${name}" has no fixtures — add a positive and a negative case`);
    const [positive, negative] = pair;
    assert.ok(scrubSecrets(positive).found.includes(name), `rule "${name}" must flag its positive fixture`);
    assert.deepEqual(scrubSecrets(negative).found, [], `rule "${name}" must not flag: ${negative}`);
  }
});

test('isHighEntropyToken: length, charset, placeholder and bracket edges', () => {
  assert.equal(isHighEntropyToken('short1a'), false, 'under the length floor');
  assert.equal(isHighEntropyToken('allletterswithoutanydigits'), false, 'letters only');
  assert.equal(isHighEntropyToken('12345678901234567890123'), false, 'digits only');
  assert.equal(isHighEntropyToken('<SECRET:high-entropy>'), false, 'never re-flag a placeholder');
  assert.equal(isHighEntropyToken('aB3xY9zQ7wE2rT5yU8iO1p'), true, 'mixed high-entropy token');
  // brackets/quotes are stripped before the id check
  assert.equal(isHighEntropyToken('(les_01JGXW5T9Q8ZK3M4N5P6R7S8T9)'), false);
});

test('scrubSecrets is idempotent: scrubbing twice changes nothing further', () => {
  const once = scrubSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY').text;
  const twice = scrubSecrets(once);
  assert.equal(twice.text, once, 'placeholders must not re-trigger any rule');
  assert.deepEqual(twice.found, []);
});
