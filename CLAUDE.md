# Raphael — instructions for Claude

Raphael is a learning layer ("brain") for AI coding agents: it distills lessons from
the developer's real projects and injects the relevant ones back into agent context at
the right moment. Ships as a Claude Code plugin with a Node CLI (`raph`).

## Key documents — read before making design decisions
- `ARCHITECTURE.md` — the full design. Source of truth for every decision. §10 = build order, §11 = decided product calls.
- `.claude/TASKS.md` — the build checklist. Source of truth for progress.
- `.claude/logs/` — one log file per working session.

## Working ritual (mandatory, after every completed task)
Run these IN ORDER at every task boundary — a "task" is any unit you'd report as done.
The point: never carry undocumented or uncommitted work across a context boundary, so a
compaction (manual or automatic) can never lose progress.
1. Run `npm test` before declaring anything done. Tests must stay green.
2. **Update docs** — tick the task in `.claude/TASKS.md` (add newly discovered tasks under
   the right phase); append to the current session's log in `.claude/logs/YYYY-MM-DD-NN.md`
   (what was done, bugs + fixes, decisions, what's next); update "Current state" below if the
   project's shape changed; refresh any product README/reports the task touched.
3. **Commit + push properly** — commit the raphael repo with a clear message and push to its
   remote. Academy products commit to their OWN repo; publishing them is now in scope (do it)
   UNLESS the task itself is still mid-build — push a product only when its milestone is green.
4. **Then compact** — once 1–3 leave a clean, committed, documented state, compact the
   context (`/compact`) so the next task starts lean.
   - Honest mechanics: `/compact` is a terminal keystroke the *user* (or Claude Code's
     auto-compact on a full context) triggers — Claude cannot press it from a tool call. So
     steps 1–3 are the real guarantee: they are done EVERY time first, which is what makes a
     compact safe. At each task boundary, state plainly "task complete, clean + pushed — safe
     to /compact" so the compaction has a clean checkpoint to fold to.
   - During an autonomous Academy build, the durable `raph academy checkpoint` (written after
     each milestone, alongside the commit) is the belt-and-suspenders: even a mid-task
     compaction or a limit/reboot resumes from it.

## Current state (updated 2026-07-14, session 03)
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
- Security starter pack (session 02, 2026-07-14) COMPLETE: distilled the owner's
  `emergent-security-prompts` PDF (5 pro audit checklists — Gitleaks/Bearer/ECC/Trail of
  Bits) into three additions. (a) src/lib/security-pack.js = 19 atomic security lessons +
  `raph pack [list | add security [--dry-run]]` (src/commands/pack.js) — cold-start value:
  seeds a fresh brain with the mistakes that cause most breaches. Every lesson enters via
  writeCandidate() → validateLesson() (the ONE chokepoint), URL-free, declarative voice,
  category security + tier curated + status candidate, so it lands as a REVIEWABLE candidate
  on the heavyweight security-approve path (never machine-activates). (b) +3 eval scenarios
  (S20 IDOR, S21 security-headers, S22 client-price) with pure checkers; all three defending
  lessons verified to FIRE (no retrieval miss). (c) `security-audit` recipe (the 5 checks in
  order) in agents.js; pre-deploy recipe runs it first — the deploy gate for Phase 12. 182/182.
- Security pack completed to 26 lessons (session 02): +7 gap-closers (XSS, data-deletion,
  debug/test-endpoint removal, env-var startup validation, DB TLS+creds, internal-file
  exposure, Supabase-anon-key-needs-RLS) — full coverage of all five checklists.
- Phase 12 (Academy) STARTED (session 02, 2026-07-14). Owner rejected all suggested idea sets
  and gave three of their own; decision = build "Repo Keeper" first (a GitHub repo-lifecycle
  agent suite: freshness + doc-sync + security auditor). Expanded backlog in
  docs/academy/backlog.md.
  - Checkpoint/resume driver built: `raph academy start|status|resume|checkpoint|boundary|
    limit|list` (src/lib/academy.js + commands/academy.js); state in
    ~/.raphael/academy/<project>/state.json; RESUME.md + AUTORESUME.md + resume.ps1 + a
    no-admin Startup-folder logon launcher. Survives limit resets AND reboots; Layer 1
    (checkpoint) reliable, Layer 2 (auto-launch) best-effort. 189 -> 189+ tests green.
  - Repo Keeper product at C:/Users/Mahesh/Desktop/Projects/repo-keeper (own git, LOCAL only,
    never pushed) — v1 COMPLETE, all 5 milestones, 41 tests, commits b304a91..0296267:
    `keeper scan|freshen|docs|audit|report`. Three agents (freshness, doc-sync, security
    auditor) over one scanner, folded into one vitality verdict. Dogfooded on the raphael repo
    (`keeper report`) which caught a real false-positive class (fixture secrets) -> fixed.
    Wrote 3 lessons back to the brain (candidates). academy status=done.
  - AUTONOMY BOUNDARY (enforced + honored): the whole build stayed local + committed locally;
    publishing repo-keeper (git push / GitHub repo) was NOT done — it's the owner's action.
- Session 03 (2026-07-14) — owner corrections applied:
  (a) Repo Keeper PUBLISHED to GitHub (public: github.com/maheshaggarwal21/repo-keeper).
  Self-audited clean first (`keeper audit` = no secrets); repo created via the GitHub API using
  the cached Git Credential Manager token (never printed), then `git push`. Topics added for
  discovery. repo-keeper is no longer local-only.
  (b) Flywheel STARTED: `raph pack add security` then approved ALL 29 candidates — 26 security
  (each via the heavyweight one-at-a-time `--confirmed` review path the code enforces) + 3
  tooling. Brain went from 0 -> 29 ACTIVE lessons. `raph status` = active=29, 0 pending.
  (c) Working ritual updated (see above): every task boundary = npm test -> update docs ->
  commit/push -> compact. Honest caveat recorded: Claude cannot press `/compact` from a tool, so
  steps 1-3 are done every time as the real guarantee against losing work to a compaction.
  (d) Academy project #2 = "One Desk" chosen by Claude (owner said "decide yourself"): a
  personal+business money engine & advisor (spec: docs/academy/onedesk-plan.md). The photo
  grouper was parked with a blunt reason — its value is on-device face ML + a GUI, neither
  verifiable head-lessly, so it is the wrong FIRST autonomous build. One Desk's core is pure
  deterministic money logic = fully testable, same shape that made Repo Keeper work. Scaffolded
  at Desktop/Projects/onedesk (own git). M1 SHIPPED (commit 3a41f4e, 28 tests): money core +
  advisor — `onedesk report` answers safe-to-pay-yourself / tax set-aside / runway over a JSON or
  CSV file; verified on the sample; PUBLISHED public (github.com/maheshaggarwal21/onedesk),
  keeper-audited clean. The build wrote back + approved a money-cents lesson, so the brain is now
  30 active. `raph academy status onedesk` = in-progress, 2/5, M3 next (M1+M2 shipped + pushed).
- Session 03 (later) — owner set a STANDING FULL-AUTONOMY mandate: "you have to be autonomous,
  i should not say resume again and again you are on your own from now on." So: build milestone
  by milestone without asking, run the ritual each time (test -> docs -> commit+push -> publish
  green milestone -> checkpoint -> continue). Auto-resume RE-ARMED and made project-agnostic
  (.claude/academy/resume.ps1 finds any in-progress project; Startup launcher back in place) so a
  reboot or limit-reset continues the build with no owner input. Memory: [[full-autonomy-academy-mandate]].
  One Desk M2 shipped (commit 794e7cf, 44 tests): categorization + recurring detection + anomaly
  flags; published; brain -> 31 active (anomaly-threshold lesson).
- Next: build One Desk M3 (advisor narrative + monthly report). Then M4 (import + local store),
  M5 (thin UI, behind boundary). Then Phase 9 packaging, Phase 7 `raph init --guard`.
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
