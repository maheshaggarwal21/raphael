// `raph web` — start the local console (ARCHITECTURE §14). Localhost-only,
// token-guarded, foreground (Ctrl+C stops it). Convenience face over the same
// verbs the CLI exposes; each user administers their OWN brain.

import { spawn } from 'node:child_process';
import { makeToken, startConsole, CONSOLE_HOST } from '../lib/web.js';

const HELP = `raph web — the local console (localhost only, token-guarded)

Usage:
  raph web [--port N] [--no-open]

Serves YOUR brain's console at http://${CONSOLE_HOST}:<port>/?token=<session token>.
The token changes every launch; requests without it are refused, as is anything
cross-origin or with a foreign Host header. Never exposed beyond this machine.
Stop with Ctrl+C.`;

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // `start` needs cmd; the empty title arg keeps URLs with & intact
      spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export default async function web(args) {
  if (args[0] === 'help') {
    console.log(HELP);
    return 0;
  }
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 0;
  if (portIdx >= 0 && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    console.error('raph: --port needs an integer between 0 and 65535');
    return 1;
  }

  const token = makeToken();
  let started;
  try {
    started = await startConsole({ token, port });
  } catch (err) {
    console.error(`raph: could not start the console: ${err.message}`);
    return 1;
  }

  console.log(`raph console  ->  ${started.url}`);
  console.log(`  bound to ${CONSOLE_HOST} only · token rotates every launch · Ctrl+C to stop`);
  if (!args.includes('--no-open')) openBrowser(started.url);

  // foreground: hold the process open until the user stops it
  await new Promise((resolve) => {
    const stop = () => started.server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  console.log('raph: console stopped');
  return 0;
}
