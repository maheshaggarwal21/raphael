import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { runInjection, loadSessionState, saveSessionState, PREAMBLE, estTokens, atlasDigestBlock, stableOrder, pointerLine } from '../src/lib/inject.js';
import { setInjectionEnabled } from '../src/lib/config.js';
import { writeActiveLesson } from './helpers.js';
import { recordDecision } from '../src/lib/decisions.js';
import { lessonId } from '../src/lib/ulid.js';
import { atlasPaths } from '../src/lib/atlas.js';
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
  writeFileSync(atlasPaths(projDir).json, JSON.stringify(doc), 'utf8');
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
  // a configured brain (a missing config.yaml means "fresh install" and would
  // trigger the 17.5 one-time onboarding envelope instead of normal recall)
  writeFileSync(path.join(dir, 'config.yaml'), 'schema: raphael/config/v1\nmode: curator\n', 'utf8');
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

// REGRESSION (audit 2026-07-26, finding 3.2). Both per-prompt guarantees used to
// rest on score arithmetic and were provably false; the tests above pinned them
// only at convenient interior fixture values. These pin the BOUNDARIES.

test('user-prompt: a saturated prior + stack match still does NOT fire without a trigger hit', async () => {
  await withSandbox(async (dir, proj) => {
    // exactly the hole: W_STACK 3.0 + a fully saturated recent prior 1.0 = 4.0,
    // and rank() used `score < threshold`, so equality passed with ZERO hits.
    writeActiveLesson({
      evidence: {
        refs: [], observations: 9, distinct_projects: 3,
        source_mix: { mined: 9 },
        first_seen: '2026-05-02',
        last_seen: new Date().toISOString().slice(0, 10) // recency bonus in full
      }
    });
    const miss = runInjection('user-prompt', {
      session_id: 'sess-boundary', cwd: proj, prompt: 'please help me write documentation'
    });
    assert.equal(miss.text, '', 'stack + prior alone must never inject on an unrelated prompt');
    assert.equal(miss.injected.length, 0);
  });
});

test('user-prompt: dedupe holds even for a keyword-rich lesson that outscores the penalty', async () => {
  await withSandbox(async (dir, proj) => {
    // 3 keyword hits (12.0) + stack (3.0) + prior (~1.0) - 10.0 = ~6.0, which
    // clears the 4.0 threshold — so the -10 penalty alone did NOT dedupe it.
    const { data } = writeActiveLesson({
      triggers: { keywords: ['webhook', 'stripe', 'signature'], paths: [] }
    });
    const prompt = 'the stripe webhook signature check keeps failing';

    const first = runInjection('user-prompt', { session_id: 'sess-dup', cwd: proj, prompt });
    assert.ok(first.text.includes(data.injection.headline), 'it should fire the first time');

    const second = runInjection('user-prompt', { session_id: 'sess-dup', cwd: proj, prompt });
    assert.equal(second.text, '', 'a repeated prompt must never repeat the headline');

    const third = runInjection('user-prompt', { session_id: 'sess-dup', cwd: proj, prompt });
    assert.equal(third.text, '', 'and still not on the third try (a debugging loop)');
  });
});

test('user-prompt: a high-severity lesson past the session cap still cannot repeat', async () => {
  await withSandbox(async (dir, proj) => {
    // high/critical bypass the token cap by design — that must not become a
    // licence to re-inject the same headline forever.
    const { data } = writeActiveLesson({
      severity: 'high',
      triggers: { keywords: ['webhook', 'stripe', 'signature'], paths: [] }
    });
    const prompt = 'the stripe webhook signature is failing';
    const first = runInjection('user-prompt', { session_id: 'sess-cap', cwd: proj, prompt });
    assert.ok(first.text.includes(data.injection.headline));

    const st = loadSessionState('sess-cap');
    st.tokens = 99999; // way past any cap
    saveSessionState('sess-cap', st);

    const again = runInjection('user-prompt', { session_id: 'sess-cap', cwd: proj, prompt });
    assert.equal(again.text, '', 'past the cap, high severity may inject — but never a repeat');
  });
});

test('session-start: a lesson already injected this session is not repeated after a compaction', async () => {
  await withSandbox(async (dir, proj) => {
    const { data } = writeActiveLesson();
    const first = runInjection('session-start', { session_id: 'sess-comp', cwd: proj });
    assert.ok(first.text.includes(data.injection.headline));
    // SessionStart can fire again after a compaction in the same session
    const second = runInjection('session-start', { session_id: 'sess-comp', cwd: proj });
    assert.equal(second.text.includes(data.injection.headline), false, 'no repeat digest line');
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
    writeFileSync(atlasPaths(proj).json, 'not json', 'utf8');
    assert.equal(atlasDigestBlock(proj), '');                 // corrupt
    writeFileSync(atlasPaths(proj).json, JSON.stringify({ counts: { files: 0 }, nodes: [] }), 'utf8');
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

// --- 18.1 cache-stable ordering ----------------------------------------------
// Re-ranking used to reorder an UNCHANGED lesson set on every session start,
// which invalidates the provider prompt cache. Selection stays rank-based;
// presentation is pinned by ULID id, so new lessons append at the tail.

test('stableOrder pins presentation by id regardless of incoming rank order', () => {
  const a = { entry: { id: 'les_01AAA', severity: 'high' } };
  const b = { entry: { id: 'les_01BBB', severity: 'low' } };
  const c = { entry: { id: 'les_01CCC', severity: 'high' } };
  const ids = (picks) => stableOrder(picks).map((p) => p.entry.id);
  // three different rank orders of the SAME set must render identically
  assert.deepEqual(ids([c, a, b]), ['les_01AAA', 'les_01BBB', 'les_01CCC']);
  assert.deepEqual(ids([b, c, a]), ['les_01AAA', 'les_01BBB', 'les_01CCC']);
  assert.deepEqual(ids([a, b, c]), ['les_01AAA', 'les_01BBB', 'les_01CCC']);
});

test('a newly-learned lesson appends at the TAIL, leaving the earlier prefix intact', () => {
  // ULIDs sort chronologically, so a later-created lesson sorts last
  const older = [{ entry: { id: 'les_01AAA' } }, { entry: { id: 'les_01BBB' } }];
  const withNew = [{ entry: { id: 'les_01ZZZ' } }, ...older]; // arrives ranked first
  const before = stableOrder(older).map((p) => p.entry.id);
  const after = stableOrder(withNew).map((p) => p.entry.id);
  assert.deepEqual(after.slice(0, before.length), before, 'prefix must be unchanged');
  assert.equal(after[after.length - 1], 'les_01ZZZ', 'the new lesson goes last');
});

test('stableOrder does not mutate its input and tolerates empty/missing ids (edge)', () => {
  const input = [{ entry: { id: 'les_01BBB' } }, { entry: { id: 'les_01AAA' } }];
  const copy = [...input];
  stableOrder(input);
  assert.deepEqual(input, copy, 'input array must not be reordered in place');
  assert.deepEqual(stableOrder([]), []);
  assert.equal(stableOrder([{ entry: {} }, { entry: {} }]).length, 2); // no crash
});

test('pointerLine names ranked-but-unfitted lessons, and stays silent when everything fit', () => {
  const ranked = [{ entry: { id: 'les_A' } }, { entry: { id: 'les_B' } }, { entry: { id: 'les_C' } }];
  const picks = [{ entry: { id: 'les_A' } }];
  const line = pointerLine(ranked, picks, 100);
  assert.match(line, /les_B/);
  assert.match(line, /les_C/);
  assert.match(line, /raph show/);
  assert.ok(!line.includes('les_A'), 'already-injected lessons are not repeated');
  // nothing missed => no line at all (never an empty ceremony)
  assert.equal(pointerLine(ranked, ranked, 100), '');
  // no room => no line (must never bust the budget)
  assert.equal(pointerLine(ranked, picks, 1), '');
});

test('session-start renders byte-identically for an unchanged brain (the cache property)', async () => {
  await withSandbox(async (dir, proj) => {
    // NOTE: makeLesson takes FLAT overrides — scope/triggers are nested, so passing
    // `stacks`/`keywords` at the top level would be unknown fields and the strict
    // schema would reject the lesson (it would silently never reach the index).
    for (const slug of ['zeta-lesson', 'alpha-lesson', 'mid-lesson']) {
      writeActiveLesson({ slug, title: `${slug} title` });
    }
    const run = (id) => runInjection('session-start', { session_id: id, cwd: proj }).text;
    const first = run('cache-1');
    const second = run('cache-2');
    // guard against a vacuously-passing test: the block must actually have lessons
    const lessonLines = first.split(String.fromCharCode(10)).filter((l) => l.startsWith('['));
    assert.ok(lessonLines.length >= 3, `expected injected lessons, got: ${JSON.stringify(first)}`);
    // and they must be in ascending id order (the cache-stable property)
    const ids = lessonLines.map((l) => l.slice(1, l.indexOf(']')));
    assert.deepEqual(ids, [...ids].sort(), 'lesson lines must be in stable ascending id order');
    // different sessions, same brain -> identical bytes (a cache hit, not a miss)
    assert.equal(first, second, 'an unchanged brain must render the same bytes every session');
  });
});
