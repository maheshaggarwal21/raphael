// `raph agent` — the agent-maker (Phase 14 meta layer).
//   raph agent demand                          where a new specialist might be warranted
//   raph agent propose <slug> --role … --mission … --output … [--model m] [--tools a,b] [--name "…"]
//   raph agent list                            staged proposals
// Proposals are STAGED, never added to the roster — adopting one is a human
// self-upgrade (edit agents.js + regenerate + tests + eval).

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { validateAgentProposal, writeAgentProposal, rosterSnippet, agentDemand, renderDemand } from '../lib/agentmaker.js';
import { readActiveLessons } from '../lib/freshness.js';
import { p } from '../lib/paths.js';

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

export default async function agent(args) {
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : 'demand';

  if (sub === 'demand') {
    const d = agentDemand(readActiveLessons());
    if (args.includes('--json')) { console.log(JSON.stringify(d, null, 2)); return 0; }
    console.log(renderDemand(d));
    return 0;
  }

  if (sub === 'list') {
    const dir = path.join(p.home(), 'staged', 'agents');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
    if (!files.length) { console.log('raph: no staged agent proposals. Draft one: raph agent propose <slug> …'); return 0; }
    console.log(`raph: ${files.length} staged agent proposal(s) (NOT installed):`);
    for (const f of files) console.log(`  ${f.replace(/\.md$/, '')}  -> ${path.join(dir, f)}`);
    return 0;
  }

  if (sub === 'propose') {
    const slug = args[1] && !args[1].startsWith('--') ? args[1] : null;
    const spec = {
      slug,
      name: flag(args, '--name'),
      role: flag(args, '--role'),
      mission: flag(args, '--mission'),
      output: flag(args, '--output'),
      model: flag(args, '--model') ?? 'inherit',
      tools: (flag(args, '--tools') ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    };
    const { ok, errors, entry } = validateAgentProposal(spec);
    if (!ok) {
      for (const e of errors) console.error(`raph: ${e}`);
      return 1;
    }
    const { path: file } = writeAgentProposal(entry);
    console.log(`raph: staged agent proposal "${entry.slug}" -> ${file}`);
    console.log('raph: NOT installed. To adopt (a self-upgrade), paste this into src/lib/agents.js AGENTS,');
    console.log('raph: then run scripts/build-agents.mjs, npm test, and raph eval before committing:\n');
    console.log(rosterSnippet(entry));
    return 0;
  }

  console.error('raph: usage: raph agent [demand|propose <slug> --role … --mission … --output …|list]');
  return 1;
}
