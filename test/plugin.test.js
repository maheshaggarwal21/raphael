import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

// The README leads with "Proof, not vibes — every number below is measured", and
// then contradicted ITSELF: a 499-tests badge alongside "test/ (415)", "all 44
// verbs" alongside "41 verbs", "54 modules" against a real 59 (audit
// 2026-07-26). For a document whose whole positioning is measurement, stale
// counts undercut the flagship claim on the cheapest possible detail. Hand-kept
// numbers drift; this makes them fail loudly instead.
test('README counts match reality (tests, verbs, modules, commands)', async () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const { COMMANDS } = await import('../src/cli.js');

  const verbs = Object.keys(COMMANDS).length;
  const libs = readdirSync(path.join(ROOT, 'src', 'lib')).filter((f) => f.endsWith('.js')).length;
  const cmds = readdirSync(path.join(ROOT, 'src', 'commands')).filter((f) => f.endsWith('.js')).length;

  // every claimed test count must agree with every other one
  const testCounts = [...readme.matchAll(/tests-(\d+)%20passing|\b(\d{3,4}) tests\b|test\/ \((\d+)\)/g)]
    .map((m) => Number(m[1] ?? m[2] ?? m[3]))
    .filter((n) => Number.isFinite(n));
  assert.ok(testCounts.length >= 3, 'the README states a test count in several places');
  assert.equal(new Set(testCounts).size, 1, `the README contradicts itself on the test count: ${testCounts.join(', ')}`);

  // the verb count in prose must match the router
  const verbClaims = [...readme.matchAll(/all (\d+) verbs|\((\d+) verbs\)/g)].map((m) => Number(m[1] ?? m[2]));
  for (const claim of verbClaims) {
    assert.equal(claim, verbs, `README says ${claim} verbs; the router has ${verbs}`);
  }

  // and the module/command counts in the architecture block
  const libClaim = Number((readme.match(/src\/lib\/\*\.js\s+(\d+) modules/) || [])[1]);
  const cmdClaim = Number((readme.match(/src\/commands\/\*\.js\s+(\d+) thin/) || [])[1]);
  if (Number.isFinite(libClaim)) assert.equal(libClaim, libs, `README says ${libClaim} lib modules; there are ${libs}`);
  if (Number.isFinite(cmdClaim)) assert.equal(cmdClaim, cmds, `README says ${cmdClaim} command files; there are ${cmds}`);
});
