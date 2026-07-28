// `raph academy` — drive and resume an autonomous Academy build (ARCHITECTURE §12).
//
// The whole point is resumability: a build can be interrupted by a Claude usage
// limit or a PC restart, and a fresh session continues from the checkpoint with no
// human input. `raph academy status` / `resume` are what that fresh session reads
// first. Checkpoints are cheap and frequent; the autonomy boundary is explicit.

import { readFileSync } from 'node:fs';
import {
  startProject,
  readState,
  writeState,
  checkpoint,
  recordBoundary,
  recordLimit,
  listProjects,
  renderStatus,
  parseMilestones
} from '../lib/academy.js';
import { initDriver, drive, makeStageRunner, renderPlan, retryStage, DEFAULT_PIPELINE } from '../lib/driver.js';
import { getGraphTemplate, graphNames, EXPERIMENTAL_GRAPHS } from '../lib/graph-templates.js';
import { validateGraph, renderGraph, renderGraphMermaid } from '../lib/graph.js';
import { ensureGraph, cursorNodeId } from '../lib/graphstate.js';

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function usage(code = 1) {
  console.error(
    [
      'raph academy — drive/resume an autonomous build',
      '  raph academy start <project> --title "..." [--workspace <path>] [--milestones "M1:Scaffold,M2:Keeper"]',
      '  raph academy status [<project>]',
      '  raph academy resume [<project>]              show the runbook + next action for a fresh session',
      '  raph academy checkpoint <project> [--milestone id] [--step "..."] [--next "..."] [--status s] [--note "..."] [--done id] [--tests N] [--lessons N] [--tried "dead-end to not repeat"]',
      '  raph academy boundary <project> --reason "what the owner must do"',
      '  raph academy limit <project> [--reset "12am IST"]',
      '  raph academy drive <project> --brief "..."|--brief-file <f> [--graph <name>|--graph-file <f>] [--pipeline "plan,architect,..."] [--verify "npm test"] [--dry-run] [--max-stages N]',
      '  raph academy graph [<project>|<name>] [--mermaid]   print the locked plan + each node\'s attempt budget',
      '  raph academy retry <project> [--reset-loops]  clear a stopped node and let drive continue',
      '  raph academy list',
      '',
      '  exit codes: 0 ok · 2 stopped · 3 escalated (a human must look) · 4 usage limit (retry after the reset)'
    ].join('\n')
  );
  return code;
}

function pickProject(args) {
  // first non-flag token after the subcommand, or the only project if unambiguous
  const explicit = args.find((a, i) => i > 0 && !a.startsWith('--') && args[i - 1]?.startsWith('--') === false);
  if (explicit && !explicit.startsWith('--')) return explicit;
  const all = listProjects();
  return all.length === 1 ? all[0] : undefined;
}

const RUNBOOK = `# Resuming an Academy build (a fresh session does this)
1. Read this state (raph academy status) — trust NEXT and the milestone marks.
2. Open the project workspace and the build plan (docs/academy/backlog.md).
3. Continue from NEXT. Work in small, tested steps; run the project's tests after each.
4. Checkpoint after every meaningful step: raph academy checkpoint <project> --step "..." --next "..." --note "...".
5. Autonomy boundary — NEVER do these autonomously; call \`raph academy boundary\` and stop:
   deploy, sign in / create an account, spend money, publish (npm/store), push to a public remote.
6. If a Claude limit stops you mid-step: raph academy limit <project> --reset "<when>", then stop.
   The next session (or the scheduled resume) will pick up from NEXT automatically.`;

export default async function academy(args) {
  const sub = args[0];

  if (!sub || sub === 'help') return usage(0);

  if (sub === 'list') {
    const all = listProjects();
    if (!all.length) {
      console.log('raph: no academy projects yet — start one with `raph academy start <name>`');
      return 0;
    }
    for (const name of all) {
      const s = readState(name);
      console.log(`  ${name.padEnd(16)} ${s.status.padEnd(18)} ${s.current.next_action}`);
    }
    return 0;
  }

  if (sub === 'start') {
    const project = args[1];
    if (!project || project.startsWith('--')) return usage(1);
    const state = startProject(project, {
      title: flag(args, '--title'),
      workspace: flag(args, '--workspace'),
      milestones: parseMilestones(flag(args, '--milestones'))
    });
    console.log(`raph: academy project "${project}" ready.`);
    console.log(renderStatus(state));
    return 0;
  }

  if (sub === 'status') {
    const project = args[1] && !args[1].startsWith('--') ? args[1] : pickProject(args);
    if (!project) return usage(1);
    const state = readState(project);
    if (!state) {
      console.error(`raph: no academy project "${project}"`);
      return 1;
    }
    console.log(renderStatus(state));
    return 0;
  }

  if (sub === 'resume') {
    const project = args[1] && !args[1].startsWith('--') ? args[1] : pickProject(args);
    if (!project) {
      console.error('raph: which project? — ' + (listProjects().join(', ') || 'none started'));
      return 1;
    }
    const state = readState(project);
    if (!state) {
      console.error(`raph: no academy project "${project}"`);
      return 1;
    }
    console.log(RUNBOOK);
    console.log('\n--- current state ---');
    console.log(renderStatus(state));
    return 0;
  }

  if (sub === 'checkpoint') {
    const project = args[1];
    if (!project || project.startsWith('--')) return usage(1);
    try {
      const state = checkpoint(project, {
        milestone: flag(args, '--milestone'),
        step: flag(args, '--step'),
        next: flag(args, '--next'),
        status: flag(args, '--status'),
        note: flag(args, '--note'),
        done: flag(args, '--done'),
        tests: flag(args, '--tests'),
        lessons: flag(args, '--lessons'),
        tried: flag(args, '--tried')
      });
      console.log(`raph: checkpoint saved (${state.status}). NEXT: ${state.current.next_action}`);
      return 0;
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
  }

  if (sub === 'boundary') {
    const project = args[1];
    const reason = flag(args, '--reason');
    if (!project || !reason) {
      console.error('raph: usage: raph academy boundary <project> --reason "..."');
      return 1;
    }
    try {
      recordBoundary(project, reason);
      console.log(`raph: BOUNDARY recorded — build paused for the owner: ${reason}`);
      return 0;
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
  }

  if (sub === 'drive') {
    const project = args[1];
    if (!project || project.startsWith('--')) return usage(1);
    const state = readState(project);
    if (!state) {
      console.error(`raph: no academy project "${project}" — start it first`);
      return 1;
    }

    let brief = flag(args, '--brief');
    const briefFile = flag(args, '--brief-file');
    if (!brief && briefFile) {
      try {
        brief = readFileSync(briefFile, 'utf8');
      } catch (err) {
        console.error(`raph: E-DRIVER: could not read --brief-file: ${err.message}`);
        return 1;
      }
    }
    const pipelineFlag = flag(args, '--pipeline');
    const pipeline = pipelineFlag
      ? pipelineFlag.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_PIPELINE;
    // The owner's verification command — the only thing that can tell a true
    // "the suite is green" from a confident wrong one. Comes from here and
    // nowhere else; a stage's output must never choose what the driver runs.
    const verify = flag(args, '--verify');

    // 23.5 — the topology comes from a SHIPPED TEMPLATE or the owner's own file,
    // never from a model. --graph-file is how someone runs a shape we do not
    // ship, and it still passes the full validator including the boundary scan.
    const graphName = flag(args, '--graph');
    const graphFile = flag(args, '--graph-file');
    let graph = null;
    if (graphName && graphFile) {
      console.error('raph: E-GRAPH: pass --graph or --graph-file, not both');
      return 1;
    }
    try {
      if (graphName) graph = getGraphTemplate(graphName);
      if (graphFile) graph = JSON.parse(readFileSync(graphFile, 'utf8'));
    } catch (err) {
      console.error(`raph: ${err.message.startsWith('E-') ? '' : 'E-GRAPH: could not read the graph: '}${err.message}`);
      return 1;
    }
    if (graphName && EXPERIMENTAL_GRAPHS.has(graphName)) {
      console.log(`raph: note — the "${graphName}" graph is EXPERIMENTAL and has not yet completed an observed live run.`);
    }

    try {
      // idempotent mid-flight: an existing unfinished driver keeps its locked graph
      if (!state.driver || state.driver.status === 'done') {
        initDriver(state, { brief, pipeline, graph, verify, graphName: graphName ?? (graphFile ? 'custom' : null) });
        writeState(project, state);
      } else if (graph) {
        console.log('raph: this run already has a locked graph — commitment 1 keeps it. Finish or retry the run first.');
      }
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }

    if (args.includes('--dry-run')) {
      console.log(renderPlan(readState(project)));
      console.log('raph: dry run — nothing was spawned, nothing was spent.');
      return 0;
    }

    if (!state.workspace) {
      console.error('raph: E-DRIVER: the project has no workspace — set one at start (--workspace) before driving');
      return 1;
    }

    const maxFlag = flag(args, '--max-stages');
    const maxStages = maxFlag ? Number(maxFlag) : Infinity;
    if (maxFlag && (!Number.isInteger(maxStages) || maxStages < 1)) {
      console.error('raph: E-DRIVER: --max-stages must be a positive integer');
      return 1;
    }

    const runner = makeStageRunner({ workspace: state.workspace });
    let outcome;
    try {
      outcome = await drive(project, { runner, log: (m) => console.log(`raph: ${m}`), maxStages });
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }

    const final = outcome.state;
    if (outcome.stopped === 'done' || outcome.stopped === 'owner') {
      console.log('raph: autopilot pipeline complete.');
      if (final.boundary) console.log(`raph: OWNER ACTION — ${final.boundary.reason}`);
      return 0;
    }
    if (outcome.stopped === 'limit') {
      console.log(`raph: limit hit mid-pipeline — checkpointed; rerun \`raph academy drive ${project}\` after the reset${final.limit?.reset_at ? ` (${final.limit.reset_at})` : ''}.`);
      return 4;
    }
    if (outcome.stopped === 'paused' || outcome.stopped === 'max-stages') {
      // An owner-requested partial run is a clean pause, not an escalation.
      console.log('raph: stopped at --max-stages; rerun to continue from the checkpoint.');
      return 0;
    }
    if (outcome.stopped === 'busy') {
      console.error(`raph: another "raph academy drive ${project}" is already running — two drives would corrupt the cursor.`);
      return 2;
    }
    // Say what ACTUALLY happened. This used to read "failed twice"
    // unconditionally, which was false for every kind that cannot escalate (F11),
    // and it read the node from pipeline[stage], which is undefined one past the
    // end of a completed run.
    const esc = outcome.escalation;
    const nodeId = esc?.node ?? cursorNodeId(final.driver) ?? 'unknown';
    if (outcome.stopped === 'escalated') {
      // Exit 3 is its own code so a scheduler can tell "retry later" (4 = limit)
      // from "a human must look at this" (3) from "it broke" (2).
      const byClass = {};
      for (const a of esc?.attempts ?? []) byClass[a.class] = (byClass[a.class] ?? 0) + 1;
      const spent = Object.entries(byClass).map(([c, n]) => `${c}x${n}`).join(' ');
      console.error(`raph: ESCALATED at node "${nodeId}" — ${esc?.reason ?? 'a declared bound was exhausted'}`);
      console.error(`      bound: ${esc?.bound ?? 'unknown'}${spent ? ` · attempts this visit: ${spent}` : ''}`);
      console.error(`      the work already on disk is kept. Look at it, then: raph academy retry ${project}`);
      return 3;
    }
    console.error(`raph: run stopped at node "${nodeId}" (${final.driver?.status ?? 'unknown'}).`);
    console.error(`      the work already on disk is kept. Retry it with: raph academy retry ${project}`);
    return 2;
  }

  // `raph academy graph [<project>|<name>] [--mermaid]` — print the plan a run is
  // locked to, or a shipped template, with each node's CONCRETE attempt budget.
  // Zero spawns, zero tokens.
  if (sub === 'graph') {
    const target = args[1];
    const mermaid = args.includes('--mermaid');
    if (!target) {
      console.log(`shipped graphs: ${graphNames().join(', ')}`);
      console.log('  raph academy graph <name>       show a shipped template');
      console.log('  raph academy graph <project>    show the graph a run is locked to');
      return 0;
    }
    let graph = null;
    const state = readState(target, { onCorrupt: 'null' });
    if (state) {
      ensureGraph(state);
      graph = state.driver?.graph ?? null;
      if (!graph) {
        console.error(`raph: project "${target}" has no autopilot run yet — start one with "raph academy drive"`);
        return 1;
      }
    } else {
      try {
        graph = validateGraph(getGraphTemplate(target), { name: target });
      } catch (err) {
        console.error(`raph: ${err.message}`);
        return 1;
      }
    }
    console.log(mermaid ? renderGraphMermaid(graph) : renderGraph(graph));
    if (!mermaid && EXPERIMENTAL_GRAPHS.has(graph.name)) {
      console.log('\nNOTE: this graph is EXPERIMENTAL — it has not yet completed an observed live run.');
    }
    return 0;
  }

  if (sub === 'retry') {
    const project = args[1];
    if (!project) {
      console.error('raph: usage: raph academy retry <project>');
      return 1;
    }
    const state = readState(project);
    if (!state) {
      console.error(`raph: E-ACADEMY: no academy project "${project}"`);
      return 1;
    }
    let outcome;
    try {
      // Loop counters are PRESERVED by default: a retry that quietly restored
      // the budget would let a run exceed a bound it already declared.
      outcome = retryStage(state, { resetLoops: args.includes('--reset-loops') });
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
    if (!outcome.cleared) {
      console.log(`raph: ${outcome.why}`);
      return 0;
    }
    writeState(project, outcome.state);
    console.log(`raph: cleared the failed "${outcome.kind}" stage — files in the workspace are untouched.`);
    console.log(`      continue with: raph academy drive ${project} --brief-file <f>`);
    return 0;
  }

  if (sub === 'limit') {
    const project = args[1];
    if (!project || project.startsWith('--')) return usage(1);
    try {
      recordLimit(project, { resetAt: flag(args, '--reset') });
      console.log('raph: limit recorded — build paused until the subscription resets.');
      return 0;
    } catch (err) {
      console.error(`raph: ${err.message}`);
      return 1;
    }
  }

  return usage(1);
}
