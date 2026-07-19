import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, EVAL_COVERAGE, RECIPES, SPINE, renderAgent, renderRecipe } from '../src/lib/agents.js';

const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus', 'inherit']);

test('the roster is exactly the 12 designed agents', () => {
  assert.equal(AGENTS.length, 12);
  const slugs = AGENTS.map((a) => a.slug);
  for (const expected of ['manager', 'planner', 'architect', 'developer', 'frontend', 'reviewer', 'security', 'debugger', 'design', 'deployer', 'critique', 'redteam']) {
    assert.ok(slugs.includes(expected), `missing agent: ${expected}`);
  }
  assert.equal(new Set(slugs).size, 12); // no duplicates
});

test('only the three code-producing agents can edit; reviewers/critics stay read-only', () => {
  const canEdit = (a) => a.tools.includes('Edit') || a.tools.includes('Write');
  const editors = AGENTS.filter(canEdit).map((a) => a.slug).sort();
  assert.deepEqual(editors, ['debugger', 'developer', 'frontend'], 'exactly developer/frontend/debugger may edit');
});

test('the frontend agent is a builder (can edit) with the two-layer knowledge+judgment mission', () => {
  const fe = AGENTS.find((a) => a.slug === 'frontend');
  assert.ok(fe.tools.includes('Edit') && fe.tools.includes('Write'), 'frontend must be able to build');
  assert.match(fe.mission, /slop/i);           // names the enemy
  assert.match(fe.mission, /signature element/i); // the judgment layer
  assert.match(fe.mission, /raph search "design/); // the knowledge layer, brain-first
  assert.match(fe.mission, /reduced-motion|4\.5:1/); // the accessibility floor
});

test('the flagship tier is retired — no agent carries a flagship flag', () => {
  for (const a of AGENTS) {
    assert.equal(a.flagship, undefined, `${a.slug} still has a flagship flag — the tier was retired`);
  }
  // renderAgent must not print a flagship tag on any agent's description.
  for (const a of AGENTS) {
    assert.ok(!renderAgent(a).includes('flagship'), `${a.slug} description still shows "flagship"`);
  }
});

test('EVAL_COVERAGE names real roster slugs (the eval roadmap, not a quality tier)', () => {
  const slugs = new Set(AGENTS.map((a) => a.slug));
  assert.ok(EVAL_COVERAGE.length > 0);
  for (const s of EVAL_COVERAGE) assert.ok(slugs.has(s), `EVAL_COVERAGE names a non-existent agent: ${s}`);
});

test('every agent carries a whenToUse trigger, and renderAgent puts it in the description', () => {
  for (const a of AGENTS) {
    assert.ok(a.whenToUse && a.whenToUse.length > 10, `${a.slug} missing a whenToUse trigger`);
    const md = renderAgent(a);
    // the description line drives Claude Code auto-delegation: it must carry the
    // trigger + the proactive nudge, not just the role.
    const descLine = md.split('\n').find((l) => l.startsWith('description:'));
    assert.ok(descLine.includes('proactively'), `${a.slug} description missing the proactive nudge`);
    assert.ok(descLine.includes(a.whenToUse), `${a.slug} description missing its trigger`);
  }
});

test('the Red Team agent is offensive-but-authorized: right tools, advisory-only, hard safety limits', () => {
  const rt = AGENTS.find((a) => a.slug === 'redteam');
  assert.ok(rt, 'redteam agent must exist');
  // it needs Bash to probe a target, but must NOT be able to edit/write code —
  // it reports, it does not patch or weaponize (advisory-only, like security).
  assert.ok(rt.tools.includes('Bash'), 'redteam needs Bash to probe an authorized target');
  assert.ok(!rt.tools.includes('Edit') && !rt.tools.includes('Write'), 'redteam must not have code-editing tools');
  const text = `${rt.mission} ${rt.output}`.toLowerCase();
  // authorization-first + the hard prohibitions must be present in the mission.
  assert.ok(text.includes('authoriz'), 'redteam mission must require authorization');
  for (const forbidden of ['never', 'denial-of-service', 'exfiltrat', 'advisory']) {
    assert.ok(text.includes(forbidden), `redteam mission missing safety language: ${forbidden}`);
  }
});

test('every agent has valid frontmatter fields', () => {
  for (const a of AGENTS) {
    assert.ok(a.role && a.mission && a.output, `${a.slug} missing prose`);
    assert.ok(Array.isArray(a.tools) && a.tools.length > 0, `${a.slug} has no tools`);
    assert.ok(VALID_MODELS.has(a.model), `${a.slug} has an odd model: ${a.model}`);
  }
});

test('renderAgent embeds the spine, brain-pull, mission, and output in every agent', () => {
  for (const a of AGENTS) {
    const md = renderAgent(a);
    assert.ok(md.startsWith('---\n'), `${a.slug} missing frontmatter`);
    assert.ok(md.includes(`name: raphael-${a.slug}`));
    assert.ok(md.includes(`model: ${a.model}`));
    assert.ok(md.includes(`tools: ${a.tools.join(', ')}`));
    // the spine, verbatim, in every agent
    assert.ok(md.includes('## The Raphael spine'), `${a.slug} missing spine`);
    assert.ok(md.includes('raph search'), `${a.slug} missing brain-pull`);
    assert.ok(md.includes('Write back'), `${a.slug} missing write-back rule`);
    assert.ok(md.includes(a.output), `${a.slug} missing its output contract`);
  }
});

test('the spine names all six rules (incl. one-decision-one-question)', () => {
  for (const rule of ['Brain first', 'Free checks', 'Map, not the whole repo', 'Cheap → strong', 'Write back', 'One decision, one question']) {
    assert.ok(SPINE.includes(rule), `spine missing rule: ${rule}`);
  }
});

test('the finding-producing agents encode their named methodology (calibration + discipline)', () => {
  const byslug = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));
  // reviewer: confidence-banding + quote-the-line
  assert.match(byslug.reviewer.mission, /confidence/i);
  assert.match(byslug.reviewer.mission, /quote/i);
  // debugger: Iron Law + 3-strike + regression fails-then-passes
  assert.match(byslug.debugger.mission, /iron law/i);
  assert.match(byslug.debugger.mission, /three-strike|3-strike/i);
  assert.match(byslug.debugger.mission, /FAILING without/);
  // security: LLM/AI security as its own category
  assert.match(byslug.security.mission, /LLM\/AI/i);
  // planner + architect: mandatory NOT-in-scope / Error & Rescue Map
  assert.match(byslug.planner.mission, /NOT in scope/i);
  assert.match(byslug.architect.mission, /error & rescue map/i);
  // design: names the AI-slop tells + the accessibility floor
  assert.match(byslug.design.mission, /slop/i);
  assert.match(byslug.design.mission, /4\.5:1|contrast/i);
});

test('recipes render as numbered, brain-first procedures', () => {
  assert.equal(RECIPES.length, 7);
  assert.ok(RECIPES.some((r) => r.slug === 'security-audit'), 'the five-check security audit recipe should ship');
  assert.ok(RECIPES.some((r) => r.slug === 'pentest'), 'the authorized penetration-test recipe should ship');
  assert.ok(RECIPES.some((r) => r.slug === 'plan'), 'the plan recipe should ship');
  assert.ok(RECIPES.some((r) => r.slug === 'frontend-build'), 'the frontend-build recipe should ship');
  for (const r of RECIPES) {
    const md = renderRecipe(r);
    assert.ok(md.startsWith(`# Recipe: ${r.title}`));
    assert.ok(md.includes('1. '));
    assert.ok(/raph search/.test(md), `${r.slug} recipe should start from the brain`);
  }
});

test('the pentest recipe leads with an authorization/scope confirmation (safety ordering)', () => {
  const pentest = RECIPES.find((r) => r.slug === 'pentest');
  assert.ok(pentest, 'pentest recipe must exist');
  // authorization is step 1, not buried — an attacker\'s-eye recipe must never
  // start probing before scope is confirmed.
  assert.match(pentest.steps[0].toLowerCase(), /authoriz|scope/, 'pentest step 1 must confirm authorization/scope');
  const joined = pentest.steps.join(' ').toLowerCase();
  assert.ok(joined.includes('non-destructive') || joined.includes('never'), 'pentest recipe must state the non-destructive limits');
});

test('renderAgent degrades gracefully when an agent has no whenToUse (edge case)', () => {
  const bare = { slug: 'x', name: 'X', model: 'sonnet', tools: ['Read'], role: 'does a thing', mission: 'm', output: 'o' };
  const md = renderAgent(bare);
  const descLine = md.split('\n').find((l) => l.startsWith('description:'));
  // no crash, no dangling "proactively when undefined" — just the role + tag.
  assert.ok(descLine.includes('does a thing'), 'description keeps the role');
  assert.ok(!descLine.includes('undefined'), 'no undefined leaks into the description');
  assert.ok(!descLine.includes('proactively'), 'no proactive nudge when there is no trigger');
});

test('manager routes on a cheap model; specialists reason on a stronger one', () => {
  const manager = AGENTS.find((a) => a.slug === 'manager');
  assert.equal(manager.model, 'haiku');
  assert.ok(manager.tools.includes('Task')); // it can dispatch specialists
});
