import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import search from '../src/commands/search.js';
import why from '../src/commands/why.js';
import on from '../src/commands/on.js';
import off from '../src/commands/off.js';
import { runInjection } from '../src/lib/inject.js';
import { loadConfig, isInjectionEnabled } from '../src/lib/config.js';
import { writeActiveLesson } from './helpers.js';

async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-recall-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  const proj = path.join(dir, 'proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(path.join(proj, 'package.json'), '{}', 'utf8');
  try {
    return await fn(dir, proj);
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

// Capture console.log output of a command without touching its logic.
async function captured(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    return { code: await fn(), out: () => lines.join('\n') };
  } finally {
    console.log = orig;
  }
}

test('search ranks by the same scorer the hooks use, with reasons', async () => {
  await withSandbox(async () => {
    writeActiveLesson();
    const r = await captured(() => search(['webhook', '--json']));
    assert.equal(r.code, 0);
    const results = JSON.parse(r.out());
    assert.equal(results.length, 1);
    assert.equal(results[0].slug, 'webhook-idempotency');
    assert.ok(results[0].reasons.some((x) => x.startsWith('keyword:webhook')));

    const human = await captured(() => search(['webhook']));
    assert.ok(human.out().includes('webhook-idempotency'));
    assert.ok(human.out().includes('raph show'));
  });
});

test('search --audience filters to the agent slice; no terms is a usage error', async () => {
  await withSandbox(async () => {
    writeActiveLesson(); // agents: developer, reviewer, debugger
    const dev = await captured(() => search(['webhook', '--audience', 'developer', '--json']));
    assert.equal(JSON.parse(dev.out()).length, 1);
    const designer = await captured(() => search(['webhook', '--audience', 'designer', '--json']));
    assert.equal(JSON.parse(designer.out()).length, 0);
    assert.equal(await search([]), 1);
  });
});

test('why explains past injections from the audit log', async () => {
  await withSandbox(async (dir, proj) => {
    const empty = await captured(() => why([]));
    assert.equal(empty.code, 0);
    assert.ok(empty.out().includes('no injections recorded yet'));

    writeActiveLesson();
    runInjection('user-prompt', { session_id: 'why-test', cwd: proj, prompt: 'webhook broke again' });

    const r = await captured(() => why([]));
    assert.ok(r.out().includes('webhook-idempotency'));
    assert.ok(r.out().includes('keyword:webhook'));
    assert.ok(r.out().includes('session=why-test'));
  });
});

test('on/off flip the config kill switch', async () => {
  await withSandbox(async () => {
    assert.equal(isInjectionEnabled(loadConfig()), true); // default: enabled
    await captured(() => off([]));
    assert.equal(isInjectionEnabled(loadConfig()), false);
    await captured(() => on([]));
    assert.equal(isInjectionEnabled(loadConfig()), true);
  });
});
