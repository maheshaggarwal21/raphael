# Raphael — build checklist

> Rule: tick a task the moment it's done, add newly discovered tasks under the right
> phase, and log every session in `.claude/logs/`. Keep this file honest — it is the
> single source of truth for build progress. Phases follow ARCHITECTURE.md §10.

Updated: 2026-07-14 (session 02 — security pack + audit recipe + scenarios)

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
- [ ] `/brain-review` skill with the `1y 2n 3e 4?` batch grammar (arrives with the plugin phase — wraps queue --json + approve/reject)

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
- [ ] LATENCY follow-up: cold `raph inject` is ~300ms on Windows (node startup ~80ms +
      module load/work ~230ms), above the p95<150ms target. Fine for SessionStart
      (once/session) and rare UserPromptSubmit fires, but for a hot path we need a warm
      resident or a lighter load path. Tracked, not blocking. (Also: live-API/subscription
      distill smoke still pending — see Phase 3.)

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

## Phase 7 — Project maps + secrets guard
- [x] `raph map` generator — pulled forward (Phase 8 spine rule 3 needs it). DETERMINISTIC
      by default (pure scan + `git log` churn = zero tokens): stack, entry points, top-level
      structure, hottest files. Optional `--summary` = one cheap-model trouble-spots pass.
      Cached to brain/maps/<project>.md, `--refresh`. src/lib/map.js + commands/map.js.
- [ ] `raph init --guard`: deterministic pre-commit secret scanner for user projects
      (the remaining Phase 7 item — independent of the agent layer)

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

## Phase 9 — Plugin packaging
- [ ] Claude Code plugin manifest, hooks registration, skills: /brain, /brain-learn, /brain-review, /brain-eval
- [ ] First-five-minutes onboarding flow in /brain
- [ ] `raph doctor` extended for plugin health

## Phase 10 — Self-use period (2–4 weeks)
- [ ] Run on Mahesh's own projects; collect retrieval-miss, false-fire, token-cost data
- [ ] Fix what the data says; curate the first real lesson set

## Phase 11 — Distribution (v0.2, pre-launch)
- [ ] `raphael-arise` one-command setup + auto mode + restricted `auto` tier enforcement
- [ ] `raphael-brain` GitHub repo + CI gates (schema, scrub, no-URL, lint, canaries)
- [ ] `raph contribute` (export scrubber over full lesson body) — opt-in per lesson
- [ ] Signed pack releases + `raph update`; seed first pack from Mahesh's brain
- [ ] README, LICENSE, launch post

## Phase 12 — Self-training pipeline ("Raphael Academy") — ARCHITECTURE §12
Depends on: subscription provider (done), agent layer (Phase 8), eval (Phase 6).
- [ ] Checkpoint store: per-project state (project, milestone, step, per-stage Claude
      Code session ids) with atomic writes; resume-from-exact-step on restart
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
