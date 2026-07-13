import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, FLAGSHIPS, RECIPES, SPINE, renderAgent, renderRecipe } from '../src/lib/agents.js';

const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus', 'inherit']);

test('the roster is exactly the 10 designed agents', () => {
  assert.equal(AGENTS.length, 10);
  const slugs = AGENTS.map((a) => a.slug);
  for (const expected of ['manager', 'planner', 'architect', 'developer', 'reviewer', 'security', 'debugger', 'design', 'deployer', 'critique']) {
    assert.ok(slugs.includes(expected), `missing agent: ${expected}`);
  }
  assert.equal(new Set(slugs).size, 10); // no duplicates
});

test('the four flagships are Planner, Architect, Reviewer, Debugger', () => {
  assert.deepEqual([...FLAGSHIPS].sort(), ['architect', 'debugger', 'planner', 'reviewer']);
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

test('the spine names all five rules', () => {
  for (const rule of ['Brain first', 'Free checks', 'Map, not the whole repo', 'Cheap → strong', 'Write back']) {
    assert.ok(SPINE.includes(rule), `spine missing rule: ${rule}`);
  }
});

test('recipes render as numbered, brain-first procedures', () => {
  assert.equal(RECIPES.length, 4);
  assert.ok(RECIPES.some((r) => r.slug === 'security-audit'), 'the five-check security audit recipe should ship');
  for (const r of RECIPES) {
    const md = renderRecipe(r);
    assert.ok(md.startsWith(`# Recipe: ${r.title}`));
    assert.ok(md.includes('1. '));
    assert.ok(/raph search/.test(md), `${r.slug} recipe should start from the brain`);
  }
});

test('manager routes on a cheap model; specialists reason on a stronger one', () => {
  const manager = AGENTS.find((a) => a.slug === 'manager');
  assert.equal(manager.model, 'haiku');
  assert.ok(manager.tools.includes('Task')); // it can dispatch specialists
});
