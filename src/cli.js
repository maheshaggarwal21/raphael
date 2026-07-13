import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const COMMANDS = {
  init: () => import('./commands/init.js'),
  status: () => import('./commands/status.js'),
  validate: () => import('./commands/validate.js'),
  doctor: () => import('./commands/doctor.js'),
  mine: () => import('./commands/mine.js'),
  note: () => import('./commands/note.js'),
  distill: () => import('./commands/distill.js'),
  queue: () => import('./commands/queue.js'),
  approve: () => import('./commands/approve.js'),
  reject: () => import('./commands/reject.js'),
  show: () => import('./commands/show.js')
};

const HELP = `raph — the Raphael brain CLI

Usage: raph <command> [options]

Commands:
  init        Create ~/.raphael, the brain git repo, and default config
  status      Show brain health: lesson counts, pending candidates, mode
  validate    Run the safety chokepoint on lesson files
              (raph validate <file...> | raph validate --all)
  doctor      Check the environment and brain health, with fixes
  mine        Read this project's session history and extract episodes
              (raph mine [--dry-run] [--yes] [--project <path>])
  note        Capture a lesson by hand, straight to the review queue
              (raph note "<text>" [--title t] [--category c] [--severity s])
  distill     Turn mined episodes into gated candidate lessons (spends tokens)
              (raph distill [--dry-run] [--yes] [--max-episodes N] [--model m])
  queue       List candidates awaiting review (numbered; --json for tooling)
  show        Print a lesson or candidate in full (raph show <n|slug|id> [--provenance])
  approve     Activate candidates (raph approve <n...>; security/quarantined
              items require single approval with --confirmed)
  reject      Remove candidates; similar ones auto-suppress for 180 days
              (raph reject <n...> [--reason "..."])
  help        Show this help
  version     Show version

Environment:
  RAPHAEL_HOME   Override the brain location (default: ~/.raphael)
`;

export async function run(argv) {
  const [cmd, ...args] = argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return 0;
  }

  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    console.log(`raphael-brain ${pkg.version}`);
    return 0;
  }

  const loader = COMMANDS[cmd];
  if (!loader) {
    console.error(`raph: unknown command "${cmd}" — run "raph help"`);
    return 1;
  }

  const mod = await loader();
  return mod.default(args);
}
