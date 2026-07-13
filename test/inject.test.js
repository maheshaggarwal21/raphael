import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { runInjection, loadSessionState, saveSessionState, PREAMBLE, estTokens } from '../src/lib/inject.js';
import { setInjectionEnabled } from '../src/lib/config.js';
import { writeActiveLesson } from './helpers.js';
import { lessonId } from '../src/lib/ulid.js';
import { p } from '../src/lib/paths.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'raph.js');

async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-inject-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  const proj = path.join(dir, 'proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(path.join(proj, 'package.json'), '{}', 'utf8'); // → node stack
  try {
    return await fn(dir, proj);
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('empty brain: both hooks are a strict no-op', async () => {
  await withSandbox(async (dir, proj) => {
    const start = runInjection('session-start', { session_id: 's1', cwd: proj });
    assert.equal(start.text, '');
    const prompt = runInjection('user-prompt', { session_id: 's1', cwd: proj, prompt: 'webhook bug' });
    assert.equal(prompt.text, '');
    assert.equal(existsSync(p.sessionsDir()), false); // no state written either
  });
});

test('session-start injects preamble + stack-matched digest, inside the envelope', async () => {
  await withSandbox(async (dir, proj) => {
    const { data } = writeActiveLesson(); // stacks: node — matches proj
    const r = runInjection('session-start', { session_id: 'sess-a', cwd: proj });
    assert.ok(r.text.startsWith('<raphael-lessons>'));
    assert.ok(r.text.endsWith('</raphael-lessons>'));
    assert.ok(r.text.includes('DATA'));
    assert.ok(r.text.includes('raph search'));
    assert.ok(r.text.includes(data.injection.headline));
    assert.ok(r.tokens <= 340 + estTokens(PREAMBLE)); // preamble+digest budget with envelope margin
    const state = loadSessionState('sess-a');
    assert.ok(state.injected[data.id]);
    assert.ok(readFileSync(p.events(), 'utf8').includes('"injected"'));
  });
});

test('compaction re-fire: framing is re-sent, seen headlines stay suppressed', async () => {
  await withSandbox(async (dir, proj) => {
    const { data } = writeActiveLesson();
    runInjection('session-start', { session_id: 'sess-b', cwd: proj });
    const again = runInjection('session-start', { session_id: 'sess-b', cwd: proj });
    assert.ok(again.text.includes('DATA')); // framing back
    assert.equal(again.text.includes(data.injection.headline), false); // headline not repeated
    assert.equal(again.injected.length, 0);
  });
});

test('user-prompt: fires only on a trigger hit, then dedupes for the session', async () => {
  await withSandbox(async (dir, proj) => {
    const { data } = writeActiveLesson();

    const miss = runInjection('user-prompt', { session_id: 'sess-c', cwd: proj, prompt: 'please help me write documentation' });
    assert.equal(miss.text, ''); // stack+prior alone stays under the 4.0 threshold

    const hit = runInjection('user-prompt', { session_id: 'sess-c', cwd: proj, prompt: 'the stripe webhook keeps failing' });
    assert.ok(hit.text.includes(data.injection.headline));
    assert.ok(hit.text.includes('Advisory data'));
    assert.ok(hit.tokens <= 150 + 40); // headline budget + short frame/envelope

    const repeat = runInjection('user-prompt', { session_id: 'sess-c', cwd: proj, prompt: 'the stripe webhook keeps failing' });
    assert.equal(repeat.text, ''); // per-lesson session dedupe

    const events = readFileSync(p.events(), 'utf8');
    assert.ok(events.includes('keyword:webhook+4.0')); // explainable reasons in telemetry
  });
});

test('user-prompt injects at most 3 headlines however many match', async () => {
  await withSandbox(async (dir, proj) => {
    for (let i = 0; i < 6; i++) {
      writeActiveLesson({ id: lessonId(), slug: `webhook-lesson-${i}` });
    }
    const r = runInjection('user-prompt', { session_id: 'sess-d', cwd: proj, prompt: 'webhook exploding' });
    assert.equal(r.injected.length, 3);
  });
});

test('past the 1,200-token session cap only high/critical still inject', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson({
      id: lessonId(),
      slug: 'docker-cache-medium',
      severity: 'medium',
      title: 'Docker layer cache invalidation ordering',
      triggers: { keywords: ['dockerfile'], paths: [] },
      injection: { headline: 'COPY before deps install invalidated the whole docker layer cache.', tokens: 18 }
    });
    writeActiveLesson({ id: lessonId() }); // default: severity high, keyword webhook

    const st = loadSessionState('sess-cap');
    st.tokens = 1300;
    saveSessionState(st);

    const med = runInjection('user-prompt', { session_id: 'sess-cap', cwd: proj, prompt: 'my dockerfile build is slow' });
    assert.equal(med.text, ''); // medium blocked past cap

    const high = runInjection('user-prompt', { session_id: 'sess-cap', cwd: proj, prompt: 'webhook duplicate charge' });
    assert.ok(high.text.length > 0); // high still allowed
  });
});

test('raph off silences both hooks; raph on restores them', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson();
    setInjectionEnabled(false);
    assert.equal(runInjection('user-prompt', { session_id: 's', cwd: proj, prompt: 'webhook bug' }).text, '');
    assert.equal(runInjection('session-start', { session_id: 's', cwd: proj }).text, '');
    setInjectionEnabled(true);
    assert.ok(runInjection('user-prompt', { session_id: 's', cwd: proj, prompt: 'webhook bug' }).text.length > 0);
  });
});

test('E2E: the real hook command reads stdin, prints context, always exits 0', async () => {
  await withSandbox(async (dir, proj) => {
    const { data } = writeActiveLesson();
    const env = { ...process.env, RAPHAEL_HOME: dir };

    const ok = spawnSync(process.execPath, [BIN, 'inject', '--event', 'user-prompt'], {
      input: JSON.stringify({ session_id: 'e2e', cwd: proj, prompt: 'webhook retry storm' }),
      env,
      encoding: 'utf8'
    });
    assert.equal(ok.status, 0);
    assert.ok(ok.stdout.includes(data.injection.headline));

    const garbage = spawnSync(process.execPath, [BIN, 'inject', '--event', 'user-prompt'], {
      input: '{{{ not json at all',
      env,
      encoding: 'utf8'
    });
    assert.equal(garbage.status, 0); // fail-open, no matter what
    assert.equal(garbage.stdout.trim(), '');

    const noEvent = spawnSync(process.execPath, [BIN, 'inject'], { input: '{}', env, encoding: 'utf8' });
    assert.equal(noEvent.status, 0);
  });
});
