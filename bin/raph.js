#!/usr/bin/env node
import { run, EXIT_CODES } from '../src/cli.js';

// Exit codes are a contract (see EXIT_CODES in src/cli.js). A CRASH must not
// share code 2 with a deliberate policy verdict — `raph adopt` blocked by the
// reviewer and `raph academy drive` failing a stage both return 2 on purpose, so
// scripts and CI could not tell "the reviewer rejected this" from "raph threw a
// TypeError" (audit 2026-07-26). 70 is BSD EX_SOFTWARE: an internal error.
run(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`raph: ${err.message}`);
    process.exit(EXIT_CODES.crash);
  }
);
