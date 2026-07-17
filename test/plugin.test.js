import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

function frontmatter(rel) {
  const text = readFileSync(path.join(ROOT, rel), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${rel} must start with YAML frontmatter`);
  return yaml.load(m[1], { schema: yaml.JSON_SCHEMA });
}

const pkg = readJson('package.json');

test('the repo is a plugin marketplace listing raphael-brain', () => {
  const mkt = readJson('.claude-plugin/marketplace.json');
  assert.equal(typeof mkt.name, 'string');
  assert.ok(Array.isArray(mkt.plugins));
  const plugin = mkt.plugins.find((p) => p.name === 'raphael-brain');
  assert.ok(plugin, 'marketplace must list raphael-brain');
  assert.equal(plugin.source, './plugin');
});

test('the plugin manifest is valid and version-locked to package.json', () => {
  const man = readJson('plugin/.claude-plugin/plugin.json');
  assert.equal(man.name, 'raphael-brain');
  assert.equal(typeof man.description, 'string');
  assert.ok(man.description.length > 20);
  assert.equal(man.version, pkg.version, 'plugin.json version must match package.json');

  const mkt = readJson('.claude-plugin/marketplace.json');
  const listed = mkt.plugins.find((p) => p.name === 'raphael-brain');
  assert.equal(listed.version, pkg.version, 'marketplace plugin version must match package.json');
});

test('hooks.json auto-wires recall on session start and each prompt', () => {
  const hooks = readJson('plugin/hooks/hooks.json');
  const flatten = (event) => (hooks.hooks[event] || [])
    .flatMap((g) => g.hooks || [])
    .map((h) => h.command);

  const start = flatten('SessionStart');
  const prompt = flatten('UserPromptSubmit');
  const preTool = flatten('PreToolUse');
  assert.ok(start.some((c) => /raph inject .*session-start/.test(c)), 'SessionStart must call raph inject session-start');
  assert.ok(prompt.some((c) => /raph inject .*user-prompt/.test(c)), 'UserPromptSubmit must call raph inject user-prompt');
  // 16.3: the atlas nudge fires before search-shaped tools, matched to Grep/Glob.
  assert.ok(preTool.some((c) => /raph inject .*pre-tool/.test(c)), 'PreToolUse must call raph inject pre-tool');
  const matcher = (hooks.hooks.PreToolUse || []).map((g) => g.matcher).find(Boolean);
  assert.match(matcher || '', /Grep|Glob/, 'PreToolUse must match search-shaped tools');
});

test('the four /brain slash commands exist with a description', () => {
  for (const name of ['brain', 'brain-learn', 'brain-review', 'brain-eval']) {
    const rel = `plugin/commands/${name}.md`;
    assert.ok(existsSync(path.join(ROOT, rel)), `${rel} must exist`);
    const fm = frontmatter(rel);
    assert.equal(typeof fm.description, 'string');
    assert.ok(fm.description.length > 10, `${name} needs a real description`);
  }
});

test('the brain-recall skill still ships alongside the commands', () => {
  const fm = frontmatter('plugin/skills/brain-recall/SKILL.md');
  assert.equal(fm.name, 'brain-recall');
});
