// The charter and the deny-list: the two layers that replaced the permission
// prompt when stages moved to bypassPermissions.
//
// These tests assert the WIRING. That --disallowedTools is honoured by the CLI
// under bypassPermissions is not something a unit test can prove — it was
// verified live against the real binary (both arms: a denied `echo` was
// refused, an undenied one ran; a real `rm -rf` against a throwaway directory
// was blocked and the directory survived). Recorded in the run-07 observation
// log.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FORBIDDEN_TOOL_PATTERNS, CHARTER, CHARTER_BRIEF } from '../src/lib/autonomy.js';
import { buildStageArgs } from '../src/lib/stage-runner.js';
import { renderStagePrompt } from '../src/lib/driver.js';
import { buildEvalArgs } from '../src/eval/runner.js';

// Approximates Claude Code's --disallowedTools matching well enough to tell a
// narrow pattern from an over-broad one. Deliberately permissive about what it
// calls a match, so the "ordinary work stays allowed" test below cannot pass by
// being too strict a matcher.
function denies(pattern, command) {
  const inner = pattern.replace(/^Bash\(/, '').replace(/\)$/, '');
  const rx = new RegExp('^' + inner.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return rx.test(command);
}
const deniedByAny = (cmd) => FORBIDDEN_TOOL_PATTERNS.some((p) => denies(p, cmd));

test('the deny-list is frozen, well-formed, and covers the unrecoverable classes', () => {
  assert.equal(Object.isFrozen(FORBIDDEN_TOOL_PATTERNS), true);
  assert.ok(FORBIDDEN_TOOL_PATTERNS.length >= 30);
  for (const p of FORBIDDEN_TOOL_PATTERNS) {
    assert.match(p, /^Bash\(.+\)$/, `malformed pattern: ${p}`);
  }
  assert.equal(new Set(FORBIDDEN_TOOL_PATTERNS).size, FORBIDDEN_TOOL_PATTERNS.length, 'duplicate patterns');

  // One representative command per class the charter promises is refused.
  const mustBeDenied = [
    'rm -rf build',
    'rm -r node_modules',
    'dd if=/dev/zero of=/dev/sda',
    'git reset --hard HEAD~3',
    'git clean -fd .',
    'git checkout -- src/index.js',
    'redis-cli FLUSHALL now',
    'git push origin main',
    'npm publish --access public',
    'gh release create v1.0.0',
    'terraform apply -auto-approve',
    'aws s3 rm s3://bucket --recursive',
    'sudo systemctl stop nginx',
    'shutdown /s /t 0',
    'chmod -R 777 /',
    'git config --global user.email x@y.z'
  ];
  for (const cmd of mustBeDenied) {
    assert.equal(deniedByAny(cmd), true, `should be denied but was not: ${cmd}`);
  }
});

test('the deny-list does NOT block ordinary work — an agent that cannot act is the defect being fixed', () => {
  // If this fails, the list has grown defensive and recreated the problem
  // bypassPermissions was adopted to solve.
  const mustBeAllowed = [
    'npm test',
    'npm install',
    'node --test',
    'node scripts/build.mjs',
    'git add -A',
    'git commit -m message',
    'git status',
    'git diff HEAD',
    'git checkout -b feature',   // branching is not `git checkout --`
    'raph search auth',
    'raph atlas where E-SCHEMA',
    'ls -la',
    'mkdir -p src/lib',
    'rm src/tmp.js',             // a single named file is recoverable; -rf is not
    'python3 manage.py test',
    'docker build -t app .',
    'kubectl get pods'           // read-only kubectl stays available
  ];
  for (const cmd of mustBeAllowed) {
    assert.equal(deniedByAny(cmd), false, `should be allowed but was denied: ${cmd}`);
  }
});

test('every stage spawns with bypassPermissions AND the full deny-list', () => {
  const args = buildStageArgs({ model: 'sonnet', effort: 'high', tools: ['Read', 'Bash'], sessionId: 'sid-1' });

  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');

  const i = args.indexOf('--disallowedTools');
  assert.notEqual(i, -1, '--disallowedTools must be present or the prompt was removed with nothing behind it');
  const emitted = args.slice(i + 1, i + 1 + FORBIDDEN_TOOL_PATTERNS.length);
  assert.deepEqual(emitted, [...FORBIDDEN_TOOL_PATTERNS], 'the whole list must reach the CLI, not a subset');

  // The deny-list flag is variadic. The flags that follow it must still parse —
  // a swallowed --session-id would silently break resume on every stage.
  assert.equal(args[args.indexOf('--session-id') + 1], 'sid-1');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Bash');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
});

test('buildStageArgs still fails closed on a missing tool grant', () => {
  assert.throws(
    () => buildStageArgs({ model: 'sonnet', effort: 'high', sessionId: 's' }),
    /E-DRIVER/
  );
});

test('the charter reaches every stage prompt, including the correct-your-instructions rule', () => {
  const p = renderStagePrompt('develop', { project: 'kit', brief: 'B', input: 'x', priorKind: 'architect' });

  assert.match(p, /Understand before you act/i);
  assert.match(p, /Verify what you did/i);
  // The rule the owner asked for by name: correct a wrong instruction rather
  // than execute it faithfully.
  assert.match(p, /Correct what is wrong, including your instructions/i);
  assert.match(p, /Decide, do not ask/i);
  // The soft layer must restate the hard layer, so an agent does not burn a
  // turn discovering the denial.
  assert.match(p, /Never do these/i);
  assert.match(p, /git push/);
});

test('edge: the brief charter is a real subset — same rules, no elaboration', () => {
  assert.ok(CHARTER_BRIEF.length < CHARTER.length / 2);
  for (const rx of [/unattended/i, /reversible/i, /verify/i, /wrong/i, /rm -rf/, /git reset --hard/, /sudo/]) {
    assert.match(CHARTER_BRIEF, rx, `brief charter dropped: ${rx}`);
  }
});

// ---- the corrections channel -------------------------------------------------
// Charter rule 4 tells a stage to correct wrong input rather than execute it.
// These assert the correction actually REACHES the owner — an instruction to
// disagree is worthless if the disagreement dies in the transcript.

import { parseCorrections, parseDecisions, gateDeliverable, applyStageResult } from '../src/lib/driver.js';
import { correctionsByNode, newVisit, ensureGraph } from '../src/lib/graphstate.js';

import { renderStatus } from '../src/lib/academy.js';
import { RESULT_KEYS } from '../src/lib/stage-runner.js';

test('a stage that corrects its input has the correction parsed out', () => {
  const out = [
    '# Spec', 'body',
    '## CORRECTIONS',
    '- The brief says SQLite supports concurrent writers — it does not; used WAL mode with a single writer.',
    '- none of the listed endpoints exist — built against the real routes in src/api.js',
    '## DECISIONS',
    '- chose zod for validation — already a dependency'
  ].join('\n');

  assert.deepEqual(parseCorrections(out), [
    'The brief says SQLite supports concurrent writers — it does not; used WAL mode with a single writer.',
    'none of the listed endpoints exist — built against the real routes in src/api.js'
  ]);
  // The two channels stay separate — a correction must not leak into DECISIONS
  // or it is buried again, which is the defect this closes.
  assert.deepEqual(parseDecisions(out), ['chose zod for validation — already a dependency']);
});

test('absence is legal: a stage with nothing to correct reports none, not a failure', () => {
  const out = '# Spec\nbody\n\n## DECISIONS\n- none';
  assert.deepEqual(parseCorrections(out), []);
  // The optional section must never turn into a gate — a stage whose input was
  // simply fine has to be able to pass.
  const gated = gateDeliverable(out);
  assert.equal(gated.ok, true);
  assert.deepEqual(gated.corrections, []);
});

test('edge: an empty or "- none" corrections section reads as no corrections', () => {
  assert.deepEqual(parseCorrections('## CORRECTIONS\n\n## DECISIONS\n- x'), []);
  assert.deepEqual(parseCorrections('## CORRECTIONS\n- none\n\n## DECISIONS\n- x'), []);
  assert.deepEqual(parseCorrections(null), []);
  assert.deepEqual(parseCorrections(''), []);
});

test('edge: a quoted contract earlier in the deliverable does not win over the real section', () => {
  // A spec that documents the contract would otherwise have its own example
  // harvested as a correction.
  const out = [
    'Stages may add "## CORRECTIONS" like this:',
    '## CORRECTIONS',
    '- EXAMPLE FROM THE CONTRACT — not a real correction',
    '## CORRECTIONS',
    '- the real one — what I did instead',
    '## DECISIONS',
    '- none'
  ].join('\n');
  assert.deepEqual(parseCorrections(out), ['the real one — what I did instead']);
});

test('the corrections contract reaches the prompt and the result contract carries the field', () => {
  const p = renderStagePrompt('develop', { project: 'kit', brief: 'B', input: 'x', priorKind: 'architect' });
  assert.match(p, /## CORRECTIONS/);
  assert.match(p, /omit this section entirely/i);   // optional, not ceremony
  assert.ok(RESULT_KEYS.includes('corrections'), 'a stage result must be able to carry corrections');
});

test('a correction surfaces in raph academy status, labelled by node and visit', () => {
  const v1 = newVisit(1); v1.corrections = ['the brief asked for MD5 — used SHA-256'];
  const v2 = newVisit(2); v2.corrections = ['review demanded a lock that would deadlock — used a queue'];
  const state = {
    project: 'kit', title: 'Kit', status: 'in-progress', updated_at: '2026-08-04T00:00:00Z',
    milestones: [{ id: 'm1', title: 'core', done: false }],
    current: { milestone: 'm1', step: 'building', next_action: 'continue' },
    driver: { graph: { id: 'linear' }, nodes: { architect: { visits: [v1, v2] } }, cursor: 'architect' }
  };

  assert.deepEqual(correctionsByNode(state.driver), [
    { id: 'architect', visit: 1, corrections: ['the brief asked for MD5 — used SHA-256'] },
    { id: 'architect', visit: 2, corrections: ['review demanded a lock that would deadlock — used a queue'] }
  ]);

  const rendered = renderStatus(state);
  assert.match(rendered, /CORRECTED \(a stage found an error in what it was given/);
  assert.match(rendered, /\[architect\] the brief asked for MD5/);
  assert.match(rendered, /\[architect #2\] review demanded a lock/);
});

test('failure/edge: no corrections and pre-graph states render no CORRECTED block at all', () => {
  const base = {
    project: 'kit', title: 'Kit', status: 'in-progress', updated_at: '2026-08-04T00:00:00Z',
    milestones: [{ id: 'm1', title: 'core', done: false }],
    current: { milestone: 'm1', step: 'building', next_action: 'continue' }
  };
  assert.equal(correctionsByNode(undefined).length, 0);
  // A pre-graph driver has no corrections field; it must read as "none", never throw.
  const preGraph = { ...base, driver: { pipeline: ['plan'], stage: 0, stages: { plan: { decisions: ['x'] } } } };
  assert.equal(correctionsByNode(preGraph.driver).length, 0);
  assert.equal(renderStatus(preGraph).includes('CORRECTED'), false);
  assert.equal(renderStatus(base).includes('CORRECTED'), false);
});

test('a stage result carries its corrections all the way into the run state', () => {
  // Through applyStageResult and ensureGraph, not a hand-assembled shape: the
  // link from "the runner observed a correction" to "the state records it" is
  // the one that had no coverage.
  const state = ensureGraph({
    project: 'kit',
    driver: { pipeline: ['plan', 'develop', 'review'], stage: 1, brief: 'b', status: 'running', stages: { plan: { status: 'done', output: 'spec' } } }
  });

  applyStageResult(state, 'develop', {
    ok: true, output: 'CODE', tokens: 10, sessionId: 's1',
    decisions: ['used a queue'],
    corrections: ['the spec required MD5 for passwords — used argon2id']
  });
  const visits = state.driver.nodes.develop.visits;
  assert.deepEqual(visits[visits.length - 1].corrections, ['the spec required MD5 for passwords — used argon2id']);

  // Failure case: a REJECTED deliverable still surfaces its correction — the
  // stage may have been right about the input even when its output was wrong.
  const s2 = ensureGraph({
    project: 'kit',
    driver: { pipeline: ['plan', 'develop', 'review'], stage: 1, brief: 'b', status: 'running', stages: { plan: { status: 'done', output: 'spec' } } }
  });
  applyStageResult(s2, 'develop', {
    ok: false, gateFailed: true, error: 'no DECISIONS section', tokens: 3, sessionId: 's2',
    corrections: ['the brief names a package that does not exist on npm']
  });
  const v2 = s2.driver.nodes.develop.visits;
  assert.deepEqual(v2[v2.length - 1].corrections, ['the brief names a package that does not exist on npm']);

  // Edge: a result with no corrections leaves the field an empty array, never undefined.
  const s3 = ensureGraph({
    project: 'kit',
    driver: { pipeline: ['plan', 'develop', 'review'], stage: 1, brief: 'b', status: 'running', stages: { plan: { status: 'done', output: 'spec' } } }
  });
  applyStageResult(s3, 'develop', { ok: true, output: 'CODE', tokens: 1, sessionId: 's3', decisions: [] });
  const v3 = s3.driver.nodes.develop.visits;
  assert.deepEqual(v3[v3.length - 1].corrections, []);
  assert.equal(correctionsByNode(s3.driver).length, 0);
});

test('the eval runner spawns headless the same way — the prompt would measure itself, not the brain', () => {
  const args = buildEvalArgs({ model: 'sonnet' });
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  const i = args.indexOf('--disallowedTools');
  assert.notEqual(i, -1);
  assert.deepEqual(args.slice(i + 1, i + 1 + FORBIDDEN_TOOL_PATTERNS.length), [...FORBIDDEN_TOOL_PATTERNS]);

  // Edge: the flags AFTER the variadic deny-list must still parse. A swallowed
  // --strict-mcp-config would silently re-enable MCP tools inside an eval.
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');

  // Failure/edge: no model named -> the flag is absent, not present-and-empty.
  assert.equal(buildEvalArgs({}).includes('--model'), false);
});

test('edge: the two channels have separate budgets — a correction may carry its argument', () => {
  const long = 'x'.repeat(1200);
  const body = `## CORRECTIONS\n- ${long}\n\n## DECISIONS\n- ${long}`;
  // A correction has to survive long enough to state WHY the input was wrong.
  assert.equal(parseCorrections(body)[0].length, 700);
  assert.equal(parseDecisions(body)[0].length, 300);

  // And each caps its own count independently.
  const many = (n, h) => `## ${h}\n` + Array.from({ length: n }, (_, i) => `- item ${i}`).join('\n');
  assert.equal(parseCorrections(many(20, 'CORRECTIONS')).length, 6);
  assert.equal(parseDecisions(many(20, 'DECISIONS')).length, 12);
});
