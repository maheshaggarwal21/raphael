// The router every single invocation crosses — and which had ZERO tests
// (audit 2026-07-26). Commands are LAZILY imported, so `npm test` passing did
// not prove that all of them even resolve: a typo'd import path would surface
// only when a user typed that verb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, COMMANDS, EXIT_CODES } from '../src/cli.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'raph.js');

function quiet(fn) {
  const log = console.log;
  const err = console.error;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { result: fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

test('help and version succeed; an unknown command fails with a pointer to help', async () => {
  for (const argv of [[], ['help'], ['--help'], ['-h']]) {
    const { result, out } = quiet(() => run(argv));
    assert.equal(await result, EXIT_CODES.ok, `${JSON.stringify(argv)} should exit 0`);
    assert.match(out, /raph — the Raphael brain CLI/);
  }

  for (const argv of [['version'], ['--version'], ['-v']]) {
    const { result, out } = quiet(() => run(argv));
    assert.equal(await result, EXIT_CODES.ok);
    assert.match(out, /raphael-brain \d+\.\d+\.\d+/);
  }

  const { result, out } = quiet(() => run(['definitely-not-a-command']));
  assert.equal(await result, EXIT_CODES.error);
  assert.match(out, /unknown command "definitely-not-a-command"/);
  assert.match(out, /raph help/);
});

test('every command in the table actually loads and exports a default function', async () => {
  const names = Object.keys(COMMANDS);
  assert.ok(names.length >= 40, `expected the full verb surface, got ${names.length}`);
  const broken = [];
  for (const name of names) {
    try {
      const mod = await COMMANDS[name]();
      if (typeof mod.default !== 'function') broken.push(`${name}: no default export`);
    } catch (err) {
      broken.push(`${name}: ${err.message}`);
    }
  }
  assert.deepEqual(broken, [], 'these verbs would fail only when a user typed them');
});

test('the help text documents the exit codes it promises', async () => {
  const { out } = quiet(() => run(['help']));
  for (const code of Object.values(EXIT_CODES)) {
    assert.match(out, new RegExp(`\\s${code}\\s`), `exit code ${code} should appear in the help table`);
  }
  assert.match(out, /internal error/, 'the crash code is explained');
});

test('a crash exits 70, NOT 2 — a policy verdict and a bug must be distinguishable', () => {
  // `raph adopt` blocked-by-reviewer and a failed drive stage both return 2 on
  // purpose. Before this, an uncaught throw also exited 2, so no script could
  // tell "the reviewer rejected this" from "raph threw a TypeError".
  const home = mkdtempSync(path.join(os.tmpdir(), 'raph-cli-'));
  try {
    const r = spawnSync(process.execPath, [BIN, 'academy', 'status', 'no-such-project-xyz'], {
      encoding: 'utf8',
      env: { ...process.env, RAPHAEL_HOME: home }
    });
    assert.notEqual(r.status, 2, 'a missing project must not look like a policy block');
    assert.ok([0, 1, 70].includes(r.status), `unexpected exit ${r.status}: ${r.stderr}`);

    // A corrupt academy state raises E-ACADEMY (21.6). The command reports it
    // cleanly and exits 1 — an ERROR, still not a policy block.
    mkdirSync(path.join(home, 'academy', 'broken'), { recursive: true });
    writeFileSync(path.join(home, 'academy', 'broken', 'state.json'), '{"project":"brok', 'utf8');
    const handled = spawnSync(process.execPath, [BIN, 'academy', 'checkpoint', 'broken', '--note', 'x'], {
      encoding: 'utf8',
      env: { ...process.env, RAPHAEL_HOME: home }
    });
    assert.equal(handled.status, EXIT_CODES.error, 'a reported failure is 1, not 2');
    assert.match(handled.stderr, /E-ACADEMY/);

    // The crash mapping itself is ONE line in bin/raph.js and (encouragingly)
    // no command leaves an error uncaught, so there is no natural way to reach
    // it end to end. It is asserted STRUCTURALLY instead: the bin must use the
    // shared constant, so the contract and the code cannot drift apart.
    assert.equal(EXIT_CODES.crash, 70, 'the documented crash code');
    const binSrc = readFileSync(BIN, 'utf8');
    assert.match(binSrc, /process\.exit\(EXIT_CODES\.crash\)/, 'the bin maps a rejection to the shared crash code');
    assert.equal(/process\.exit\(2\)/.test(binSrc), false, 'and never to 2, which is a policy verdict');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('unknown command exits 1 through the real binary too', () => {
  const r = spawnSync(process.execPath, [BIN, 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, EXIT_CODES.error);
  assert.match(r.stderr, /unknown command/);
});
