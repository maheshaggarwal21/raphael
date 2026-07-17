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
  buildStageArgs,
  drive,
  renderPlan
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

    // develop has no escalation: one failure = failed driver
    const s2 = { ...readState('kit3') };
    delete s2.driver;
    initDriver(s2, { brief: 'brief', pipeline: ['develop'] });
    applyStageResult(s2, 'develop', { ok: false, error: 'boom', tokens: 1 });
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
