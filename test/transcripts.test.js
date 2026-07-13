import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizeCwd,
  projectTranscriptDir,
  listSessionFiles,
  contentHash
} from '../src/lib/transcripts.js';

function withTmpDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-tr-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('sanitizeCwd replaces every non-alphanumeric char with -', () => {
  assert.equal(
    sanitizeCwd('C:\\Users\\Mahesh\\Desktop\\Projects\\raphael'),
    'C--Users-Mahesh-Desktop-Projects-raphael'
  );
  assert.equal(sanitizeCwd('/home/user/projects/raphael'), '-home-user-projects-raphael');
  assert.equal(sanitizeCwd('C:\\my app (v2)'), 'C--my-app--v2-');
  assert.equal(sanitizeCwd('a_b.c~d'), 'a-b-c-d');
  assert.equal(sanitizeCwd(''), '');
});

test('projectTranscriptDir finds exact match', () => {
  withTmpDir((dir) => {
    const projects = path.join(dir, 'projects');
    const exact = path.join(projects, 'C--Users-Foo-proj');
    mkdirSync(exact, { recursive: true });
    assert.equal(projectTranscriptDir('C:\\Users\\Foo\\proj', projects), exact);
  });
});

test('projectTranscriptDir falls back to case-insensitive scan (drive-letter drift)', () => {
  withTmpDir((dir) => {
    const projects = path.join(dir, 'projects');
    // lowercase drive letter variant on disk
    const variant = path.join(projects, 'c--Users-Foo-proj');
    mkdirSync(variant, { recursive: true });
    const found = projectTranscriptDir('C:\\Users\\Foo\\proj', projects);
    // On case-insensitive filesystems the exact-path check may hit the variant
    // directly; either way the returned dir must be the variant on disk.
    assert.ok(found !== null);
    assert.equal(found.toLowerCase(), variant.toLowerCase());
  });
});

test('projectTranscriptDir returns null when no dir matches', () => {
  withTmpDir((dir) => {
    const projects = path.join(dir, 'projects');
    mkdirSync(path.join(projects, 'C--some-other-project'), { recursive: true });
    assert.equal(projectTranscriptDir('C:\\Users\\Foo\\proj', projects), null);
  });
});

test('projectTranscriptDir returns null when projects root is missing', () => {
  withTmpDir((dir) => {
    const projects = path.join(dir, 'does-not-exist');
    assert.equal(projectTranscriptDir('C:\\Users\\Foo\\proj', projects), null);
  });
});

test('projectTranscriptDir ignores a plain file with the matching name', () => {
  withTmpDir((dir) => {
    const projects = path.join(dir, 'projects');
    mkdirSync(projects, { recursive: true });
    writeFileSync(path.join(projects, 'C--Users-Foo-proj'), 'not a dir', 'utf8');
    assert.equal(projectTranscriptDir('C:\\Users\\Foo\\proj', projects), null);
  });
});

test('listSessionFiles: only top-level .jsonl, sorted ascending, live flagged', () => {
  withTmpDir((dir) => {
    const now = 1_750_000_000_000;
    const oldFile = path.join(dir, 'old-session.jsonl');
    const liveFile = path.join(dir, 'live-session.jsonl');
    writeFileSync(oldFile, '{"type":"user"}\n', 'utf8');
    writeFileSync(liveFile, '{"type":"user"}\n', 'utf8');
    writeFileSync(path.join(dir, 'notes.txt'), 'ignore me', 'utf8');
    writeFileSync(path.join(dir, 'data.json'), '{}', 'utf8');
    const sub = path.join(dir, 'subagents');
    mkdirSync(sub);
    writeFileSync(path.join(sub, 'nested.jsonl'), '{}\n', 'utf8');

    // utimesSync takes seconds
    utimesSync(oldFile, (now - 3_600_000) / 1000, (now - 3_600_000) / 1000);
    utimesSync(liveFile, (now - 5_000) / 1000, (now - 5_000) / 1000);

    const files = listSessionFiles(dir, { now });
    assert.equal(files.length, 2);
    assert.equal(files[0].path, oldFile);
    assert.equal(files[1].path, liveFile);
    assert.equal(files[0].live, false);
    assert.equal(files[1].live, true);
    assert.ok(files[0].mtimeMs <= files[1].mtimeMs);
    assert.ok(files[0].size > 0);
  });
});

test('listSessionFiles respects custom skipLiveMs', () => {
  withTmpDir((dir) => {
    const now = 1_750_000_000_000;
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, '{}\n', 'utf8');
    utimesSync(f, (now - 50_000) / 1000, (now - 50_000) / 1000);

    assert.equal(listSessionFiles(dir, { now })[0].live, true);
    assert.equal(listSessionFiles(dir, { now, skipLiveMs: 10_000 })[0].live, false);
  });
});

test('listSessionFiles on a missing dir returns []', () => {
  withTmpDir((dir) => {
    assert.deepEqual(listSessionFiles(path.join(dir, 'nope')), []);
  });
});

test('contentHash is identical for CRLF and LF variants', () => {
  withTmpDir((dir) => {
    const lf = path.join(dir, 'lf.jsonl');
    const crlf = path.join(dir, 'crlf.jsonl');
    writeFileSync(lf, '{"a":1}\n{"b":2}\n', 'utf8');
    writeFileSync(crlf, '{"a":1}\r\n{"b":2}\r\n', 'utf8');
    const h1 = contentHash(lf);
    const h2 = contentHash(crlf);
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(h1, h2);
  });
});

test('contentHash differs for different content', () => {
  withTmpDir((dir) => {
    const a = path.join(dir, 'a.jsonl');
    const b = path.join(dir, 'b.jsonl');
    writeFileSync(a, '{"a":1}\n', 'utf8');
    writeFileSync(b, '{"a":2}\n', 'utf8');
    assert.notEqual(contentHash(a), contentHash(b));
  });
});
