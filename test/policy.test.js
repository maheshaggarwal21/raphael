import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICY,
  MODELS,
  EFFORTS,
  policyKinds,
  resolvePolicy,
  resolveForAgent,
  renderPolicy,
  checkRosterAlignment
} from '../src/lib/policy.js';
import { AGENTS } from '../src/lib/agents.js';

test('the policy table is well-formed and aligned with the agent roster', () => {
  // kinds are unique
  const kinds = policyKinds();
  assert.equal(new Set(kinds).size, kinds.length);

  for (const p of POLICY) {
    // every model is a valid CLI alias (or null = CLI default)
    assert.ok(p.model === null || MODELS.includes(p.model), `${p.kind}: bad model ${p.model}`);
    assert.ok(EFFORTS.includes(p.effort), `${p.kind}: bad effort ${p.effort}`);
    if (p.escalate) {
      assert.ok(MODELS.includes(p.escalate), `${p.kind}: bad escalate ${p.escalate}`);
      // escalation must actually go somewhere different
      assert.notEqual(p.escalate, p.model, `${p.kind}: escalate equals model`);
    }
    // an agent-linked entry must name a real roster slug
    if (p.agent) assert.ok(AGENTS.some((a) => a.slug === p.agent), `${p.kind}: unknown agent ${p.agent}`);
    assert.ok(p.why && p.why.length > 10, `${p.kind}: missing why`);
  }

  // ONE definition of "which model runs this stage": the policy may not
  // contradict the roster (roster 'inherit' defers to the policy).
  assert.deepEqual(checkRosterAlignment(), []);

  // opus is never a FIRST-PASS model — only an escalation target
  assert.equal(POLICY.some((p) => p.model === 'opus'), false);
});

test('resolvePolicy: lookup, escalation, overrides, and coded errors', () => {
  const dev = resolvePolicy('develop');
  assert.equal(dev.model, 'sonnet');
  assert.equal(dev.effort, 'medium');
  assert.equal(dev.escalated, false);

  // debug escalates to the top model; kinds without an escape hatch refuse
  const hard = resolvePolicy('debug', { escalated: true });
  assert.equal(hard.model, 'opus');
  assert.equal(hard.escalated, true);
  assert.throws(() => resolvePolicy('develop', { escalated: true }), /E-POLICY.*no escalation/);

  // distill deliberately rides the CLI default model
  assert.equal(resolvePolicy('distill').model, null);

  // overrides pin a field but must be valid values
  const pinned = resolvePolicy('develop', { overrides: { model: 'opus', effort: 'low' } });
  assert.equal(pinned.model, 'opus');
  assert.equal(pinned.effort, 'low');
  assert.throws(() => resolvePolicy('develop', { overrides: { model: 'gpt' } }), /E-POLICY.*override model/);
  assert.throws(() => resolvePolicy('develop', { overrides: { effort: 'max' } }), /E-POLICY.*override effort/);

  // unknown kind = coded error that lists the valid kinds
  assert.throws(() => resolvePolicy('vibe'), /E-POLICY.*unknown task kind.*develop/);
});

test('resolveForAgent maps roster slugs; renderPolicy prints every kind', () => {
  const r = resolveForAgent('debugger');
  assert.equal(r.kind, 'debug');
  assert.equal(r.model, 'sonnet');
  assert.throws(() => resolveForAgent('poet'), /E-POLICY.*no policy for agent/);

  const table = renderPolicy();
  for (const k of policyKinds()) assert.ok(table.includes(k), `render missing ${k}`);
  assert.ok(table.includes('(cli default)')); // distill's null model shown honestly
  assert.ok(table.includes('escalation'));
});
