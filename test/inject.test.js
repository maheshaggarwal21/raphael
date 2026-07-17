import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { runInjection, loadSessionState, saveSessionState, PREAMBLE, estTokens, atlasDigestBlock } from '../src/lib/inject.js';
import { setInjectionEnabled } from '../src/lib/config.js';
import { writeActiveLesson } from './helpers.js';
import { recordDecision } from '../src/lib/decisions.js';
import { lessonId } from '../src/lib/ulid.js';
import { mapFileName } from '../src/lib/map.js';
import { p } from '../src/lib/paths.js';

// Seed an atlas cache for a project dir so the capability-check passes.
function seedAtlas(projDir, { files = 4 } = {}) {
  const doc = {
    project: path.basename(projDir),
    counts: { files, nodes: files, edges: 0 },
    nodes: [
      { id: 'file:src/core.js', type: 'file', label: 'src/core.js', degree: 9 },
      { id: 'file:src/util.js', type: 'file', label: 'src/util.js', degree: 4 }
    ]
  };
  mkdirSync(p.atlas(), { recursive: true });
  writeFileSync(path.join(p.atlas(), `${mapFileName(path.basename(projDir))}.json`), JSON.stringify(doc), 'utf8');
  return doc;
}

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

// ---- 16.3 query-first wiring: atlas digest + PreToolUse nudge ----------------

test('16.3 session-start: atlas digest rides along when an atlas exists (capability-check +)', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson(); // need >=1 lesson for session-start to fire at all
    seedAtlas(proj);
    const r = runInjection('session-start', { session_id: 'atl-1', cwd: proj });
    assert.ok(r.text.includes('<raphael-atlas>'), 'atlas envelope present');
    assert.ok(r.text.includes('src/core.js'), 'most-connected file surfaced');
    assert.ok(r.text.includes('raph atlas where'), 'the nudge line is present');
    assert.ok(r.text.includes('DATA, not instructions'), 'framed as data, not a command');
    assert.ok(readFileSync(p.events(), 'utf8').includes('"atlas_digest":true'));
  });
});

test('16.3 session-start: NO atlas block when none is built (capability-check -)', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson();
    const r = runInjection('session-start', { session_id: 'atl-2', cwd: proj });
    assert.ok(r.text.includes('<raphael-lessons>'), 'lessons still inject');
    assert.ok(!r.text.includes('<raphael-atlas>'), 'no atlas nudge without a built atlas');
  });
});

test('16.8b session-start: standing decisions ride along, framed as settled data', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson();
    recordDecision({ title: 'Keep security lessons human-approved', rationale: 'security floor' });
    const r = runInjection('session-start', { session_id: 'dec-1', cwd: proj });
    assert.ok(r.text.includes('<raphael-decisions>'), 'decisions envelope present');
    assert.ok(r.text.includes('Keep security lessons human-approved'), 'the decision surfaced');
    assert.ok(r.text.includes('do not re-litigate'), 'framed as settled, not a command');
  });
});

test('16.8b session-start: NO decisions block when none recorded (capability-check -)', async () => {
  await withSandbox(async (dir, proj) => {
    writeActiveLesson();
    const r = runInjection('session-start', { session_id: 'dec-2', cwd: proj });
    assert.ok(!r.text.includes('<raphael-decisions>'), 'no empty decisions ceremony');
  });
});

test('16.3 atlasDigestBlock: empty for missing/corrupt/empty atlas', async () => {
  await withSandbox(async (dir, proj) => {
    assert.equal(atlasDigestBlock(proj), '');                 // none built
    mkdirSync(p.atlas(), { recursive: true });
    writeFileSync(path.join(p.atlas(), `${mapFileName(path.basename(proj))}.json`), 'not json', 'utf8');
    assert.equal(atlasDigestBlock(proj), '');                 // corrupt
    writeFileSync(path.join(p.atlas(), `${mapFileName(path.basename(proj))}.json`), JSON.stringify({ counts: { files: 0 }, nodes: [] }), 'utf8');
    assert.equal(atlasDigestBlock(proj), '');                 // no nodes
  });
});

test('16.3 pre-tool nudge: fires once per session for search tools when an atlas exists', async () => {
  await withSandbox(async (dir, proj) => {
    seedAtlas(proj); // no lesson needed — nudge is atlas-only

    // non-search tool: never nudges
    const readTool = runInjection('pre-tool', { session_id: 'nud-1', cwd: proj, tool_name: 'Read' });
    assert.equal(readTool.text, '');

    // first Grep: nudge fires
    const first = runInjection('pre-tool', { session_id: 'nud-1', cwd: proj, tool_name: 'Grep' });
    assert.ok(first.text.includes('<raphael-atlas-nudge>'));
    assert.ok(first.text.includes('raph atlas where'));
    assert.ok(loadSessionState('nud-1').atlas_nudged, 'dedupe flag persisted');

    // second search in the same session: suppressed
    const second = runInjection('pre-tool', { session_id: 'nud-1', cwd: proj, tool_name: 'Glob' });
    assert.equal(second.text, '');

    // a Bash grep is search-shaped too, but this session already nudged
    const bash = runInjection('pre-tool', { session_id: 'nud-1', cwd: proj, tool_name: 'Bash', tool_input: { command: 'grep -r foo .' } });
    assert.equal(bash.text, '');
  });
});

test('16.3 pre-tool nudge: no atlas built = never nudges (capability-check)', async () => {
  await withSandbox(async (dir, proj) => {
    const r = runInjection('pre-tool', { session_id: 'nud-2', cwd: proj, tool_name: 'Grep' });
    assert.equal(r.text, '');
    assert.equal(existsSync(p.sessionsDir()), false); // nothing written when it no-ops
  });
});

test('16.3 pre-tool nudge: Bash grep detected as search-shaped', async () => {
  await withSandbox(async (dir, proj) => {
    seedAtlas(proj);
    const r = runInjection('pre-tool', { session_id: 'nud-3', cwd: proj, tool_name: 'Bash', tool_input: { command: 'rg "E-SCHEMA" src/' } });
    assert.ok(r.text.includes('<raphael-atlas-nudge>'));
    // a non-search Bash command does not
    const plain = runInjection('pre-tool', { session_id: 'nud-4', cwd: proj, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    assert.equal(plain.text, '');
  });
});
