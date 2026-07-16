import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCliArgs,
  isLimitMessage,
  parseResetInfo,
  parseCliResult,
  callModelCLI,
  getModelCaller
} from '../src/lib/provider.js';

const SCHEMA = { type: 'object', properties: { has_lesson: { type: 'boolean' } }, required: ['has_lesson'] };

test('buildCliArgs emits contained, structured, print-mode flags — never the prompt', () => {
  const args = buildCliArgs({ model: 'claude-haiku-4-5-20251001', system: 'be terse', toolSchema: SCHEMA });
  assert.ok(args.includes('-p'));
  assert.deepEqual([args[args.indexOf('--output-format') + 1]], ['json']);
  assert.equal(args[args.indexOf('--json-schema') + 1], JSON.stringify(SCHEMA));
  assert.equal(args[args.indexOf('--tools') + 1], ''); // all built-in tools OFF
  assert.ok(args.includes('--strict-mcp-config')); // no MCP tools either
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--model') + 1], 'claude-haiku-4-5-20251001');
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'be terse');
  // the adversarial prompt must go on stdin, never the command line
  assert.equal(args.some((a) => a.includes('be terse') === false && a.length > 500), false);
});

test('isLimitMessage + parseResetInfo recognize the real limit string', () => {
  const real = "You've hit your session limit · resets 5:50pm (Asia/Calcutta)";
  assert.equal(isLimitMessage(real), true);
  assert.equal(isLimitMessage('just a normal answer about webhooks'), false);
  const { resetText, resetZone } = parseResetInfo(real);
  assert.equal(resetText, '5:50pm');
  assert.equal(resetZone, 'Asia/Calcutta');
});

test('parseCliResult reads structured_output even when result is an empty string (REAL envelope)', () => {
  // The exact shape a real `claude -p --output-format json --json-schema` run returns:
  // schema payload in structured_output, result === "". Regression for the live-run bug.
  const env = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '',
    structured_output: { ok: true, word: 'raphael' },
    total_cost_usd: 0.0073
  });
  assert.deepEqual(parseCliResult({ stdout: env, status: 0 }), { ok: true, word: 'raphael' });
});

test('parseCliResult returns the object when result is a JSON string', () => {
  const env = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ has_lesson: true }) });
  const obj = parseCliResult({ stdout: env, status: 0 });
  assert.deepEqual(obj, { has_lesson: true });
});

test('parseCliResult returns the object when result is already an object', () => {
  const env = JSON.stringify({ type: 'result', subtype: 'success', result: { has_lesson: false } });
  assert.deepEqual(parseCliResult({ stdout: env, status: 0 }), { has_lesson: false });
});

test('parseCliResult digs a JSON object out of surrounding prose', () => {
  const env = JSON.stringify({ subtype: 'success', result: 'Here is the JSON: {"has_lesson": true} — done.' });
  assert.deepEqual(parseCliResult({ stdout: env, status: 0 }), { has_lesson: true });
});

test('parseCliResult throws E-LIMIT (with reset info) on a subscription limit', () => {
  try {
    parseCliResult({ stdout: '', stderr: "You've hit your session limit · resets 5:50pm (Asia/Calcutta)", status: 1 });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'E-LIMIT');
    assert.equal(err.resetText, '5:50pm');
    assert.equal(err.resetZone, 'Asia/Calcutta');
  }
});

test('parseCliResult throws E-MODEL on an error envelope and on unparseable output', () => {
  const errEnv = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true });
  assert.throws(() => parseCliResult({ stdout: errEnv, status: 0 }), /E-MODEL/);
  assert.throws(() => parseCliResult({ stdout: 'not json', status: 2, stderr: 'boom' }), /E-MODEL/);
});

test('callModelCLI passes the prompt on stdin and strips ANTHROPIC_API_KEY from child env', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-be-passed';
  let seen;
  const fakeSpawn = (bin, args, opts) => {
    seen = { bin, args, opts };
    return { status: 0, stdout: JSON.stringify({ subtype: 'success', result: { has_lesson: true } }), stderr: '' };
  };
  const obj = await callModelCLI(
    { model: 'sonnet', system: 's', prompt: 'ADVERSARIAL EPISODE TEXT', toolSchema: SCHEMA },
    { spawn: fakeSpawn, bin: 'claude', cwd: '/tmp' }
  );
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(obj, { has_lesson: true });
  assert.equal(seen.opts.input, 'ADVERSARIAL EPISODE TEXT'); // stdin, not argv
  assert.equal(seen.opts.env.ANTHROPIC_API_KEY, undefined); // forced subscription auth
});

test('callModelCLI surfaces E-LIMIT from the spawned output', async () => {
  const fakeSpawn = () => ({ status: 1, stdout: '', stderr: "You've hit your session limit · resets 5:50pm (Asia/Calcutta)" });
  await assert.rejects(
    callModelCLI({ model: 'sonnet', system: 's', prompt: 'x', toolSchema: SCHEMA }, { spawn: fakeSpawn, bin: 'claude' }),
    /E-LIMIT/
  );
});

test('callModelCLI maps spawn timeout to E-MODEL', async () => {
  const fakeSpawn = () => ({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) });
  await assert.rejects(
    callModelCLI({ model: 'sonnet', system: 's', prompt: 'x', toolSchema: SCHEMA }, { spawn: fakeSpawn, bin: 'claude' }),
    /E-MODEL: claude timed out/
  );
});

test('getModelCaller: subscription preferred, api fallback, explicit overrides, hard failure', () => {
  const cli = async () => ({ from: 'cli' });
  const api = async () => ({ from: 'api' });
  const deps = (hasCli, hasKey) => ({
    hasClaudeCli: () => hasCli,
    apiKey: () => (hasKey ? 'sk-x' : null),
    callModelCLI: cli,
    callModel: api
  });

  // auto: CLI present -> subscription
  let r = getModelCaller({}, deps(true, true));
  assert.equal(r.provider, 'subscription');

  // auto: no CLI, key present -> api
  r = getModelCaller({}, deps(false, true));
  assert.equal(r.provider, 'api');

  // auto: neither -> throw
  assert.throws(() => getModelCaller({}, deps(false, false)), /E-NOPROVIDER/);

  // explicit subscription without CLI -> throw
  assert.throws(() => getModelCaller({ model: { provider: 'subscription' } }, deps(false, true)), /E-NOPROVIDER/);

  // explicit api without key -> throw
  assert.throws(() => getModelCaller({ model: { provider: 'api' } }, deps(true, false)), /E-NOPROVIDER/);
});

test('getModelCaller: a call carrying timeoutMs reaches the CLI transport as its timeout', async () => {
  let seenOpts = null;
  const r = getModelCaller({}, {
    hasClaudeCli: () => true,
    apiKey: () => null,
    callModelCLI: async (call, opts) => { seenOpts = opts; return { ok: true }; },
    callModel: async () => ({})
  });
  await r.callModel({ prompt: 'x', toolSchema: {}, timeoutMs: 240000 });
  assert.equal(seenOpts.timeout, 240000);
  // and calls WITHOUT timeoutMs keep the transport default (no override passed)
  await r.callModel({ prompt: 'x', toolSchema: {} });
  assert.deepEqual(seenOpts, {});
});

test('the caller returned by getModelCaller actually invokes the chosen backend', async () => {
  const cli = async (o) => ({ echoed: o.prompt, via: 'cli' });
  const r = getModelCaller(
    { model: { provider: 'subscription' } },
    { hasClaudeCli: () => true, apiKey: () => null, callModelCLI: cli, callModel: async () => ({}) }
  );
  const out = await r.callModel({ prompt: 'hello' });
  assert.deepEqual(out, { echoed: 'hello', via: 'cli' });
});
