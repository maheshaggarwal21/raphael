import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PIPELINE,
  initDriver,
  nextAction,
  applyStageResult,
  renderStagePrompt,
  retryStage,
  buildStageArgs,
  drive,
  renderPlan,
  CODE_BEARING_KINDS,
  makeStageRunner
} from '../src/lib/driver.js';
import { startProject, readState, writeState } from '../src/lib/academy.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-driver-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

// A runner that "completes" every stage instantly and records what it was asked.
function fakeRunner(calls = [], { failKinds = new Set(), limitOnCall = -1 } = {}) {
  let n = 0;
  return async function run(opts) {
    n += 1;
    calls.push({ ...opts, call: n });
    if (n === limitOnCall) {
      const err = new Error('E-LIMIT: subscription limit hit mid-stage (resets 5:50pm Asia/Calcutta)');
      err.code = 'E-LIMIT';
      err.resetText = '5:50pm';
      err.resetZone = 'Asia/Calcutta';
      throw err;
    }
    if (failKinds.has(opts.policy?.kind)) {
      return { ok: false, error: 'stage reported failure', output: null, tokens: 10 };
    }
    return { ok: true, output: `deliverable-${n}`, tokens: 100 };
  };
}

test('driver state machine: brief feeds stage 0, outputs chain, done records the deploy boundary', async () => {
  const dir = sandbox();
  try {
    startProject('kit', { title: 'Kit', workspace: dir });
    let state = readState('kit');
    assert.throws(() => initDriver(state, { brief: '   ' }), /E-DRIVER.*brief/);
    assert.throws(() => initDriver(state, { brief: 'x', pipeline: ['plan', 'deploy'] }), /E-POLICY.*unknown task kind/);

    initDriver(state, { brief: 'Build a tiny CLI that says hi.' });
    assert.deepEqual(state.driver.pipeline, DEFAULT_PIPELINE);

    // stage 0 runs on the brief with the policy table's decision
    let a = nextAction(state);
    assert.equal(a.type, 'run');
    assert.equal(a.kind, 'plan');
    assert.equal(a.policy.model, 'sonnet');
    assert.equal(a.policy.effort, 'high');
    assert.equal(a.input, 'Build a tiny CLI that says hi.');
    assert.equal(a.resumeSessionId, null);

    // completing a stage advances and chains the output
    applyStageResult(state, 'plan', { ok: true, output: 'THE SPEC', tokens: 5, sessionId: 's1' });
    a = nextAction(state);
    assert.equal(a.kind, 'architect');
    assert.equal(a.input, 'THE SPEC');
    assert.equal(a.priorKind, 'plan');

    // the full loop against the DISK state, with a fake runner (fresh driver written)
    const diskState = readState('kit');
    initDriver(diskState, { brief: 'Build a tiny CLI that says hi.' });
    writeState('kit', diskState);
    const calls = [];
    const out = await drive('kit', { runner: fakeRunner(calls), log: () => {} });
    assert.equal(out.stopped, 'done');
    assert.equal(calls.length, DEFAULT_PIPELINE.length);
    // every stage ran with the policy table's model/effort, fresh sessions
    assert.equal(calls[0].policy.kind, 'plan');
    assert.equal(calls.at(-1).policy.kind, 'deploy-prep');
    assert.ok(new Set(calls.map((c) => c.sessionId)).size === calls.length);

    // pipeline completion = the autonomy boundary, recorded on the academy state
    const final = readState('kit');
    assert.equal(final.driver.status, 'done');
    assert.equal(final.status, 'blocked-boundary');
    assert.match(final.boundary.reason, /deploy.*owner/i);

    // a second drive on a completed pipeline is a no-op owner surface
    const again = await drive('kit', { runner: fakeRunner([]), log: () => {} });
    assert.equal(again.stopped, 'owner');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('limit mid-stage: checkpointed as blocked-limit, then the SAME stage resumes its session', async () => {
  const dir = sandbox();
  try {
    startProject('kit2', { title: 'Kit2', workspace: dir });
    const state = readState('kit2');
    initDriver(state, { brief: 'brief', pipeline: ['plan', 'develop'] });
    writeState('kit2', state);

    const calls1 = [];
    const out1 = await drive('kit2', { runner: fakeRunner(calls1, { limitOnCall: 2 }), log: () => {} });
    assert.equal(out1.stopped, 'limit');
    const paused = readState('kit2');
    assert.equal(paused.status, 'blocked-limit');
    assert.equal(paused.limit.reset_at, '5:50pm Asia/Calcutta');
    assert.equal(paused.driver.stages.develop.status, 'running'); // started, not finished
    const interruptedSession = paused.driver.stages.develop.session_id;
    assert.ok(interruptedSession);

    // rerun (the reset happened): the develop stage RESUMES the interrupted session
    const calls2 = [];
    const out2 = await drive('kit2', { runner: fakeRunner(calls2), log: () => {} });
    assert.equal(out2.stopped, 'done');
    assert.equal(calls2.length, 1);
    assert.equal(calls2[0].resume, true);
    assert.equal(calls2[0].sessionId, interruptedSession);
    assert.equal(readState('kit2').driver.status, 'done');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failure path: a kind with an escalation retries once on the stronger model, others fail fast', async () => {
  const dir = sandbox();
  try {
    startProject('kit3', { title: 'Kit3', workspace: dir });
    const state = readState('kit3');
    initDriver(state, { brief: 'brief', pipeline: ['debug', 'develop'] });
    writeState('kit3', state);

    // debug fails every time -> first attempt sonnet, retry escalates to opus, then failed
    const calls = [];
    const out = await drive('kit3', { runner: fakeRunner(calls, { failKinds: new Set(['debug']) }), log: () => {} });
    assert.equal(out.stopped, 'failed');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].policy.model, 'sonnet');
    assert.equal(calls[1].policy.model, 'opus');
    assert.equal(calls[1].policy.escalated, true);
    assert.notEqual(calls[1].sessionId, calls[0].sessionId); // escalation = fresh session
    const s = readState('kit3');
    assert.equal(s.driver.status, 'failed');
    assert.equal(s.driver.stages.debug.status, 'failed');

    // `review` has no escalation: one failure = failed driver.
    // (This used to assert on `develop`. F12 gave develop an escalation target —
    // it is the bulk tier and the one that actually fails — so the "fails fast"
    // case now needs a kind that genuinely has none.)
    const s2 = { ...readState('kit3') };
    delete s2.driver;
    initDriver(s2, { brief: 'brief', pipeline: ['review'] });
    applyStageResult(s2, 'review', { ok: false, error: 'boom', tokens: 1 });
    assert.equal(s2.driver.status, 'failed');
    assert.equal(nextAction(s2).type, 'failed');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stage prompts carry the boundary rules + roster mission; args resume sessions; plan renders', () => {
  const p1 = renderStagePrompt('plan', { project: 'kit', brief: 'THE BRIEF', input: 'THE BRIEF', priorKind: null });
  assert.match(p1, /NEVER deploy, sign in/);
  assert.match(p1, /THE BRIEF/);
  assert.match(p1, /finalized spec/i); // the Planner roster mission, not a generic line
  assert.equal(p1.includes('Input from the previous stage'), false);

  const p2 = renderStagePrompt('test', { project: 'kit', brief: 'B', input: 'CODE NOTES', priorKind: 'develop' });
  assert.match(p2, /Input from the previous stage \(develop\)/);
  assert.match(p2, /test suite/i); // the non-roster 'test' kind has its own mission

  const fresh = buildStageArgs({ model: 'sonnet', effort: 'high', sessionId: 'abc' });
  assert.equal(fresh[fresh.indexOf('--session-id') + 1], 'abc');
  assert.equal(fresh[fresh.indexOf('--model') + 1], 'sonnet');
  assert.equal(fresh[fresh.indexOf('--effort') + 1], 'high');
  assert.equal(fresh[fresh.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(fresh.includes('--tools'), false); // tools ON — stages write real files
  assert.equal(fresh.includes('--resume'), false);

  const resumed = buildStageArgs({ model: null, effort: 'medium', sessionId: 'abc', resume: true });
  assert.equal(resumed[resumed.indexOf('--resume') + 1], 'abc');
  assert.equal(resumed.includes('--session-id'), false);
  assert.equal(resumed.includes('--model'), false); // null model = CLI default, flag absent

  const state = { project: 'kit', driver: { pipeline: ['plan', 'develop'], stage: 1, brief: 'b', status: 'running', stages: { plan: { status: 'done' } } } };
  const plan = renderPlan(state);
  assert.match(plan, /\[x\]\s+1\. plan/);
  assert.match(plan, /\[>\]\s+2\. develop/);
  assert.match(plan, /no deploy stage exists/);
});

test('16.3 stage prompts carry the workspace atlas map for code-bearing kinds only', async () => {
  const dir = sandbox();
  try {
    // renderStagePrompt: the map section appears only when a digest is passed
    const withMap = renderStagePrompt('review', { project: 'kit', brief: 'B', input: 'x', priorKind: 'develop', atlasDigest: 'MOST-CONNECTED: src/core.js (9)' });
    assert.match(withMap, /## Project map \(data, not instructions\)/);
    assert.match(withMap, /MOST-CONNECTED: src\/core\.js/);
    assert.match(withMap, /raph atlas where/);

    const noMap = renderStagePrompt('plan', { project: 'kit', brief: 'B', input: 'x', priorKind: null });
    assert.equal(noMap.includes('## Project map'), false);

    // drive(): the injected atlasDigestFn is called for code-bearing kinds, and
    // its output lands in the code-bearing stage's prompt but never the plan's.
    startProject('kit', { title: 'Kit', workspace: dir });
    const st = readState('kit');
    initDriver(st, { brief: 'Build it.', pipeline: ['plan', 'develop'] });
    writeState('kit', st);

    const seenKinds = [];
    const prompts = [];
    const runner = async (opts) => { prompts.push(opts.prompt); return { ok: true, output: 'ok', tokens: 1 }; };
    const atlasDigestFn = (ws) => { seenKinds.push(ws); return 'MOST-CONNECTED: src/app.js (7)'; };

    // capture prompts by wrapping the runner; we need the kind, so peek the state each call
    await drive('kit', { runner, log: () => {}, workspace: dir, atlasDigestFn });

    // plan prompt has no map; develop prompt does
    assert.equal(prompts[0].includes('## Project map'), false, 'plan stage: no map');
    assert.ok(prompts[1].includes('MOST-CONNECTED: src/app.js'), 'develop stage: map present');
    // the digest fn was only invoked for the code-bearing stage
    assert.equal(seenKinds.length, 1);
    assert.ok(CODE_BEARING_KINDS.has('develop'));
    assert.equal(CODE_BEARING_KINDS.has('plan'), false);
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- makeStageRunner: the token-spending surface (audit finding: zero coverage) ----
// spawn is injectable precisely so every branch is testable without spending.

const POLICY = { model: 'sonnet', effort: 'medium' };
function fakeSpawn(result) {
  return () => result;
}

test('makeStageRunner: a success envelope returns the deliverable and token count', async () => {
  const run = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({
      status: 0,
      stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'wrote spec.md', usage: { input_tokens: 40, output_tokens: 60 } })
    })
  });
  const out = await run({ prompt: 'go', policy: POLICY, sessionId: 's1' });
  assert.deepEqual(out, { ok: true, output: 'wrote spec.md', tokens: 100 });
});

// REGRESSION (audit 2026-07-26, finding 3.1c): the limit regex ran over the
// model's OWN answer, so a security stage recommending rate limiting — which
// Raphael's own security pack tells agents to do — halted the pipeline.
test('makeStageRunner: a deliverable that RECOMMENDS rate limiting is not a limit', async () => {
  const run = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({
      status: 0,
      stdout: JSON.stringify({
        subtype: 'success',
        is_error: false,
        result: 'Security review: you must rate-limit the auth endpoints and add a per-session limit.',
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    })
  });
  const out = await run({ prompt: 'audit', policy: POLICY, sessionId: 's2' });
  assert.equal(out.ok, true);
  assert.match(out.output, /rate-limit the auth endpoints/);
});

test('makeStageRunner: a REAL limit refusal throws E-LIMIT with reset info', async () => {
  const run = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({ status: 1, stdout: '', stderr: "You've hit your session limit · resets 5:50pm (Asia/Calcutta)" })
  });
  await assert.rejects(
    run({ prompt: 'go', policy: POLICY, sessionId: 's3' }),
    (err) => {
      assert.equal(err.code, 'E-LIMIT');
      assert.equal(err.resetText, '5:50pm');
      assert.match(err.message, /mid-stage/);
      return true;
    }
  );
});

test('makeStageRunner: spawn failure, error envelope, unparseable output, empty deliverable', async () => {
  const spawnFail = makeStageRunner({ bin: 'claude', spawn: fakeSpawn({ error: new Error('ENOENT') }) });
  assert.deepEqual(await spawnFail({ prompt: 'x', policy: POLICY, sessionId: 'a' }), {
    ok: false, timedOut: false, tokensCaptured: false, error: 'spawn failed: ENOENT', output: null, tokens: 0
  });

  // A TIMEOUT is reported distinctly, because it is an interruption with work
  // already on disk and a live session — applyStageResult resumes it (F10).
  const timedOutErr = Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const timeout = makeStageRunner({ bin: 'claude', spawn: fakeSpawn({ error: timedOutErr }), timeout: 600000 });
  const t = await timeout({ prompt: 'x', policy: POLICY, sessionId: 'a' });
  assert.equal(t.timedOut, true);
  assert.equal(t.tokensCaptured, false, 'a killed child never reports usage — never claim 0 is the real cost');
  assert.match(t.error, /10-minute budget/);
  assert.match(t.error, /work on disk is kept/);

  const errEnv = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({ status: 0, stdout: JSON.stringify({ subtype: 'error_max_turns', is_error: true, usage: { input_tokens: 5, output_tokens: 5 } }) })
  });
  const e = await errEnv({ prompt: 'x', policy: POLICY, sessionId: 'b' });
  assert.equal(e.ok, false);
  assert.match(e.error, /error_max_turns/);
  assert.equal(e.tokens, 10, 'tokens are still counted on a failed stage');

  const garbage = makeStageRunner({ bin: 'claude', spawn: fakeSpawn({ status: 0, stdout: 'not json at all' }) });
  const g = await garbage({ prompt: 'x', policy: POLICY, sessionId: 'c' });
  assert.equal(g.ok, false);
  assert.equal(g.tokens, 0);

  const empty = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({ status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: '   ' }) })
  });
  const em = await empty({ prompt: 'x', policy: POLICY, sessionId: 'd' });
  assert.deepEqual(em, { ok: false, error: 'stage produced no text deliverable', output: null, tokens: 0 });
});

test('makeStageRunner: API keys are stripped and the session flag matches resume', async () => {
  let seen = null;
  const spawn = (bin, args, opts) => {
    seen = { args, opts };
    return { status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'ok' }) };
  };
  process.env.ANTHROPIC_API_KEY = 'sk-should-be-stripped';
  try {
    const run = makeStageRunner({ bin: 'claude', spawn, workspace: os.tmpdir() });
    await run({ prompt: 'go', policy: POLICY, sessionId: 'sess-9', resume: false });
    assert.equal(seen.opts.env.ANTHROPIC_API_KEY, undefined, 'subscription billing, never metered');
    assert.equal(seen.opts.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(seen.args[seen.args.indexOf('--session-id') + 1], 'sess-9');
    assert.equal(seen.args.includes('--resume'), false);

    await run({ prompt: 'go', policy: POLICY, sessionId: 'sess-9', resume: true });
    assert.equal(seen.args[seen.args.indexOf('--resume') + 1], 'sess-9');
    assert.equal(seen.args.includes('--session-id'), false);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// --- observation run 2026-07-27: F10 / F11 / F12 / F14 -----------------------
// Measured by letting the autopilot build a real project: `develop` hit the
// ten-minute cap twice, and both times the driver recorded "failed, 0 tokens"
// while the workspace held 15 files and 49 passing tests.

function driverState(over = {}) {
  return {
    project: 'gatepost',
    driver: {
      pipeline: ['plan', 'develop', 'review'],
      stage: 1,
      brief: 'b',
      status: 'running',
      stages: { plan: { status: 'done', output: 'spec' } },
      ...over
    }
  };
}

test('F10: an interrupted stage stays resumable instead of being discarded', () => {
  const state = driverState();
  applyStageResult(state, 'develop', {
    ok: false,
    timedOut: true,
    tokensCaptured: false,
    error: 'stage exceeded its 10-minute budget and was interrupted',
    sessionId: 'sess-1',
    tokens: 0
  });

  const rec = state.driver.stages.develop;
  assert.equal(rec.status, 'running', 'a timeout must NOT be written as failed');
  assert.equal(rec.timeouts, 1);
  assert.equal(rec.tokens_captured, false, 'the killed child never reported usage — say so');
  assert.equal(state.driver.status, 'running', 'the pipeline is not dead');
  assert.equal(state.driver.stage, 1, 'and it has not advanced past the unfinished stage');

  // and the very next action must CONTINUE that session, not start a new one
  const action = nextAction(state);
  assert.equal(action.type, 'run');
  assert.equal(action.kind, 'develop');
  assert.equal(action.resumeSessionId, 'sess-1', 'must resume the interrupted session');
});

test('F10: resumes are bounded — a stage that never finishes gives up cleanly', () => {
  const state = driverState({ stages: { plan: { status: 'done' }, develop: { timeouts: 2, session_id: 'sess-1' } } });
  applyStageResult(state, 'develop', { ok: false, timedOut: true, sessionId: 'sess-1', tokens: 0, error: 'interrupted' });

  const rec = state.driver.stages.develop;
  assert.equal(rec.timeouts, 3);
  assert.equal(rec.status, 'failed', 'the third interruption stops trying');
  assert.equal(nextAction(state).type, 'failed');
});

test('F10: a genuine failure is still a failure, not a resume', () => {
  const state = driverState();
  applyStageResult(state, 'develop', { ok: false, error: 'stage produced no text deliverable', sessionId: 's', tokens: 12 });
  const rec = state.driver.stages.develop;
  assert.notEqual(rec.status, 'running', 'a real failure must never masquerade as resumable');
  assert.equal(rec.timeouts, 0);
});

test('F12: develop can escalate, so a real failure gets one stronger retry', () => {
  const state = driverState();
  applyStageResult(state, 'develop', { ok: false, error: 'boom', sessionId: 's', tokens: 5 });
  assert.equal(state.driver.stages.develop.retry_escalated, true);
  assert.equal(state.driver.stages.develop.status, 'retry');
  assert.equal(state.driver.status, 'running', 'still alive for the escalated attempt');

  const action = nextAction(state);
  assert.equal(action.policy.model, 'opus', 'the escalated pass uses the stronger model');
  assert.equal(action.resumeSessionId, null, 'a failed session is never resumed — fresh start');
});

test('F14: retryStage clears a failed stage and reports honestly when there is nothing to clear', () => {
  // success case: a failed pipeline becomes drivable again
  const failed = driverState({ status: 'failed', stages: { plan: { status: 'done' }, develop: { status: 'failed', error: 'x' } } });
  const out = retryStage(failed);
  assert.equal(out.cleared, true);
  assert.equal(out.kind, 'develop');
  assert.equal(failed.driver.status, 'running');
  assert.equal(failed.driver.stages.develop, undefined, 'the failed attempt is dropped');
  assert.equal(nextAction(failed).type, 'run', 'drive can proceed again');

  // failure case: nothing to retry is said plainly, not pretended
  const healthy = driverState();
  const noop = retryStage(healthy);
  assert.equal(noop.cleared, false);
  assert.match(noop.why, /not failed/);

  // edge: no driver at all
  assert.throws(() => retryStage({ project: 'x' }), /E-DRIVER/);
});
