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
import { initDriver, drive, makeStageRunner, renderPlan, DEFAULT_PIPELINE } from '../lib/driver.js';

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
      '  raph academy checkpoint <project> [--milestone id] [--step "..."] [--next "..."] [--status s] [--note "..."] [--done id] [--tests N] [--lessons N]',
      '  raph academy boundary <project> --reason "what the owner must do"',
      '  raph academy limit <project> [--reset "12am IST"]',
      '  raph academy drive <project> --brief "..."|--brief-file <f> [--pipeline "plan,architect,..."] [--dry-run] [--max-stages N]',
      '  raph academy list'
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
        lessons: flag(args, '--lessons')
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

    try {
      // idempotent mid-flight: an existing unfinished driver keeps its brief/pipeline
      if (!state.driver || state.driver.status === 'done') {
        initDriver(state, { brief, pipeline });
        writeState(project, state);
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
    if (outcome.stopped === 'max-stages') {
      console.log('raph: stopped at --max-stages; rerun to continue from the checkpoint.');
      return 0;
    }
    const kind = final.driver?.pipeline?.[final.driver.stage];
    console.error(`raph: stage "${kind}" failed twice — needs attention (raph academy status ${project}).`);
    return 2;
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
