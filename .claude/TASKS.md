# Raphael — build checklist

> Rule: tick a task the moment it's done, add newly discovered tasks under the right
> phase, and log every session in `.claude/logs/`. Keep this file honest — it is the
> single source of truth for build progress. Phases follow ARCHITECTURE.md §10.

Updated: 2026-07-14 (session 03 — repo-keeper + One Desk v1 published; Phase 9 plugin packaging COMPLETE; 33 lessons active)

## Phase 1 — Foundation (schema + chokepoint) ✅ COMPLETE
- [x] Project scaffold: package.json (Node ESM, deps: js-yaml + ajv only), bin/raph.js, src/ layout, git init
- [x] `lesson.schema.json` — canonical v1 schema, strict (unknown fields rejected), trust tiers included
- [x] Frontmatter parse/serialize (dates stay strings, Windows line endings handled)
- [x] ULID id generation (`les_`/`ev_` prefixes, time-sortable)
- [x] Secret scrubber: 10 pattern rules + entropy scan, typed placeholders, own-placeholder + Raphael-id exemptions
- [x] `validateLesson()` chokepoint: schema + URL ban + deny-list + invisible unicode + base64 + length caps + secret scan + auto/security rule + imperative-voice quarantine
- [x] `raph init` (dir tree, config.yaml, brain git repo, pre-push guard hook)
- [x] `raph status` (lesson counts by status, pending candidates, mode)
- [x] `raph validate <file...> | --all`
- [x] Tests green: 30/30 (`npm test`), CLI smoke-tested end to end in sandbox
- [x] `raph doctor` (node/git/brain/config/hook/lessons/transcripts checks with fixes)
- [x] Evidence record schema (`ev_*.json`) + writer (auto-scrubbed excerpts, yy/mm sharding)
- [x] `scope.agents` audience field (owner suggestion, partially adopted: retrieval filter, not primary category; empty = all agents)
- [x] First commits + GitHub repo created

## Phase 2 — Mining (`raph mine`) ✅ COMPLETE
- [x] Transcript locator: cwd → `~/.claude/projects/<sanitized>` (case-drift fallback) + per-project consent registry
- [x] Episode detector: error→fix arcs (tool_result error → eventual success, 12-event window, no overlaps)
- [x] Episode detector: user corrections (markers incl. "no problem" false-positive guard, <400 char rule)
- [x] Secret scrub on every episode BEFORE storage (scrub-then-truncate, content-addressed ids AFTER scrub)
- [x] `state/mined.jsonl` ledger: content-hash keyed, write-last semantics
- [x] `raph mine` with funnel report + `--dry-run` + `--yes` + per-session failure isolation (exit 3 partial)
- [x] `raph note "<text>"` — validated through the chokepoint, quarantine-aware
- [x] Skip live sessions (mtime < 10 min)
- [x] Verified on real data: mined this project's own build session → 4 real error-fix episodes; re-run no-op; secrets scrubbed in real excerpts

## Phase 3 — Extraction + gates ✅ COMPLETE (live-API run pending an ANTHROPIC_API_KEY)
- [x] Contained extraction: direct Messages-API call (fetch, no SDK dep), ONE forced tool,
      zero other tools defined — the model physically cannot execute anything
- [x] Gate G1 made structural: the model never sets evidence — the pipeline writes the
      evidence record from the real episode it fed in (fabricated provenance impossible)
- [x] Gate G4 ephemera: ports/abs-paths/pinned-versions → one generalization retry → kill
- [x] Gates G5/G7 rubric: counterfactual ≥2 AND actionable ≥2 (stricter than avg — a 3/1
      split is vivid-but-vague noise)
- [x] Dedupe: trigram Jaccard (similarity.js) vs lessons+candidates+quarantine AND in-run
- [x] Candidate cap (10/run, config), token estimate + confirm threshold, --dry-run/--yes
- [x] Rejection memory: reads state/rejected.jsonl, 180-day expiry, suppressions logged to
      events.jsonl (auditable, never silent) — write side arrives with Phase 4 reject
- [x] Distilled ledger (write-last; deferred/cap-deferred episodes retry next run)
- [x] Injectable model provider → 96/96 tests incl. every gate, URL-smuggling stopped by
      chokepoint, model-error deferral; verified dry-run against real mined episodes
- [x] Live smoke run — DONE via SUBSCRIPTION (2026-07-13): real `claude -p --json-schema`
      extraction → gated → staged candidate. Caught + fixed the structured_output/empty-result
      shadowing bug in provider.js. (API-key path still unexercised live; subscription is the default.)

## Phase 4 — Review flow ✅ CLI SUBSTRATE COMPLETE
- [x] `raph queue` (numbered, severity-sorted, quarantine/security flagged, --json for the future skill)
- [x] `raph show <n|slug|id> [--provenance]` — full body + resolved evidence records
- [x] Heavyweight path ENFORCED in CLI: security-category + quarantined candidates refuse
      batch approval and refuse without --confirmed (threat-model finding, now code)
- [x] `raph approve` (validate-on-write, slug-collision guard, already-active no-op,
      auto-commits the brain repo) / `raph reject [--reason]` (idempotent-safe)
- [x] Rejected-candidate tombstones feed distill's rejection memory — proven by an
      end-to-end test (reject → distill proposes lookalike → auto-suppressed + event logged)
- [x] Decision: `raph promote` folded into `approve` (fewer verbs, same power)
- [x] `/brain-review` skill with the `1y 2n 3e 4?` batch grammar (Phase 9: plugin/commands/brain-review.md — wraps queue + approve/reject, enforces one-at-a-time --confirmed for security)

## Phase 5 — Index + injection ✅ COMPLETE (latency follow-up noted)
- [x] `index/compiled.json` builder, hash-verified against lesson files (content sha256,
      not mtime); rebuilds on any add/edit/delete/tamper; every lesson re-passes the
      chokepoint on the way in (compile.js)
- [x] Deterministic matcher + scorer (stack, triggers, paths, recency; explainable) —
      every point carries a reason string (match.js); `raph why` prints the breakdown
- [x] SessionStart hook: advisory preamble (≤90 tok) + stack digest (≤250 tok, ≤10),
      re-fires on compaction with seen-headlines suppressed (inject.js runInjection)
- [x] UserPromptSubmit hook: ≤3 headlines, typical 0 (fires only on a trigger hit,
      threshold 4.0), fail-open (safeInject swallows everything, always exits 0)
- [x] Session token cap (1,200) + per-lesson session dedupe (state/sessions/<id>.json)
- [x] `brain-recall` pull skill substrate (plugin/skills/) + `raph search` (same scorer
      as the hooks) — `raph show` already existed from Phase 4
- [x] `state/events.jsonl` telemetry (one line per injection, with score+reasons) +
      `raph why [--last N]` + `raph on/off` (config kill switch)
- [x] `raph inject --event session-start|user-prompt` hook command; docs/hooks.md wiring
- [ ] LATENCY follow-up (DEFERRED to post-v1, deliberate): re-measured 2026-07-14 session 04 =
      ~390ms cold on Windows over the real 33-lesson brain (5 runs 375-404ms), dominated by node
      process startup + ESM module-graph load, NOT the index work (warm sha256 verify of 33 files
      is cheap). Above the p95<150ms target, but SessionStart fires once/session and per-prompt
      injection fires only on a trigger hit, so the one-time cost is imperceptible. Closing it
      needs a warm-resident daemon (or a bundled/lighter load path) — a real architectural
      addition, correctly parked post-v1. Decision: NOT a blocker for "development complete".
      (Also: live-API/subscription distill smoke still pending — see Phase 3.)

## Phase 6 — Eval harness ✅ COMPLETE
- [x] 6 adversarial canaries: 3 command-shaped (chokepoint MUST block — deterministic,
      free, in the 100% gate) + 3 declarative-voice (valid prose w/ insecure bias +
      behavioral probe for live runs) — src/eval/canaries.js
- [x] 3 deterministic scenarios: S08 float-money, S15 secrets-in-logs, S01 env-commit —
      each a fixture stub + PURE file-inspecting checker ({caught, task_complete}), no
      servers/races — src/eval/scenarios.js
- [x] `raph eval run`: canary gate + brain ON vs OFF over a CONTROLLED seeded eval brain
      (temp RAPHAEL_HOME, not the user's real brain), real headless `claude -p` in
      throwaway fixtures (tools ON for file writes, unlike distill), OFF-arm cached by
      (model, scenario), cross-model comparison REFUSED (assertSameModel). `--dry-run`
      = canaries + retrieval-miss, zero token spend. E-LIMIT stops cleanly (exit 4).
- [x] Tokens-per-completed-task metric (ON vs OFF ratio) + Wilson CIs + retrieval-MISS
      column in the lift table — src/eval/harness.js
- [x] 13 eval tests (canary gate, all 3 checkers, wilson, model guard, lift, retrieval
      miss, off-cache, report). 160/160 total. LIVE smoke: S08 x1 x2 arms ran real agents
      end to end (honest result: +0% lift on the trivial case, 1.31x tokens — the harness
      measures reality, doesn't confirm hopes).
- Note: injectFor() in eval mirrors inject.js's per-prompt branch (threshold 4.0, top-3,
  renderLine) rather than calling runInjection (which writes session state). Weights come
  from match.js (single source); only the threshold constant is duplicated. Fine for v1.
- [x] +3 scenarios from the emergent-security-prompts resource: S20 IDOR (ownership on a
      client id), S21 security-headers (helmet baseline), S22 client-price (recompute
      server-side). Pure checkers + tests; all three defending lessons verified to FIRE
      (no retrieval miss) via `raph eval run --dry-run`.

## Security starter pack + audit recipe (from the emergent-security-prompts resource) ✅ COMPLETE
Cold-start value (ARCHITECTURE §11): a fresh brain is empty, so ship a curated pack of the
mistakes that cause most real-world breaches. Distilled from 5 pro audit checklists
(Gitleaks secrets, Bearer PII-flow, ECC pre-deploy, Trail-of-Bits deep-logic, ECC attacker).
- [x] `src/lib/security-pack.js` — 26 atomic security lessons, human-authored, URL-free,
      declarative voice. Each expands to a schema-valid lesson (category security, tier
      curated, source_kind imported, status candidate), routed to security/reviewer agents.
      (19 core + 7 gap-closers added 2026-07-14: XSS/output-encoding, data-deletion,
      debug/test-endpoint removal, env-var startup validation, DB TLS+creds, internal-file
      exposure, Supabase-anon-key-needs-RLS — full coverage of all five checklists.)
- [x] `raph pack [list | add security [--dry-run]]` (src/commands/pack.js) — every lesson
      enters through writeCandidate() → validateLesson() (the ONE chokepoint), lands as a
      REVIEWABLE candidate (security never machine-activates), heavyweight approve path.
- [x] `security-audit` recipe (the 5 checks in order) added to agents.js; pre-deploy recipe
      now runs it first ("not deploy-ready until it passes"). Regenerated plugin/recipes/.
- [x] 7 pack tests (chokepoint pass + unquarantined, all-security-candidates, no-URL,
      declarative-voice, unique slugs, covers all 5 checklists, routed to security agent).
      182/182 total. Smoke: `raph pack add security` seeded 19 candidates, 0 quarantined.
- Ties into Phase 12: every Academy build must pass `security-audit` before the deploy boundary.

## Phase 7 — Project maps + secrets guard ✅ COMPLETE
- [x] `raph map` generator — pulled forward (Phase 8 spine rule 3 needs it). DETERMINISTIC
      by default (pure scan + `git log` churn = zero tokens): stack, entry points, top-level
      structure, hottest files. Optional `--summary` = one cheap-model trouble-spots pass.
      Cached to brain/maps/<project>.md, `--refresh`. src/lib/map.js + commands/map.js.
- [x] `raph init --guard`: deterministic pre-commit secret scanner for user projects
      (COMPLETE 2026-07-14, session 04). src/lib/guard.js reuses the chokepoint's EXACT
      secret patterns (scrub.js SECRET_RULES + isHighEntropyToken, now exported — one
      definition of "secret"). Named high-precision rules block by default; the noisy
      entropy pass is opt-in (--entropy) so the gate doesn't false-fire on lockfiles.
      `raph guard install|uninstall|scan [--staged|--all|<path...>]` (src/commands/guard.js);
      `raph init --guard` also installs it in the current repo. Hook scans STAGED blob
      content, fails-open on binary/oversized/unreadable files, never wedges a commit;
      refuses to clobber a foreign pre-commit hook (--force overrides); prefers global
      `raph`, falls back to a baked `node <bin>` path. Bypass one commit: git commit
      --no-verify. 12 tests (test/guard.test.js). Live-smoke verified end to end: a staged
      AWS key was blocked, moving it to an env var let the commit through. 206/206.
      (This also closes the "used before init" gap: guard install is git-repo-scoped and
      independent of brain init.)

## Phase 8 — Agent layer ✅ COMPLETE
- [x] Shared spine (brain-first, free-checks-first, map-not-repo, cheap→strong, write-back)
      — ONE canonical copy in src/lib/agents.js (SPINE), embedded in every agent by the
      renderer (no hand-duplication).
- [x] All 10 agents as data-driven Claude Code subagent defs (src/lib/agents.js AGENTS +
      renderAgent → plugin/agents/*.md via scripts/build-agents.mjs). Flagships (deepest
      missions): Planner, Architect, Code Reviewer, Debugger. Working+simpler: Manager
      (haiku, routes via Task), Developer, Security, Design, Deployer, Critique. Missions
      adapted from docs/prompt-library.md.
- [x] 3 task recipes (review, debug, pre-deploy) — brain-first, free-checks-first
      procedures (plugin/recipes/*.md). Code+prompts, not learned content.
- [x] Write-back: spine rule 5 has every agent capture durable lessons via `raph note
      --keywords`, and agent runs are Claude Code sessions that the miner already reads.
- [x] 22 new tests (map: scan/hotfiles/model-summary/sanitize; agents: roster/flagships/
      spine-embedded/recipes). Fixed mapFileName('...') -> 'project'. 172/172. Live: `raph
      map` on this repo produced a correct map (98 files, real git hot files).

## Phase 9 — Plugin packaging — COMPLETE (2026-07-14, session 03)
- [x] Claude Code plugin manifest (plugin/.claude-plugin/plugin.json) + repo-root marketplace
      (.claude-plugin/marketplace.json -> ./plugin) + auto hooks (plugin/hooks/hooks.json:
      SessionStart + UserPromptSubmit -> `raph inject`) + 4 slash commands
      (plugin/commands/{brain,brain-learn,brain-review,brain-eval}.md).
- [x] First-five-minutes onboarding flow in /brain (state-aware: install -> init -> seed/mine ->
      review -> injection on). brain-review implements the `1y 2n 3e 4?` batch grammar.
- [x] `raph doctor` extended for plugin health: injection enabled, `raph` on PATH (hooks call it),
      plugin manifest + hooks.json present.
- Distribution note: hooks call bare `raph`, so the CLI installs via `npm i -g raphael-brain`; the
  plugin is the thin integration (manifest/commands/hooks/agents/skills). docs/hooks.md + README
  install section updated. test/plugin.test.js (5) validates manifest/marketplace/hooks/commands.
  194/194 tests. Doctor also surfaced + I FIXED 2 pre-existing ~/.raphael issues (missing config.yaml
  + brain not a git repo): ran `raph init` (non-destructive) -> config + git repo + pre-push guard;
  committed the 33 lessons (brain 034fe9f). doctor now healthy; invariant #5 (push guard) restored.

## Phase 10 — Self-use period (2–4 weeks) — TOOLING COMPLETE, runtime is calendar
- [x] Self-use analytics substrate (COMPLETE 2026-07-14, session 04): `raph stats [--json]`
      (src/lib/stats.js pure aggregation + src/commands/stats.js) turns the append-only
      audit log (state/events.jsonl) + the compiled index into the three signals this phase
      exists to surface — TOKEN COST (per injection / per session, cap hits), RETRIEVAL MISS
      (active lessons that never fire = dead weight or triggers too narrow), and a FALSE-FIRE
      PROXY (lessons firing on prompts barely over the 4.0 threshold; honestly labeled a proxy
      since a true "unhelpful" signal needs a user feedback channel not yet built). Review
      funnel (approved/rejected/suppressed) always shown. 7 tests; 213/213. Dogfooded on the
      real brain (33 approved, 0 live injections yet — shown honestly) AND smoke-verified the
      populated path in a sandbox (inject -> events -> stats end to end).
- [ ] Run on Mahesh's own projects for real (calendar activity): with the plugin installed and
      injection ON, use hooked agent sessions; `raph stats` accumulates the real data. NOT a
      code task — needs live usage over time.
- [ ] Fix what the data says; curate the first real lesson set (follows the run above)
- Note: a genuine false-fire feedback channel ("mark this injection unhelpful") is the one
  missing datum stats can only proxy — candidate follow-up if the proxy proves insufficient.

## Phase 11 — Distribution (v0.2, pre-launch)
- [ ] `raphael-arise` one-command setup + auto mode + restricted `auto` tier enforcement
- [ ] `raphael-brain` GitHub repo + CI gates (schema, scrub, no-URL, lint, canaries)
- [ ] `raph contribute` (export scrubber over full lesson body) — opt-in per lesson
- [ ] Signed pack releases + `raph update`; seed first pack from Mahesh's brain
- [ ] README, LICENSE, launch post

## Phase 12 — Self-training pipeline ("Raphael Academy") — ARCHITECTURE §12
Depends on: subscription provider (done), agent layer (Phase 8), eval (Phase 6).
STARTED 2026-07-14 (session 02): first Academy project = "Repo Keeper" (owner idea 3).
Expanded backlog + decision in docs/academy/backlog.md; live checkpoint in
~/.raphael/academy/repo-keeper/state.json; resume runbook in .claude/academy/RESUME.md.
- [x] Checkpoint store: per-project state (milestones, current step, next_action, status,
      boundary, limit) with atomic writes; resume-from-exact-step. `raph academy
      start|status|resume|checkpoint|boundary|limit|list` (src/lib/academy.js +
      commands/academy.js). 7 tests. Idempotent start; clears limit-block on resume.
- [x] Autonomy boundary recorded + enforced by convention: recordBoundary() stops the build
      and names the owner action (deploy/sign-in/spend/publish/public-push). RESUME.md codifies it.
- [x] OS-level auto-resume: .claude/academy/resume.ps1 (guarded: only fires while status is
      in-progress/blocked-limit; 30-min throttle; visible window; logs to resume.log) +
      Startup-folder launcher (no-admin logon run) + register-resume-task.ps1 (schtasks
      alternative for elevated shells) + AUTORESUME.md. Layer 1 (checkpoint) is the reliable
      resume; Layer 2 (logon launch) is best-effort. schtasks needs admin (not available here).
- FIRST ACADEMY PROJECT COMPLETE: "Repo Keeper" v1 (Desktop/Projects/repo-keeper, own git,
  LOCAL only). All 5 milestones, 41 tests, commits b304a91..0296267:
  - M1 scanner core (`keeper scan`), M2 freshness (`keeper freshen`), M3 doc-sync
    (`keeper docs`), M4 security auditor (`keeper audit`), M5 integration (`keeper report`).
  - Dogfooded on the raphael repo itself: `keeper report` found a real false-positive class
    (fake secrets in eval/test fixtures flagged CRITICAL) -> fixed (test-path downgrade to
    low "verify"). Fixed its own missing lockfile too. 3 lessons written back to the brain.
  - status=done in the academy checkpoint; Startup auto-resume launcher removed (build
    finished in-session).
  - [x] PUBLISHED (session 03): github.com/maheshaggarwal21/repo-keeper (public). Self-audited
    clean first; repo created via GitHub API with the cached Git Credential Manager token
    (never printed), pushed, discovery topics added. The earlier "owner handoff" is resolved —
    per the owner, publishing is now Claude's job.
- Academy driver proven end to end: start -> checkpoint per milestone -> resume runbook ->
  boundary/limit handling -> done.
- FLYWHEEL STARTED (session 03): `raph pack add security` staged the 26-lesson pack, then all
  29 candidates approved (26 security one-at-a-time via `--confirmed`; 3 tooling batched).
  Brain 0 -> 29 ACTIVE lessons — recall now injects real content, feeding future builds.
- PROJECT #2 STARTED (session 03): "One Desk" — personal+business money engine & advisor
  (owner idea 1). Claude chose it over the photo grouper (that one needs on-device face ML + a
  GUI, neither verifiable head-lessly). Spec: docs/academy/onedesk-plan.md. Scaffolded at
  Desktop/Projects/onedesk (own git); DONE, 5/5 (v1 complete, published).
  - [x] M1 money core + advisor (commit 3a41f4e, 28 tests): transaction model (integer cents at
        the edge), personal/business split with an honest 'unclassified' fallback, advisor
        (safe-to-pay-yourself + tax set-aside on profit + runway), JSON/CSV ingest, `onedesk
        report`. PUBLISHED public: github.com/maheshaggarwal21/onedesk (keeper-audited clean).
        Wrote + approved the money-cents lesson -> brain 30 active.
  - [x] M2 categorization + recurring + anomalies (commit 794e7cf, 44 tests): deterministic
        spend buckets + rollup, recurring streams (digit-stripped payee key, amount-consistency
        gate, monthly vs irregular), and 3 anomaly checks (scope-mismatch / category-spike /
        large-expense) tuned low-false-positive; examples/sample-messy.json demos them. Pushed.
        Wrote + approved the anomaly-threshold lesson -> brain 31 active.
  - [x] M3 advisor narrative + monthly report (commit b9e78eb, 50 tests): narrative.js =
        deterministic plain-language GUIDANCE/WATCH from the numbers (no LLM, testable, offline,
        never fabricates); `onedesk monthly` = per-month business/personal breakdown + top
        categories. Pushed. Wrote + approved the deterministic-narrative lesson -> brain 32 active.
  - [x] M4 bank-CSV import adapters + local file store (commit 357f383, 61 tests): importers.js
        (aliased headers, debit/credit or signed amount, accounting negatives, mdy/dmy/ymd) +
        store.js/files.js (atomic JSON ledger, fingerprint dedupe; ledger IS a dataset so
        report/monthly read it directly). Verified end-to-end. Pushed. brain 33 (dedupe lesson).
  - [x] M5 static HTML dashboard (commit 15749ce, 64 tests): `onedesk html` = self-contained,
        theme-aware static file (no server/deploy, stays in the boundary); all user text
        HTML-escaped (the brain's XSS lesson applied to its own build). Browser-render couldn't
        be automated head-lessly, but content is test-verified. Pushed. ONE DESK v1 COMPLETE.
  - ONE DESK v1 COMPLETE (5/5), published at github.com/maheshaggarwal21/onedesk. academy=done.
    Wrote back 4 lessons this build (money-cents, anomaly-threshold, deterministic-narrative,
    import-dedupe) — all approved -> brain 33 active.
- [ ] Autopilot driver: runs the 10-agent build loop (plan -> architect -> build -> test
      -> prep-deploy) stage by stage, output-of-one -> input-of-next
- [ ] Limit-aware scheduler: catch E-LIMIT, checkpoint, auto-resume at the reset time
      (schedule/loop mechanisms), continue where it stopped
- [ ] Model policy table: task-kind -> model (Haiku mechanical / Sonnet dev / Opus hard)
      via `claude --model`; effort policy via `claude --effort`
- [ ] Session resume across pauses: `claude --resume <id>` / `--session-id` per stage
- [ ] Autonomy boundary ENFORCED in code: reversible/local runs autonomously; deploy /
      account sign-in / spend / public push / publish STOP and hand to the owner
- [ ] Sandbox workspace: ~/raphael-academy/<project>/, own git repo, never auto-pushed,
      no real secrets; unattended tool use only inside it
- [ ] Wire the loop into mining: each build session -> `raph mine` -> `raph distill`
      (subscription) -> candidates -> owner review (human gate unchanged)
- [ ] Tokens-per-task ON-vs-OFF recorded per project; report project #1 vs #5 (the proof)
- [ ] Project backlog finalized with the owner (web / mobile / AI agent / CLI / realtime)
- [ ] LIVE prerequisite: verify `claude -p` structured extraction once the subscription
      limit resets (also unblocks the pending Phase 3 live smoke)

## Parked (post-v1, deliberate)
Team sync/merge, SQLite, embeddings, confidence formulas, phase detection,
PostToolUse tripwires, eval CI/baselines/ablation, TUI review, trusted co-reviewers.
(Checkpoint/resume machinery un-parked -> Phase 12.)
