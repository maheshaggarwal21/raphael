// `raph academy` — drive and resume an autonomous Academy build (ARCHITECTURE §12).
//
// The whole point is resumability: a build can be interrupted by a Claude usage
// limit or a PC restart, and a fresh session continues from the checkpoint with no
// human input. `raph academy status` / `resume` are what that fresh session reads
// first. Checkpoints are cheap and frequent; the autonomy boundary is explicit.

import {
  startProject,
  readState,
  checkpoint,
  recordBoundary,
  recordLimit,
  listProjects,
  renderStatus,
  parseMilestones
} from '../lib/academy.js';

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
      '  raph academy checkpoint <project> [--milestone id] [--step "..."] [--next "..."] [--status s] [--note "..."] [--done id]',
      '  raph academy boundary <project> --reason "what the owner must do"',
      '  raph academy limit <project> [--reset "12am IST"]',
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
        done: flag(args, '--done')
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
