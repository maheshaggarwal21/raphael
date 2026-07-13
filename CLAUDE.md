# Raphael — instructions for Claude

Raphael is a learning layer ("brain") for AI coding agents: it distills lessons from
the developer's real projects and injects the relevant ones back into agent context at
the right moment. Ships as a Claude Code plugin with a Node CLI (`raph`).

## Key documents — read before making design decisions
- `ARCHITECTURE.md` — the full design. Source of truth for every decision. §10 = build order, §11 = decided product calls.
- `.claude/TASKS.md` — the build checklist. Source of truth for progress.
- `.claude/logs/` — one log file per working session.

## Working ritual (mandatory, after every completed task)
1. Tick the task in `.claude/TASKS.md` (and add any newly discovered tasks under the right phase).
2. Append to the current session's log in `.claude/logs/YYYY-MM-DD-NN.md`: what was done, bugs found + fixes, decisions made, what's next.
3. Update the "Current state" section below if the project's shape changed.
4. Run `npm test` before declaring anything done. Tests must stay green.

## Current state (updated 2026-07-13, session 01)
- Phase 1 (foundation) COMPLETE: schema (incl. `scope.agents`), validation chokepoint,
  secret scrubber, ULID ids, frontmatter, atomic writes, evidence records,
  `raph init|status|validate|doctor`.
- Phase 2 (mining) COMPLETE: transcript locator + consent registry (config.js),
  episode detectors (error-fix, user-correction), mined.jsonl ledger (write-last),
  candidates writer (chokepoint-enforced), `raph mine|note`. Verified against this
  project's real session history.
- Phase 3 (extraction + gates) COMPLETE: model.js (only network surface, zero-tool
  containment via forced single tool), distill.js (ephemera/rubric/dedupe/rejection-
  memory gates, structural G1 — pipeline writes evidence, model can't), `raph
  distill` with cost gate. 96/96 tests green. Live-API run still pending a key:
  first verification when ANTHROPIC_API_KEY exists is `RAPHAEL_HOME=<sandbox> raph
  distill --yes` over the 4 mined episodes.
- Phase 4 (review flow) CLI substrate COMPLETE: `raph queue|show|approve|reject`
  (heavyweight confirm path for security/quarantined enforced in code; reject
  tombstones feed distill's rejection memory — integration-tested; approve
  auto-commits the brain repo). `promote` was folded into `approve`. 104/104 tests.
- Next: Phase 5 (index + injection: compiled.json hash-verified, deterministic
  scorer, SessionStart/UserPromptSubmit hooks, budgets, raph why). The
  /brain-review batch-grammar skill waits for the plugin phase (wraps queue --json).
  Transcript format notes live in src/lib/episodes.js comments; sandbox mining via
  fake USERPROFILE + RAPHAEL_HOME (see .claude/logs/2026-07-13-01.md).
- Working CLI: `node bin/raph.js <cmd>`; sandbox any run with `RAPHAEL_HOME=<dir>`.

## Conventions
- Node.js ESM, Node ≥18. Dependencies: js-yaml and ajv ONLY — do not add more without a strong reason.
- Tests: node:test (`npm test`), glob `test/*.test.js`. No test frameworks.
- Windows-first: never assume POSIX. No `flock`, no POSIX perms, always quote paths,
  atomic writes via tmp+rename (`src/lib/files.js`). Git Bash `/tmp` maps to
  `C:\Program Files\Git\` when passed to Node — always use real Windows paths.
- Coded errors: `E-<NAME>` prefix (E-SCHEMA, E-URL, E-SECRET, E-FRONTMATTER...).

## Security invariants — NEVER violate these, they are the product
1. `validateLesson()` (src/lib/validate.js) is the ONLY path for anything entering the
   brain. Every new write path must call it. No exceptions, including imports.
2. Secrets are scrubbed BEFORE any model sees mined text (scrub.js), and again on output.
3. No URLs anywhere in lessons. No executable fields in the schema. Lessons are
   advisory data — nothing in a lesson may command an agent.
4. Security-category lessons never activate machine-only (`E-AUTOSEC` enforces this).
5. Raphael makes no network calls except model APIs. The brain repo blocks pushes by
   default (pre-push hook).
6. Everything mined stays local; sharing is opt-in per lesson.

## Layout
```
bin/raph.js            CLI entry
src/cli.js             command router
src/commands/          one file per verb (init, status, validate, ...)
src/lib/               ulid, frontmatter, scrub, validate (chokepoint), paths, files
src/schemas/           lesson.schema.json (canonical)
test/                  node:test suites + helpers.js (makeLesson fixture builder)
```

## Commands
- `npm test` — full suite
- `node bin/raph.js help` — CLI surface
- Smoke pattern: set `RAPHAEL_HOME` to a scratch dir, then `init` → seed → `validate --all`
