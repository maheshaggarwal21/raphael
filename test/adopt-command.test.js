import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const adopt = (await import('../src/commands/adopt.js')).default;

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-adoptcmd-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

function capture(fn) {
  const out = [];
  const err = [];
  const so = console.log;
  const se = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }))
    .finally(() => {
      console.log = so;
      console.error = se;
    });
}

test('adopt with no args prints help and fails; help subcommand succeeds', async () => {
  const home = sandbox();
  try {
    const none = await capture(() => adopt([]));
    assert.equal(none.code, 1);
    assert.ok(none.out.includes('raph adopt'));
    const help = await capture(() => adopt(['help']));
    assert.equal(help.code, 0);
  } finally {
    cleanup(home);
  }
});

test('adopt list: empty ledger says so', async () => {
  const home = sandbox();
  try {
    const r = await capture(() => adopt(['list']));
    assert.equal(r.code, 0);
    assert.ok(r.out.includes('no adoptions yet'));
  } finally {
    cleanup(home);
  }
});

test('adopt revoke: missing ref and unknown ref both fail with guidance', async () => {
  const home = sandbox();
  try {
    const noRef = await capture(() => adopt(['revoke']));
    assert.equal(noRef.code, 1);
    assert.ok(noRef.err.includes('usage'));
    const unknown = await capture(() => adopt(['revoke', 'adp_NOPE']));
    assert.equal(unknown.code, 1);
    assert.ok(unknown.err.includes('E-NOTFOUND'));
  } finally {
    cleanup(home);
  }
});

test('adopt --dry-run: reads + licenses + estimates, spends nothing, writes nothing', async () => {
  const home = sandbox();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-dry-'));
  try {
    writeFileSync(path.join(dir, 'notes.md'), 'SPDX-License-Identifier: MIT\nqueue wisdom worth adopting');
    const r = await capture(() => adopt([path.join(dir, 'notes.md'), '--dry-run']));
    assert.equal(r.code, 0);
    assert.ok(r.out.includes('PLAN'));
    assert.ok(r.out.includes('MIT (permissive)'));
    assert.ok(r.out.includes('dry run — no model calls'));
    // and the ledger stayed empty
    const list = await capture(() => adopt(['list']));
    assert.ok(list.out.includes('no adoptions yet'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cleanup(home);
  }
});

test('adopt --dry-run on a missing source fails cleanly', async () => {
  const home = sandbox();
  try {
    const r = await capture(() => adopt(['C:/nope/missing.md', '--dry-run']));
    assert.equal(r.code, 1);
    assert.ok(r.err.includes('E-ADOPT'));
  } finally {
    cleanup(home);
  }
});
