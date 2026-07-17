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
  retire: () => import('./commands/retire.js'),
  show: () => import('./commands/show.js'),
  inject: () => import('./commands/inject.js'),
  search: () => import('./commands/search.js'),
  why: () => import('./commands/why.js'),
  on: () => import('./commands/on.js'),
  off: () => import('./commands/off.js'),
  eval: () => import('./commands/eval.js'),
  map: () => import('./commands/map.js'),
  atlas: () => import('./commands/atlas.js'),
  lint: () => import('./commands/lint.js'),
  decide: () => import('./commands/decide.js'),
  skills: () => import('./commands/skills.js'),
  optimize: () => import('./commands/optimize.js'),
  agent: () => import('./commands/agent.js'),
  selfcheck: () => import('./commands/selfcheck.js'),
  pack: () => import('./commands/pack.js'),
  academy: () => import('./commands/academy.js'),
  portfolio: () => import('./commands/portfolio.js'),
  report: () => import('./commands/report.js'),
  policy: () => import('./commands/policy.js'),
  guard: () => import('./commands/guard.js'),
  stats: () => import('./commands/stats.js'),
  adopt: () => import('./commands/adopt.js'),
  auto: () => import('./commands/auto.js'),
  web: () => import('./commands/web.js')
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
  retire      Retire an ACTIVE lesson that no longer holds (irreversible; needs
              --confirmed). Tombstones like reject (raph retire <id|slug...>
              [--reason "..."] --confirmed)
  search      Find lessons the way the hooks would rank them
              (raph search <terms> [--audience <agent>] [--json])
  why         Show what got injected, matched on what, and the token cost
              (raph why [--last N])
  stats       Self-use report: token cost, which lessons earn their keep, and
              which never fire (retrieval miss) (raph stats [--json])
  on / off    Enable / disable injection (mining and review keep working)
  inject      Hook plumbing: reads the hook JSON on stdin, prints context
              (raph inject --event session-start|user-prompt; always exits 0)
  eval        Prove it with numbers: canary gate + brain ON/OFF lift table
              (raph eval run [--quick] [--dry-run] [--scenario id] [--trials N])
  map         Generate/refresh the cached project map agents read instead of the repo
              (raph map [--refresh] [--project path] [--summary])
  atlas       The project knowledge graph: build it free, then ask it where to look
              (raph atlas [where "<error>"|path A B|explain X|digest|bench|export]
               [--out <dir>] [--refresh] [--json])
  lint        Advisory health check on active lessons: dated/pointer wording,
              atlas-provable stale file paths, possible contradictions, and
              low-confidence retire candidates (raph lint [--project <path>] [--json])
  decide      Record/list durable decisions (architecture, scope, vendor) so
              settled calls are surfaced at session start, not re-litigated
              (raph decide "<decision>" [--why "..."] [--supersedes dec_x] | decide list)
  skills      The skills factory: package a broadly-firing lesson into a staged
              SKILL.md draft (never auto-installed) (raph skills [suggest|draft <id>|list])
  optimize    The pruning report: retire candidates, retrieval misses, confidence,
              and agent coverage in one screen — recommendations only (raph optimize [--json])
  agent       The agent-maker: draft a new roster entry as a staged PROPOSAL (never
              auto-installed) + a demand signal (raph agent [demand|propose <slug> …|list])
  selfcheck   The self-upgrade gate: before merging a change to Raphael's OWN code,
              verify branch + npm test + eval canaries are green (raph selfcheck [--quick])
  pack        Seed a curated lesson pack into the brain as reviewable candidates
              (raph pack list | raph pack add security [--dry-run]) — cold-start value
  academy     Drive/resume an autonomous Academy build across limits + restarts
              (raph academy start|status|resume|checkpoint|boundary|limit|list)
  portfolio   The company project table: every Academy build with status,
              tests, lessons written back, and recall cost (raph portfolio [--json])
  report      The board report: builds, brain changes, recall cost, misses,
              and what waits on the owner (raph report weekly [--days N] [--json])
  policy      The model policy table: which model + effort runs each task kind
              (raph policy [<kind>] [--escalated] [--json])
  guard       Block commits that would leak secrets in YOUR projects
              (raph guard install|uninstall|scan [--staged|--all|<path...>])
  adopt       Digest external material (URL, file, repo, skill file) into
              reviewable lessons + skill drafts, with provenance and undo
              (raph adopt <url|path> [--dry-run] | adopt list | adopt revoke <id>)
  auto        The auto-approve dial: off | standard (own mined lessons) |
              wide (+ adopted). Security always waits for a human.
              (raph auto [off|standard|wide] [--cap N] [--daily-cap N])
  web         Start the local console: your brain in the browser, localhost
              only, token-guarded (raph web [--port N] [--no-open])
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
