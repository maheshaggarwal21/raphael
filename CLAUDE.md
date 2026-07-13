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
- Phase 5 (index + injection) COMPLETE: compile.js (compiled.json, sha256 hash-verified
  + rebuild-on-change, re-validates every lesson), match.js (deterministic explainable
  scorer), inject.js (recall engine: budgets ≤1,200/session, data-envelope framing,
  session dedupe, fail-open), stacks.js. Commands: `raph inject|search|why|on|off`.
  `raph note --keywords` added. docs/hooks.md = manual hook wiring; brain-recall skill
  substrate in plugin/skills/. 133/133 tests. Known follow-up: cold hook ~300ms on
  Windows > 150ms target (fine for the rare fires; warm-resident later).
- Owner's four new directions (2026-07-13) — status:
  (1) DONE + LIVE-VERIFIED (2026-07-13 20:23 IST) — subscription model provider
  (src/lib/provider.js): distill uses local `claude -p` (fixed-price subscription) by
  default, API key fallback; same zero-tool containment; E-LIMIT stops cleanly with reset
  time. Live run confirmed end to end: a real `claude -p --json-schema` extraction on the
  subscription (zero tools, cost ~$0.007/tiny call) → gated → staged candidate. The live
  run CAUGHT A REAL BUG the pure-logic tests missed: with `--json-schema` the payload lands
  in `structured_output` and `result` is an EMPTY STRING ""; the old `result ?? structured_output`
  let `""` (not nullish) shadow the real object → extraction returned null. Fixed:
  extractObject prefers structured_output and skips empty strings (regression test added).
  (2) DONE — Planner + Architect added; roster 8 -> 10 (schema, ARCHITECTURE §8).
  (3) DONE — docs/prompt-library.md extracted from the 23 screenshots (agent-design input).
  (4) DESIGNED — self-training pipeline = ARCHITECTURE §12 + TASKS Phase 12 ("Raphael
  Academy"): autopilot builds real diverse projects, self-manages limits (auto-resume at
  reset), model/effort switching, checkpointing, enforced autonomy boundary (stops at
  deploy/sign-in/spend), sandbox workspace. NOT built yet — awaits owner go + depends on
  agent layer (Phase 8) and eval (Phase 6).
- Installed Claude Code CLI is v2.1.168; confirmed flags: -p, --output-format json,
  --json-schema, --tools "", --strict-mcp-config, --model, --effort, --resume,
  --session-id, --max-budget-usd. `--bare` forces API-key auth (so subscription = NO
  --bare + no ANTHROPIC_API_KEY in child env). claude.exe at
  ~/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe.
- Phase 6 (eval harness) COMPLETE: src/eval/ = canaries.js (3 command-shaped chokepoint
  canaries in the 100% gate + 3 declarative-voice behavioral probes), scenarios.js (S08
  float-money, S15 secrets-in-logs, S01 env-commit — pure file-inspecting checkers),
  harness.js (ON/OFF orchestration, Wilson CIs, cross-model guard, retrieval-MISS,
  tokens-per-task ratio), runner.js (real `claude -p` in throwaway fixtures, tools ON for
  writes — deliberately unlike distill's zero-tool path). `raph eval run [--quick]
  [--dry-run] [--scenario id] [--trials N] [--model M]`. --dry-run spends nothing (canaries
  + retrieval check). 160/160 tests. Live smoke ran real agents both arms end to end.
- Phase 8 (agent layer) COMPLETE + Phase 7 map pulled forward: src/lib/agents.js is the
  single source (SPINE + 10-agent roster data + renderAgent + 3 recipes); scripts/
  build-agents.mjs generates plugin/agents/*.md + plugin/recipes/*.md (regenerate on any
  roster/spine change, commit output). Flagships: Planner, Architect, Reviewer, Debugger.
  src/lib/map.js + `raph map [--refresh] [--summary]` = the project map (deterministic scan
  + git-churn hot files, zero tokens by default; optional cheap-model summary). 172/172 tests.
- Next: Phase 12 Academy (self-training) now has its two prerequisites (eval + agents) — but
  it still needs the owner's explicit go + the two open decisions (autonomy boundary detail,
  first project backlog). Otherwise: Phase 9 plugin packaging, Phase 7 `raph init --guard`.
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
5. Raphael makes no network calls except to reach a model — either the Anthropic
   Messages API directly (api provider) or by shelling out to the logged-in Claude Code
   CLI (subscription provider, the default; `claude -p` with `--tools ""` +
   `--strict-mcp-config` so the contained model still executes nothing). No other
   network access. The brain repo blocks pushes by default (pre-push hook).
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
