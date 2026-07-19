// Generate the Claude Code plugin agent definitions + task recipes from the single
// source of truth (src/lib/agents.js). Run: node scripts/build-agents.mjs
// Re-run whenever the roster or the spine changes; commit the generated files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AGENTS, RECIPES, EVAL_COVERAGE, SPINE, renderAgent, renderRecipe } from '../src/lib/agents.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = path.join(root, 'plugin', 'agents');
const recipesDir = path.join(root, 'plugin', 'recipes');
mkdirSync(agentsDir, { recursive: true });
mkdirSync(recipesDir, { recursive: true });

for (const a of AGENTS) {
  writeFileSync(path.join(agentsDir, `raphael-${a.slug}.md`), renderAgent(a), 'utf8');
}
for (const r of RECIPES) {
  writeFileSync(path.join(recipesDir, `${r.slug}.md`), renderRecipe(r), 'utf8');
}

const readme = [
  '# Raphael agents',
  '',
  `${AGENTS.length} thin lenses over one shared brain of the developer's past lessons.`,
  'Generated from `src/lib/agents.js` by `scripts/build-agents.mjs` — edit the source,',
  'not these. Each agent\'s `description` carries a "use proactively when…" trigger so',
  'Claude Code auto-delegates to it at the right moment (not only when named).',
  '',
  'Every agent is a specialist held to one bar — a named methodology (its mission),',
  'calibrated output, and an eval-coverage roadmap. There is no second-class tier.',
  '',
  '| Agent | Role | When to use it |',
  '|---|---|---|',
  ...AGENTS.map((a) => `| raphael-${a.slug} | ${a.role} | ${a.whenToUse} |`),
  '',
  `Eval coverage today (grows to the whole roster): ${EVAL_COVERAGE.join(', ')}.`,
  '',
  'Every agent embeds the same spine:',
  '',
  SPINE,
  '',
  'Pipeline order for a from-scratch build: Manager → Planner → Architect →',
  'Developer / Frontend (+ Design) → Reviewer / Security / Debugger → Deployer → Critique.',
  'Red Team runs the offensive counterpart to Security on an authorized target.',
  ''
].join('\n');
writeFileSync(path.join(agentsDir, 'README.md'), readme, 'utf8');

console.log(`wrote ${AGENTS.length} agents + ${RECIPES.length} recipes + README to plugin/`);
