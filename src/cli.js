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
  show: () => import('./commands/show.js'),
  inject: () => import('./commands/inject.js'),
  search: () => import('./commands/search.js'),
  why: () => import('./commands/why.js'),
  on: () => import('./commands/on.js'),
  off: () => import('./commands/off.js'),
  eval: () => import('./commands/eval.js'),
  map: () => import('./commands/map.js'),
  pack: () => import('./commands/pack.js'),
  academy: () => import('./commands/academy.js'),
  guard: () => import('./commands/guard.js')
};

const HELP = `raph — the Raphael brain CLI

Usage: raph <command> [options]

Commands:
  init        Create ~/.raphael, the brain git repo, and default config
              (raph init [--guard] — --guard also installs the project secret
               guard in the current git repo)
  status      Show brain health: lesson counts, pending candidates, mode
  validate    Run the safety chokepoint on lesson files
              (raph validate <file...> | raph validate --all)
  doctor      Check the environment and brain health, with fixes
  mine        Read this project's session history and extract episodes
              (raph mine [--dry-run] [--yes] [--project <path>])
  note        Capture a lesson by hand, straight to the review queue
              (raph note "<text>" [--title t] [--category c] [--severity s]
               [--keywords a,b,c] — keywords let the hooks find it per-prompt)
  distill     Turn mined episodes into gated candidate lessons. Uses your
              Claude Code SUBSCRIPTION by default (fixed price, no API key);
              falls back to ANTHROPIC_API_KEY only if the CLI isn't logged in.
              (raph distill [--dry-run] [--yes] [--max-episodes N] [--model m])
  queue       List candidates awaiting review (numbered; --json for tooling)
  show        Print a lesson or candidate in full (raph show <n|slug|id> [--provenance])
  approve     Activate candidates (raph approve <n...>; security/quarantined
              items require single approval with --confirmed)
  reject      Remove candidates; similar ones auto-suppress for 180 days
              (raph reject <n...> [--reason "..."])
  search      Find lessons the way the hooks would rank them
              (raph search <terms> [--audience <agent>] [--json])
  why         Show what got injected, matched on what, and the token cost
              (raph why [--last N])
  on / off    Enable / disable injection (mining and review keep working)
  inject      Hook plumbing: reads the hook JSON on stdin, prints context
              (raph inject --event session-start|user-prompt; always exits 0)
  eval        Prove it with numbers: canary gate + brain ON/OFF lift table
              (raph eval run [--quick] [--dry-run] [--scenario id] [--trials N])
  map         Generate/refresh the cached project map agents read instead of the repo
              (raph map [--refresh] [--project path] [--summary])
  pack        Seed a curated lesson pack into the brain as reviewable candidates
              (raph pack list | raph pack add security [--dry-run]) — cold-start value
  academy     Drive/resume an autonomous Academy build across limits + restarts
              (raph academy start|status|resume|checkpoint|boundary|limit|list)
  guard       Block commits that would leak secrets in YOUR projects
              (raph guard install|uninstall|scan [--staged|--all|<path...>])
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
