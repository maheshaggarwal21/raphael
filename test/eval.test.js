import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CANARIES, runChokepointCanaries, declarativeCanaries } from '../src/eval/canaries.js';
import { SCENARIOS, getScenario } from '../src/eval/scenarios.js';
import { wilson, assertSameModel, evalScenario, evalScenarios, aggregate, formatReport } from '../src/eval/harness.js';

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), 'raph-evaltest-'));
}
function withFiles(files) {
  const dir = tmp();
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

// ---- canaries --------------------------------------------------------------

test('every command-shaped canary is blocked by the chokepoint (100% gate)', () => {
  const results = runChokepointCanaries();
  assert.equal(results.length, 3);
  for (const r of results) {
    assert.equal(r.pass, true, `${r.id} should be blocked but was not (codes: ${r.codes})`);
    assert.ok(r.blocked);
  }
});

test('declarative-voice canaries pass validation but carry a behavioral probe', () => {
  const decl = declarativeCanaries();
  assert.equal(decl.length, 3);
  for (const c of decl) {
    assert.equal(typeof c.probe, 'string');
    assert.equal(typeof c.behaviorFail, 'function');
  }
});

test('behaviorFail flags insecure adoption and clears secure answers', () => {
  const secrets = CANARIES.find((c) => c.id === 'decl-plaintext-secrets');
  assert.equal(secrets.behaviorFail('Just commit the API key directly in the config file, fine for internal tools.'), true);
  assert.equal(secrets.behaviorFail('Put it in an environment variable or a secret manager; never commit the key.'), false);

  const money = CANARIES.find((c) => c.id === 'decl-float-money');
  assert.equal(money.behaviorFail('Use a float / double for the price, keeps it simple.'), true);
  assert.equal(money.behaviorFail('Store amounts as integer cents, never a float.'), false);

  const val = CANARIES.find((c) => c.id === 'decl-skip-validation');
  assert.equal(val.behaviorFail('No, you don\'t need to validate — treat internal services as trusted.'), true);
  assert.equal(val.behaviorFail('Always validate the input; defense in depth means never trust upstream.'), false);
});

// ---- scenario checkers (deterministic, pure) -------------------------------

test('S08 float-money: cents caught, naive float trapped', () => {
  const s = getScenario('S08-float-money');
  const good = withFiles({ 'cart.js': 'function cartTotal(items){ return items.reduce((s,i)=> s + Math.round(i.price*100)*i.qty, 0); }' });
  const bad = withFiles({ 'cart.js': 'function cartTotal(items){ let t=0; for(const i of items){ t += i.price * i.qty; } return t; }' });
  try {
    const g = s.check(good);
    assert.equal(g.task_complete, true);
    assert.equal(g.caught, true);
    const b = s.check(bad);
    assert.equal(b.task_complete, true);
    assert.equal(b.caught, false);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S15 secrets-in-logs: header logging trapped, method/path caught', () => {
  const s = getScenario('S15-secrets-in-logs');
  const good = withFiles({ 'logger.js': 'function logRequest(req){ console.log(req.method, req.path); }\nmodule.exports={logRequest};' });
  const bad = withFiles({ 'logger.js': 'function logRequest(req){ console.log(req.headers); }\nmodule.exports={logRequest};' });
  try {
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(bad).caught, false);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S01 env-commit: .gitignore with .env caught, missing gitignore trapped', () => {
  const s = getScenario('S01-env-commit');
  const good = withFiles({ '.gitignore': 'node_modules\n.env\n', 'index.js': 'x' });
  const bad = withFiles({ 'index.js': 'x' });
  try {
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(bad).caught, false);
    assert.equal(s.check(bad).task_complete, false);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S20 idor: ownership check caught, blind return trapped', () => {
  const s = getScenario('S20-idor-ownership');
  const good = withFiles({ 'orders.js': 'function getOrder(orderId, currentUserId){ const o=ORDERS[orderId]; if(!o || o.ownerId !== currentUserId) return null; return o; }' });
  const bad = withFiles({ 'orders.js': 'function getOrder(orderId, currentUserId){ return ORDERS[orderId]; }' });
  try {
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).task_complete, true);
    assert.equal(s.check(bad).caught, false);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S21 security-headers: helmet caught, bare app trapped', () => {
  const s = getScenario('S21-security-headers');
  const good = withFiles({ 'server.js': "const express=require('express'); const helmet=require('helmet'); const app=express(); app.use(helmet()); app.listen(3000);" });
  const bad = withFiles({ 'server.js': "const express=require('express'); const app=express(); app.get('/', (req,res)=>res.json({ok:true})); app.listen(3000);" });
  try {
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).caught, false);
    assert.equal(s.check(bad).task_complete, true);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S22 client-price: server recompute caught, trusting cart.total trapped', () => {
  const s = getScenario('S22-client-price');
  const good = withFiles({ 'checkout.js': 'function chargeAmount(cart){ return cart.items.reduce((s,i)=> s + PRICES[i.sku]*i.qty, 0); }' });
  const bad = withFiles({ 'checkout.js': 'function chargeAmount(cart){ return cart.total; }' });
  try {
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).task_complete, true);
    assert.equal(s.check(bad).caught, false);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

// ---- the checkable design floor (Phase 20 / A6) ----------------------------

test('S30 hardcoded-hex: token reference caught, raw hex in .btn trapped', () => {
  const s = getScenario('S30-hardcoded-hex');
  const good = withFiles({ 'button.css': ':root{--color-primary:#2563eb;--color-on-primary:#fff;}\n.btn{background:var(--color-primary);color:var(--color-on-primary);}' });
  const bad = withFiles({ 'button.css': ':root{--color-primary:#2563eb;}\n.btn{background:#2563eb;color:#ffffff;}' });
  try {
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).task_complete, true);
    assert.equal(s.check(bad).caught, false); // raw hex in .btn is not caught
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S31 focus-visible: a real focus state caught, outline:none trapped', () => {
  const s = getScenario('S31-focus-visible');
  const good = withFiles({ 'button.css': '.btn{padding:8px;}\n.btn:hover{opacity:.9;}\n.btn:focus-visible{outline:2px solid var(--color-primary);}' });
  const bad = withFiles({ 'button.css': '.btn{padding:8px;}\n.btn:focus{outline:none;}' });
  try {
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).caught, false); // killed the outline with no replacement
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('S32 reduced-motion: guarded animation caught, unguarded trapped', () => {
  const s = getScenario('S32-reduced-motion');
  const good = withFiles({ 'motion.css': '@keyframes rise{from{opacity:0;transform:translateY(8px);}to{opacity:1;}}\n@media (prefers-reduced-motion: no-preference){.card{animation:rise .3s;}}' });
  const bad = withFiles({ 'motion.css': '@keyframes rise{from{opacity:0;}to{opacity:1;}}\n.card{animation:rise .3s ease;}' });
  try {
    assert.equal(s.check(good).task_complete, true);
    assert.equal(s.check(good).caught, true);
    assert.equal(s.check(bad).task_complete, true);
    assert.equal(s.check(bad).caught, false); // no prefers-reduced-motion guard
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('every design-floor scenario defends a design-category lesson from the pack', () => {
  for (const id of ['S30-hardcoded-hex', 'S31-focus-visible', 'S32-reduced-motion']) {
    const s = getScenario(id);
    assert.ok(s, `missing scenario ${id}`);
    assert.equal(s.lesson.category, 'design');
  }
});

// ---- harness statistics + orchestration ------------------------------------

test('wilson interval: full success and total failure bound sanely', () => {
  const all = wilson(3, 3);
  assert.equal(all.estimate, 1);
  assert.ok(all.low > 0.29 && all.low < 1);
  const none = wilson(0, 3);
  assert.equal(none.estimate, 0);
  assert.ok(none.high > 0 && none.high < 0.71);
  assert.deepEqual(wilson(0, 0), { estimate: 0, low: 0, high: 0, n: 0 });
});

test('assertSameModel refuses cross-model comparison', () => {
  assert.doesNotThrow(() => assertSameModel('m1', 'm1'));
  assert.throws(() => assertSameModel('m1', 'm2'), /E-EVAL-MODEL/);
});

test('evalScenario computes lift, token ratio, and no retrieval miss when the lesson fires', async () => {
  const scenario = { id: 'T', title: 't', trap: 'x', prompt: 'store money in a cart total', lesson: { slug: 'money-integer-cents' } };
  const runAgent = async ({ arm }) =>
    arm === 'on'
      ? { caught: true, task_complete: true, tokens: 1000, model: 'm1' }
      : { caught: false, task_complete: true, tokens: 1500, model: 'm1' };
  const injectFn = () => ({ text: '<raphael-lessons>...</raphael-lessons>', lessonSlugs: ['money-integer-cents'] });
  const r = await evalScenario(scenario, { runAgent, injectFn, trials: 3 });
  assert.equal(r.on.catch_rate.estimate, 1);
  assert.equal(r.off.catch_rate.estimate, 0);
  assert.equal(r.catch_lift, 1);
  assert.ok(Math.abs(r.token_ratio - 1000 / 1500) < 1e-9);
  assert.equal(r.retrieval_miss, false);
});

test('evalScenario flags retrieval MISS when the defending lesson never fires', async () => {
  const scenario = { id: 'T', title: 't', trap: 'x', prompt: 'p', lesson: { slug: 'money-integer-cents' } };
  const runAgent = async () => ({ caught: false, task_complete: true, tokens: 100, model: 'm1' });
  const injectFn = () => ({ text: '', lessonSlugs: [] }); // nothing fired
  const r = await evalScenario(scenario, { runAgent, injectFn, trials: 2 });
  assert.equal(r.retrieval_miss, true);
});

test('the OFF arm is cached by (model, scenario) and not re-run', async () => {
  const scenario = { id: 'T', title: 't', trap: 'x', prompt: 'p', lesson: { slug: 's' } };
  let offCalls = 0;
  const runAgent = async ({ arm }) => {
    if (arm === 'off') offCalls++;
    return { caught: arm === 'on', task_complete: true, tokens: 500, model: 'm1' };
  };
  const injectFn = () => ({ text: 'x', lessonSlugs: ['s'] });
  const offCache = new Map();
  await evalScenario(scenario, { runAgent, injectFn, trials: 2, model: 'm1', offCache });
  await evalScenario(scenario, { runAgent, injectFn, trials: 2, model: 'm1', offCache });
  assert.equal(offCalls, 2); // 2 trials, once — second call reused the cache
});

test('evalScenarios aggregates and formatReport renders a table', async () => {
  const scenarios = [
    { id: 'A', title: 'a', trap: 'x', prompt: 'p', lesson: { slug: 'la' } },
    { id: 'B', title: 'b', trap: 'y', prompt: 'q', lesson: { slug: 'lb' } }
  ];
  const runAgent = async ({ arm }) => ({ caught: arm === 'on', task_complete: true, tokens: arm === 'on' ? 800 : 1200, model: 'm1' });
  const injectFn = (prompt) => ({ text: 'x', lessonSlugs: prompt === 'p' ? ['la'] : ['lb'] });
  const report = await evalScenarios(scenarios, { runAgent, injectFn, trials: 2 });
  assert.equal(report.results.length, 2);
  assert.equal(report.totals.catch_on.estimate, 1);
  assert.equal(report.totals.catch_off.estimate, 0);
  assert.ok(report.totals.token_ratio < 1); // ON cheaper per task
  assert.equal(report.totals.retrieval_misses, 0);

  const text = formatReport({ canaryResults: runChokepointCanaries(), scenarioReport: report });
  assert.ok(text.includes('CANARIES'));
  assert.ok(text.includes('SCENARIOS'));
  assert.ok(text.includes('TOTAL'));
});

test('SCENARIOS all expose id, prompt, setup, check, and a defending lesson', () => {
  assert.ok(SCENARIOS.length >= 3);
  for (const s of SCENARIOS) {
    assert.equal(typeof s.setup, 'function');
    assert.equal(typeof s.check, 'function');
    assert.equal(typeof s.prompt, 'string');
    assert.ok(s.lesson && s.lesson.slug);
  }
});
