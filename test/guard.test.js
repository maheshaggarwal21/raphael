import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  scanText, scanFile, HOOK_MARKER,
  installPreCommitHook, uninstallPreCommitHook,
  scanStaged, listStagedFiles
} from '../src/lib/guard.js';

function tmp(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo() {
  const dir = tmp('raph-guard-git-');
  const init = spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, 'git init should succeed');
  return dir;
}

// --- scanText -----------------------------------------------------------------

test('scanText flags an AWS key with its line number', () => {
  const text = 'line one\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\nline three';
  const hits = scanText(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].type, 'aws-key');
});

test('scanText locates a multi-line private key at its BEGIN line', () => {
  const text = 'header\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n';
  const hits = scanText(text);
  assert.ok(hits.some((h) => h.type === 'private-key' && h.line === 3));
});

test('scanText flags key=value secrets and github tokens', () => {
  const kv = scanText('const password = "supersecret12345"');
  assert.ok(kv.some((h) => h.type === 'kv-secret'));
  const gh = scanText('token: ghp_abcdefghijklmnopqrst123456');
  assert.ok(gh.some((h) => h.type === 'github-token'));
});

test('scanText leaves ordinary source alone', () => {
  const clean = 'function add(a, b) {\n  return a + b; // trivial\n}\n';
  assert.deepEqual(scanText(clean), []);
});

test('entropy pass is opt-in (off by default, on with {entropy:true})', () => {
  const text = 'const blob = "Zx9kQ2mP8vR4tY7wN3jH6bL1cF5dG0aS"';
  // The kv-like assignment has no api/secret keyword, so default scan is clean...
  const off = scanText(text);
  assert.ok(!off.some((h) => h.type === 'high-entropy'));
  const on = scanText(text, { entropy: true });
  assert.ok(on.some((h) => h.type === 'high-entropy'));
});

// --- scanFile -----------------------------------------------------------------

test('scanFile reads a file and reports findings; missing file is clean', () => {
  const dir = tmp('raph-guard-file-');
  try {
    const f = path.join(dir, 'secrets.env');
    writeFileSync(f, 'API_KEY=deadbeefdeadbeef1234\n');
    assert.ok(scanFile(f).some((h) => h.type === 'kv-secret'));
    assert.deepEqual(scanFile(path.join(dir, 'nope.txt')), []); // fail-open
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- hook install / uninstall -------------------------------------------------

test('installPreCommitHook writes an executable raphael hook', () => {
  const dir = gitRepo();
  try {
    const res = installPreCommitHook(dir);
    assert.equal(res.ok, true);
    assert.ok(existsSync(res.hookPath));
    const body = readFileSync(res.hookPath, 'utf8');
    assert.ok(body.includes(HOOK_MARKER));
    assert.ok(body.includes('guard scan --staged'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install refuses to clobber a foreign pre-commit hook unless --force', () => {
  const dir = gitRepo();
  try {
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    mkdirSync(path.dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho custom\n');
    const blocked = installPreCommitHook(dir);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'foreign-hook');
    assert.ok(readFileSync(hookPath, 'utf8').includes('echo custom')); // untouched
    const forced = installPreCommitHook(dir, { force: true });
    assert.equal(forced.ok, true);
    assert.ok(readFileSync(hookPath, 'utf8').includes(HOOK_MARKER));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uninstall removes only a raphael hook, never a foreign one', () => {
  const dir = gitRepo();
  try {
    installPreCommitHook(dir);
    const rm = uninstallPreCommitHook(dir);
    assert.equal(rm.ok, true);
    assert.equal(rm.removed, true);
    assert.ok(!existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')));

    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho custom\n');
    const refuse = uninstallPreCommitHook(dir);
    assert.equal(refuse.ok, false);
    assert.equal(refuse.reason, 'foreign-hook');
    assert.ok(existsSync(hookPath)); // left in place
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install/uninstall on a non-git directory reports not-a-git-repo', () => {
  const dir = tmp('raph-guard-nogit-');
  try {
    assert.equal(installPreCommitHook(dir).reason, 'not-a-git-repo');
    assert.equal(uninstallPreCommitHook(dir).reason, 'not-a-git-repo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- staged scanning (the hook's real job) ------------------------------------

test('scanStaged flags a staged secret and passes clean staged files', () => {
  const dir = gitRepo();
  try {
    writeFileSync(path.join(dir, 'app.js'), 'const KEY = "AKIAIOSFODNN7EXAMPLE";\n');
    writeFileSync(path.join(dir, 'ok.js'), 'export const sum = (a, b) => a + b;\n');
    spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });

    assert.deepEqual(listStagedFiles(dir).sort(), ['app.js', 'ok.js']);
    const results = scanStaged(dir);
    assert.equal(results.length, 1);
    assert.equal(results[0].file, 'app.js');
    assert.ok(results[0].findings.some((f) => f.type === 'aws-key'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanStaged is clean when nothing secret is staged', () => {
  const dir = gitRepo();
  try {
    writeFileSync(path.join(dir, 'readme.md'), '# hello\njust docs, no secrets here\n');
    spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual(scanStaged(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
