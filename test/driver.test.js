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
  parseDecisions,
  gateDeliverable,
  buildStageArgs,
  drive,
  renderPlan,
  CODE_BEARING_KINDS,
  VERIFIED_KINDS,
  runVerify,
  makeStageRunner
} from '../src/lib/driver.js';
import { startProject, readState, writeState } from '../src/lib/academy.js';
import { resolvePolicy } from '../src/lib/policy.js';

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
      stdout: JSON.stringify({
        subtype: 'success',
        is_error: false,
        // Deliverables must satisfy the DECISIONS contract now — "non-empty text"
        // is no longer a completion test (that was F4's mechanism).
        result: 'wrote spec.md\n\n## DECISIONS\n- none',
        usage: { input_tokens: 40, output_tokens: 60 }
      })
    })
  });
  const out = await run({ prompt: 'go', policy: POLICY, sessionId: 's1' });
  assert.equal(out.ok, true);
  assert.equal(out.tokens, 100);
  assert.deepEqual(out.decisions, []);
  assert.equal(out.tokensCaptured, true);
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
        result: 'Security review: you must rate-limit the auth endpoints and add a per-session limit.\n\n## DECISIONS\n- Rate limit at the edge — cheaper than per-route',
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
    ok: false, timedOut: false, tokensCaptured: false, elapsedMs: 0, error: 'spawn failed: ENOENT', output: null, tokens: 0
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
  assert.deepEqual(em, { ok: false, elapsedMs: 0, tokensCaptured: true, error: 'stage produced no text deliverable', output: null, tokens: 0 });
});

test('makeStageRunner: API keys are stripped and the session flag matches resume', async () => {
  let seen = null;
  const spawn = (bin, args, opts) => {
    seen = { args, opts };
    return { status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'ok\n\n## DECISIONS\n- none' }) };
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

// --- Loop Engineering: the deliverable gate + decisions contract (F4) --------
// "No gate, no real loop." The driver's success test was "non-empty text", which
// is how a planner's clarifying question was accepted as a finished spec and
// handed to the architect as its input.

test('parseDecisions: finds the section, tolerates formatting, and reports absence', () => {
  // success: ordinary bullets
  assert.deepEqual(
    parseDecisions('spec body\n\n## DECISIONS\n- Chose stateless hashing — no stored state\n- SQLite over JSON — concurrent writes\n'),
    ['Chose stateless hashing — no stored state', 'SQLite over JSON — concurrent writes']
  );

  // explicit "none" is a valid answer, not a missing section
  assert.deepEqual(parseDecisions('body\n## DECISIONS\n- none\n'), []);
  assert.deepEqual(parseDecisions('body\n## Decisions:\n- N/A\n'), []);

  // absence is the failure the gate acts on — distinct from an empty list
  assert.equal(parseDecisions('a spec with no such section'), null);
  assert.equal(parseDecisions(''), null);
  assert.equal(parseDecisions(undefined), null);

  // the LAST heading wins: a deliverable may quote the contract before answering it
  assert.deepEqual(
    parseDecisions('## DECISIONS\n- quoted requirement\n\n# Spec\n\n## DECISIONS\n- the real one\n'),
    ['the real one']
  );

  // stops at the next heading, accepts *, +, and numbered bullets
  assert.deepEqual(
    parseDecisions('## DECISIONS\n* one\n+ two\n1. three\n\n## Appendix\n- not a decision\n'),
    ['one', 'two', 'three']
  );

  // edge: capped, and long items truncated rather than unbounded
  const many = '## DECISIONS\n' + Array.from({ length: 40 }, (_, i) => `- d${i}`).join('\n');
  assert.equal(parseDecisions(many).length, 12);
  assert.equal(parseDecisions('## DECISIONS\n- ' + 'x'.repeat(900)).at(0).length, 300);
});

test('gateDeliverable: a question fails the gate, a real deliverable passes', () => {
  // THE F4 CASE, near-verbatim from the run that failed: the planner ended by
  // asking which rollout model to use. This used to score ok:true and advance.
  const question = [
    'Fresh project, no prior memory.',
    '',
    'One sharp question before I finalise:',
    '',
    '**The percentage rollout** — what determines which 50% a user is in?',
    '(A) Stateless deterministic  (B) Stateful sticky  (C) Pure random',
    '',
    'The answer shapes the entire flag-evaluation interface. Which model do you want?'
  ].join('\n');
  const bad = gateDeliverable(question);
  assert.equal(bad.ok, false);
  assert.match(bad.why, /DECISIONS/);
  assert.deepEqual(bad.decisions, []);

  // the same stage, having decided instead of asked, passes and yields the record
  const good = gateDeliverable('# Spec\n...\n\n## DECISIONS\n- Stateless deterministic hashing — no stored state, caller passes entityId\n');
  assert.equal(good.ok, true);
  assert.equal(good.decisions.length, 1);
  assert.match(good.decisions[0], /Stateless deterministic/);

  // edge: a deliverable that made no judgement calls is still complete
  const none = gateDeliverable('# Spec\n\n## DECISIONS\n- none\n');
  assert.equal(none.ok, true);
  assert.deepEqual(none.decisions, []);
});

test('the stage prompt carries the no-human rule and the decisions contract', () => {
  const prompt = renderStagePrompt('plan', { project: 'p', brief: 'b', input: 'b', priorKind: null });
  assert.match(prompt, /NO HUMAN in this loop/);
  assert.match(prompt, /Never end by asking for clarification/);
  assert.match(prompt, /## DECISIONS/);
  // deciding for yourself must never read as permission to cross the boundary
  assert.match(prompt, /never authorises a deploy/);
});

test('decisions and honesty markers land on the stage record', () => {
  const state = driverState();
  applyStageResult(state, 'develop', {
    ok: true,
    output: 'x',
    decisions: ['Chose SQLite — concurrent writes'],
    tokens: 100,
    tokensCaptured: true,
    elapsedMs: 4000,
    sessionId: 's'
  });
  const rec = state.driver.stages.develop;
  assert.deepEqual(rec.decisions, ['Chose SQLite — concurrent writes']);
  assert.equal(rec.tokens_captured, true);
  assert.equal(rec.elapsed_ms, 4000);

  // a stage whose cost was never measured says so, instead of storing a bare 0
  const s2 = driverState();
  applyStageResult(s2, 'develop', { ok: false, timedOut: true, tokensCaptured: false, elapsedMs: 600000, sessionId: 's', tokens: 0 });
  applyStageResult(s2, 'develop', { ok: false, timedOut: true, tokensCaptured: false, elapsedMs: 600000, sessionId: 's', tokens: 0 });
  applyStageResult(s2, 'develop', { ok: false, timedOut: true, tokensCaptured: false, elapsedMs: 600000, sessionId: 's', tokens: 0 });
  const dead = s2.driver.stages.develop;
  assert.equal(dead.status, 'failed');
  assert.equal(dead.tokens_captured, false, 'the terminal branch must carry the marker too');
  assert.equal(dead.elapsed_ms, 1800000, 'duration accumulates across passes even when tokens cannot');
});

test('develop gets a longer clock than the default; other kinds do not invent one', () => {
  assert.equal(resolvePolicy('develop').timeoutMs, 1500000);   // 25 minutes, measured
  assert.equal(resolvePolicy('plan').timeoutMs, undefined);    // falls back to the driver default
  assert.equal(resolvePolicy('review').timeoutMs, undefined);
});

test('the runner REJECTS a deliverable that is really a question (F4, end to end)', async () => {
  // The pure gate is tested above; this proves makeStageRunner actually CALLS it.
  // Without this the gate could be deleted from the runner and every other test
  // would still pass — which is what happened on the first attempt.
  const question = 'One sharp question before I finalise: which rollout model do you want, A, B or C?';
  const asked = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({
      status: 0,
      stdout: JSON.stringify({ subtype: 'success', is_error: false, result: question, usage: { input_tokens: 10, output_tokens: 20 } })
    })
  });
  const r = await asked({ prompt: 'x', policy: POLICY, sessionId: 'q1' });
  assert.equal(r.ok, false, 'a question must not pass as a completed stage');
  assert.equal(r.gateFailed, true);
  assert.match(r.error, /DECISIONS/);
  assert.equal(r.tokens, 30, 'the tokens it burned are still counted');

  // the same stage, having decided instead, passes and surfaces its decisions
  const decided = makeStageRunner({
    bin: 'claude',
    spawn: fakeSpawn({
      status: 0,
      stdout: JSON.stringify({
        subtype: 'success',
        is_error: false,
        result: 'THE SPEC\n\n## DECISIONS\n- Stateless deterministic rollout — no stored state',
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    })
  });
  const ok = await decided({ prompt: 'x', policy: POLICY, sessionId: 'q2' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.decisions, ['Stateless deterministic rollout — no stored state']);
});

// --- the SECOND gate: the owner's verifier (observed 2026-07-27) -------------
// The `test` stage reported "135 total tests", walked through parseBody in its
// own deliverable and ticked it, satisfied the DECISIONS contract, and was
// marked done — while `npm test` failed on exactly that function. The contract
// gate checks a deliverable's SHAPE; only running the project checks its CLAIM.

test('runVerify: green passes, red fails with scrubbed output, absent is a no-op', () => {
  // success: exit 0
  const green = runVerify('npm test', { cwd: '/w', spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }) });
  assert.deepEqual(green, { ran: true, ok: true, detail: null });

  // failure: non-zero exit is reported with the tail of the output
  const red = runVerify('npm test', {
    cwd: '/w',
    spawn: () => ({ status: 1, stdout: 'not ok 1 - parses valid JSON', stderr: '' })
  });
  assert.equal(red.ran, true);
  assert.equal(red.ok, false);
  assert.match(red.detail, /exited 1/);
  assert.match(red.detail, /parses valid JSON/);

  // SECRETS: a failing test can print an env var, and this lands in state.json
  // and in the next prompt (invariant #2).
  const leaky = runVerify('npm test', {
    cwd: '/w',
    spawn: () => ({ status: 1, stdout: 'FAIL: AWS_SECRET_ACCESS_KEY=' + 'A'.repeat(40), stderr: '' })
  });
  assert.equal(leaky.ok, false);
  assert.equal(leaky.detail.includes('A'.repeat(40)), false, 'the raw secret must not reach state.json');

  // no verifier configured = no-op that never blocks a stage
  assert.deepEqual(runVerify(null, { cwd: '/w' }), { ran: false, ok: true, detail: null });
  assert.deepEqual(runVerify('   ', { cwd: '/w' }), { ran: false, ok: true, detail: null });

  // edge: the verifier itself cannot run
  const broken = runVerify('nope', { cwd: '/w', spawn: () => ({ error: new Error('ENOENT') }) });
  assert.equal(broken.ok, false);
  assert.match(broken.detail, /could not run/);
});

test('a stage that claims success but fails the verifier does NOT advance', async () => {
  const dir = sandbox();
  try {
    startProject('vk', { title: 'VK', workspace: dir });
    const state = readState('vk');
    initDriver(state, { brief: 'b', pipeline: ['develop', 'review'], verify: 'npm test' });
    assert.equal(state.driver.verify, 'npm test', 'the command is stored from the FLAG, not from stage output');
    writeState('vk', state);

    // the runner reports a clean, contract-satisfying deliverable...
    const runner = async () => ({ ok: true, output: 'built it\n\n## DECISIONS\n- none', tokens: 10, decisions: [] });
    // ...but this project's suite is red. Without the verifier this stage advances.
    const out = await drive('vk', {
      runner,
      log: () => {},
      workspace: dir,
      verifyFn: () => ({ ran: true, ok: false, detail: 'verifier exited 1:\nnot ok 1' })
    });

    const s = readState('vk');
    assert.equal(s.driver.stages.develop.status !== 'done', true, 'a red suite must not be recorded as a completed stage');
    assert.match(s.driver.stages.develop.error ?? '', /verifier disagreed/);
    assert.notEqual(out.stopped, 'done');
  } finally {
    delete process.env.RAPHAEL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the verifier only judges code-bearing stages, and only when configured', () => {
  assert.equal(VERIFIED_KINDS.has('develop'), true);
  assert.equal(VERIFIED_KINDS.has('test'), true);
  // advisory passes must not be failed for a defect they did not introduce
  assert.equal(VERIFIED_KINDS.has('review'), false);
  assert.equal(VERIFIED_KINDS.has('security'), false);
  assert.equal(VERIFIED_KINDS.has('plan'), false);
});

test('tokens_captured is sticky-false once any pass went unmeasured', () => {
  // Observed live: `test` was killed at 600s (nothing reported), resumed, then
  // finished — and the record claimed captured:true over a second-pass-only total.
  const state = driverState();
  applyStageResult(state, 'develop', { ok: false, timedOut: true, tokensCaptured: false, elapsedMs: 600000, sessionId: 's', tokens: 0 });
  assert.equal(state.driver.stages.develop.tokens_captured, false);

  applyStageResult(state, 'develop', { ok: true, output: 'x\n\n## DECISIONS\n- none', tokensCaptured: true, elapsedMs: 300000, sessionId: 's', tokens: 24176, decisions: [] });
  assert.equal(
    state.driver.stages.develop.tokens_captured,
    false,
    'a partial total must not advertise itself as complete'
  );
  assert.equal(state.driver.stages.develop.status, 'done', 'the stage still succeeded — only the COST is unknown');
});

// --- F9 (absorb): steer agents to the sanctioned channel, not the host's ------
// Observed 2026-07-27: an architect stage wrote its decisions to Claude Code's
// own project-memory files (~/.claude/projects/<p>/memory/*.md) — a store that
// lives outside the workspace, outside Raphael, has no chokepoint, no scrubbing,
// and no review, and survived both a workspace wipe and an academy state reset.
// A later run read it back and built on it. Absorb = give the sanctioned
// DECISIONS channel explicit priority so there is no reason to reach for the
// other one.
test('F9: the boundary explicitly steers decisions away from host memory tools', () => {
  const p = renderStagePrompt('plan', { project: 'p', brief: 'b', input: 'b', priorKind: null });
  assert.match(p, /memory\/note-taking tools/);
  assert.match(p, /outside this directory/i);
  assert.match(p, /DECISIONS section below is what the next stage reads/);
});
