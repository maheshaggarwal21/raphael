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
  checkRosterAlignment,
  canEscalate,
  toolsFor,
  VERIFIED_KINDS,
  CODE_BEARING_KINDS,
  FIRST_PASS_OPUS_KINDS
} from '../src/lib/policy.js';
import { AGENTS } from '../src/lib/agents.js';
import { DRIVER_FORBIDDEN_KINDS } from '../src/lib/graph.js';

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

  // opus as a FIRST-PASS model is a DELIBERATE, NAMED exception — not casual.
  // Every kind actually running opus as its base model must be listed in
  // FIRST_PASS_OPUS_KINDS, and every kind IN that list must actually run opus:
  // set equality both ways, so a future kind cannot slip onto opus by editing
  // only POLICY (silent cost growth) or sit in the exception list unused
  // (a stale, misleading exception).
  const opusFirstPass = new Set(POLICY.filter((p) => p.model === 'opus').map((p) => p.kind));
  assert.deepEqual(opusFirstPass, FIRST_PASS_OPUS_KINDS,
    'opus as a first-pass model must be exactly the declared exception set');
});

test('FIRST_PASS_OPUS_KINDS is the named exception it claims to be', () => {
  // success: the current, owner-approved exception is exactly architect
  assert.deepEqual(FIRST_PASS_OPUS_KINDS, new Set(['architect']));
  // failure/edge: every member must resolve to a real kind that actually
  // carries opus — a typo'd or stale entry would silently do nothing
  for (const kind of FIRST_PASS_OPUS_KINDS) {
    assert.ok(policyKinds().includes(kind), `${kind} is not a real policy kind`);
    assert.equal(resolvePolicy(kind).model, 'opus', `${kind} is listed as a first-pass-opus exception but does not resolve to opus`);
  }
});

test('resolvePolicy: lookup, escalation, overrides, and coded errors', () => {
  const dev = resolvePolicy('develop');
  assert.equal(dev.model, 'sonnet');
  assert.equal(dev.effort, 'medium');
  assert.equal(dev.escalated, false);

  // debug and develop escalate to the top model; kinds without an escape hatch refuse.
  // (develop gained an escalation target in F12 — it is the bulk tier and the one
  // stage that actually fails, so "the retry ladder cannot help it" was backwards.
  // `review` still has none, and stands in as the fails-fast case.)
  const hard = resolvePolicy('debug', { escalated: true });
  assert.equal(hard.model, 'opus');
  assert.equal(hard.escalated, true);
  assert.equal(resolvePolicy('develop', { escalated: true }).model, 'opus');
  assert.throws(() => resolvePolicy('review', { escalated: true }), /E-POLICY.*no escalation/);

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

// ---- 23.2: the tool grant ----------------------------------------------------

test('a driver stage never exceeds its agent\'s reviewed tool set', () => {
  // THE guarantee of this milestone. Before it, buildStageArgs emitted
  // acceptEdits and no --tools, so these three read-only roster agents were
  // handed Edit/Write/Bash inside the driver — a design agent could silently fix
  // the code it was reviewing, which makes a review loop meaningless.
  for (const kind of ['design', 'critique', 'plan']) {
    const { tools } = resolvePolicy(kind);
    for (const forbidden of ['Edit', 'Write', 'Bash']) {
      assert.equal(tools.includes(forbidden), false, `${kind} must not be granted ${forbidden}`);
    }
    assert.ok(tools.includes('Read'), `${kind} still reads`);
  }
  // and the builders keep what they need
  for (const kind of ['develop', 'frontend', 'debug']) {
    const { tools } = resolvePolicy(kind);
    for (const needed of ['Edit', 'Write']) {
      assert.ok(tools.includes(needed), `${kind} needs ${needed} to do its job`);
    }
  }
});

test('tools come FROM the roster for every agent kind — they cannot drift', () => {
  // Sourced, not copied: if these were two lists, a roster change would silently
  // leave the driver granting the old set.
  let checked = 0;
  for (const p of POLICY) {
    if (!p.agent) continue;
    const agent = AGENTS.find((a) => a.slug === p.agent);
    assert.deepEqual(resolvePolicy(p.kind).tools, agent.tools, `${p.kind} must mirror the ${p.agent} agent`);
    checked += 1;
  }
  assert.ok(checked >= 8, 'most kinds map to a roster agent');
});

test('toolsFor: literal lists for agentless kinds, and a loud failure on a missing agent', () => {
  assert.deepEqual(toolsFor({ kind: 'x', agent: null, tools: ['Read'] }), ['Read']);
  // Empty is MEANINGFUL — it maps to `--tools ""`, every built-in tool off.
  assert.deepEqual(resolvePolicy('distill').tools, []);
  // A silent [] here would look like containment while actually being a typo.
  assert.throws(
    () => toolsFor({ kind: 'x', agent: 'no-such-agent' }),
    /E-POLICY: task kind "x" names agent "no-such-agent"/
  );
  // Edge: no agent and no list at all still yields a list, never undefined.
  assert.deepEqual(toolsFor({ kind: 'x', agent: null }), []);
});

test('resolvePolicy returns a COPY of the tool list, not the roster\'s array', () => {
  const first = resolvePolicy('design').tools;
  first.push('Write');
  assert.equal(resolvePolicy('design').tools.includes('Write'), false, 'a caller must not be able to widen the roster');
});

// ---- 23.2: the frontend kind, and the one that stays out ---------------------

test('frontend is drivable and maps to the frontend agent', () => {
  // The governed path could not run this agent at all before 23.2, so the
  // autopilot built every UI with the general developer agent.
  const p = resolvePolicy('frontend');
  assert.equal(p.agent, 'frontend');
  assert.ok(AGENTS.some((a) => a.slug === 'frontend'));
  assert.equal(canEscalate('frontend'), false, 'a stronger model is not what fixes taste');
});

test('redteam is deliberately NOT a policy kind — POLICY membership is what makes a kind drivable', () => {
  assert.equal(policyKinds().includes('redteam'), false);
  assert.ok(DRIVER_FORBIDDEN_KINDS.has('redteam'));
  assert.throws(() => resolvePolicy('redteam'), /E-POLICY: unknown task kind/);
  // The roster still ships it — it stays reachable where a human is.
  assert.ok(AGENTS.some((a) => a.slug === 'redteam'), 'the agent exists, it is just not drivable unattended');
});

// ---- 23.2: the kind sets cannot drift from POLICY ----------------------------

test('every member of the kind sets is a real policy kind', () => {
  // 23.2 pruned implement/refactor/qa: they were never POLICY kinds, so they
  // could never fire — three dead entries implying coverage that did not exist.
  // This test is what stops them coming back.
  const kinds = new Set(policyKinds());
  for (const kind of VERIFIED_KINDS) assert.ok(kinds.has(kind), `VERIFIED_KINDS member "${kind}" is not a policy kind`);
  for (const kind of CODE_BEARING_KINDS) assert.ok(kinds.has(kind), `CODE_BEARING_KINDS member "${kind}" is not a policy kind`);
  for (const dead of ['implement', 'refactor', 'qa']) {
    assert.equal(VERIFIED_KINDS.has(dead), false, `"${dead}" was pruned and must not return`);
    assert.equal(CODE_BEARING_KINDS.has(dead), false, `"${dead}" was pruned and must not return`);
  }
});

test('a code-writing kind is claim-checked, an advisory one is not', () => {
  for (const kind of ['develop', 'frontend', 'test', 'debug']) {
    assert.ok(VERIFIED_KINDS.has(kind), `${kind} writes code, so its claim gets checked`);
  }
  for (const kind of ['review', 'security', 'plan', 'architect']) {
    assert.equal(VERIFIED_KINDS.has(kind), false, `${kind} is advisory — failing it for a defect it did not introduce would be wrong`);
  }
  // Edge: a kind that runs before any code exists gets no project map.
  assert.equal(CODE_BEARING_KINDS.has('plan'), false);
  assert.ok(CODE_BEARING_KINDS.has('frontend'), 'the new builder reads the workspace map too');
});
