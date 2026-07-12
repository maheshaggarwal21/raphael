import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const COMMANDS = {
  init: () => import('./commands/init.js'),
  status: () => import('./commands/status.js'),
  validate: () => import('./commands/validate.js')
};

const HELP = `raph — the Raphael brain CLI

Usage: raph <command> [options]

Commands:
  init        Create ~/.raphael, the brain git repo, and default config
  status      Show brain health: lesson counts, pending candidates, mode
  validate    Run the safety chokepoint on lesson files
              (raph validate <file...> | raph validate --all)
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
