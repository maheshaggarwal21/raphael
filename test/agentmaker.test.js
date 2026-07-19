import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateAgentProposal, rosterSnippet, proposeAgentDraft, writeAgentProposal, agentDemand, renderDemand } from '../src/lib/agentmaker.js';
import { AGENTS } from '../src/lib/agents.js';

const goodSpec = {
  slug: 'data-scientist',
  role: 'the specialist who designs and reviews data pipelines and statistical checks',
  whenToUse: 'a data pipeline or statistical analysis needs designing or reviewing for soundness',
  mission: 'From the spec, design the data flow, validation, and statistical soundness checks; pull the brain lessons about past data mistakes first.',
  output: 'A data pipeline design with validation, quality gates, and named statistical assumptions.',
  model: 'sonnet',
  tools: ['Read', 'Grep']
};

test('validateAgentProposal accepts a complete spec and rejects bad ones', () => {
  const ok = validateAgentProposal(goodSpec);
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.flagship, undefined); // the flagship tier was retired
  assert.equal(ok.entry.whenToUse, goodSpec.whenToUse); // every agent carries a trigger
  assert.equal(ok.entry.model, 'sonnet');

  assert.equal(validateAgentProposal({ ...goodSpec, slug: 'Bad Slug' }).ok, false);
  assert.equal(validateAgentProposal({ ...goodSpec, model: 'gpt' }).ok, false);
  assert.equal(validateAgentProposal({ ...goodSpec, role: 'x' }).ok, false);
  // failure case: a proposal with no whenToUse trigger is refused (it could never auto-fire)
  const noTrigger = validateAgentProposal({ ...goodSpec, whenToUse: undefined });
  assert.equal(noTrigger.ok, false);
  assert.ok(noTrigger.errors.some((e) => /when-to-use/.test(e)));
});

test('a slug already in the roster is refused', () => {
  const r = validateAgentProposal({ ...goodSpec, slug: AGENTS[0].slug });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /already exists/.test(e)));
});

test('defaults: model inherit, a read-only toolset when unspecified', () => {
  const r = validateAgentProposal({ ...goodSpec, model: undefined, tools: [] });
  assert.equal(r.entry.model, 'inherit');
  assert.deepEqual(r.entry.tools, ['Read', 'Grep', 'Glob']);
});

test('rosterSnippet is a pasteable literal; the draft is branded PROPOSAL, not installed', () => {
  const { entry } = validateAgentProposal(goodSpec);
  const snippet = rosterSnippet(entry);
  assert.match(snippet, /slug: 'data-scientist'/);
  assert.match(snippet, /model: 'sonnet'/);
  const draft = proposeAgentDraft(entry);
  assert.match(draft, /PROPOSAL/);
  assert.match(draft, /NOT installed/);
  assert.match(draft, /raph eval before committing/);
  assert.match(draft, /name: raphael-data-scientist/); // uses the real renderAgent generator
});

test('writeAgentProposal stages the file, never touching the roster', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-am-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    const { entry } = validateAgentProposal(goodSpec);
    const { path: file } = writeAgentProposal(entry);
    assert.ok(existsSync(file));
    assert.ok(file.includes(path.join('staged', 'agents', 'data-scientist.md')));
    assert.match(readFileSync(file, 'utf8'), /PROPOSAL/);
    // roster in memory is untouched
    assert.ok(!AGENTS.some((a) => a.slug === 'data-scientist'));
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agentDemand summarises lesson categories vs the roster', () => {
  const lessons = [
    { category: 'security' }, { category: 'security' }, { category: 'data' }
  ];
  const d = agentDemand(lessons);
  assert.equal(d.lessonCount, 3);
  assert.equal(d.categories[0].category, 'security'); // most lessons first
  assert.equal(d.categories[0].lessons, 2);
  assert.match(renderDemand(d), /roster \(\d+\)/);
});
