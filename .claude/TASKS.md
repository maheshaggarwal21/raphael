# Raphael — build checklist

> Rule: tick a task the moment it's done, add newly discovered tasks under the right
> phase, and log every session in `.claude/logs/`. Keep this file honest — it is the
> single source of truth for build progress. Phases follow ARCHITECTURE.md §10.

Updated: 2026-07-13 (session 01, second pass)

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

## Phase 2 — Mining (`raph mine`)
- [ ] Transcript locator: map cwd → `~/.claude/projects/<sanitized>` + per-project consent registry in config
- [ ] Episode detector: error→fix arcs (tool_result error followed by edits then success)
- [ ] Episode detector: user corrections ("no,", "that's wrong", "revert", "undo")
- [ ] Secret scrub applied to every episode BEFORE storage (already built — wire it in)
- [ ] `state/mined.jsonl` ledger: content-hash keyed, written only at end of successful run
- [ ] `raph mine` command with funnel report (sessions → episodes) + `--dry-run`
- [ ] `raph note "<text>"` — manual capture straight to candidates
- [ ] Skip live sessions (file modified < 10 min ago)

## Phase 3 — Extraction + gates
- [ ] Contained extraction: zero-tool structured-output call (cheap model) per episode
- [ ] Gate G1: every evidence ref must resolve to a real mined episode
- [ ] Gate G4: ephemera kill (ports, local paths, machine names)
- [ ] Gate G5/G7: common-knowledge counterfactual + actionability (cheap model rubric)
- [ ] Dedupe: content hash + trigram similarity vs existing lessons and rejected fingerprints
- [ ] Candidate cap (10/run) + cost estimate + confirm threshold
- [ ] Rejection memory with expiry + audit surface

## Phase 4 — Review flow
- [ ] `/brain-review` skill: batch cards, `1y 2n 3e 4?` grammar
- [ ] Heavyweight path: security-category + quarantined need full-body individual confirm
- [ ] `raph queue / approve / reject / promote` (idempotent)
- [ ] Rejected-candidate tombstones feed dedupe

## Phase 5 — Index + injection
- [ ] `index/compiled.json` builder, hash-verified against lesson files (not just mtime)
- [ ] Deterministic matcher + scorer (stack, triggers, paths, recency; explainable)
- [ ] SessionStart hook: advisory preamble + stack digest (≤340 tokens)
- [ ] UserPromptSubmit hook: ≤3 headlines, typical 0, p95 < 150ms, fail-open
- [ ] Session token cap (1,200) + per-lesson session dedupe
- [ ] `brain-recall` pull skill + `raph search` / `raph show`
- [ ] `state/events.jsonl` telemetry (one line per injection) + `raph why` + `raph on/off`

## Phase 6 — Eval harness
- [ ] 6 adversarial canaries (command-shaped AND declarative-voice payloads), 100% gate
- [ ] 3 deterministic scenarios: S01 env-commit, S15 secrets-in-logs, S08 float-money
- [ ] `raph eval run`: headless claude -p, ON vs OFF arms, lift table
- [ ] Tokens-per-completed-task metric in the report

## Phase 7 — Project maps + secrets guard
- [ ] `raph map` generator (one cheap-model pass, cached, `--refresh`)
- [ ] `raph init --guard`: deterministic pre-commit secret scanner for user projects

## Phase 8 — Agent layer
- [ ] Shared spine prompt fragment (brain first, free checks first, map not repo, cheap→strong, write-back)
- [ ] Flagship agents: Code Reviewer, Security Engineer, Debugger
- [ ] Manager (route + merge), Developer, Design, Deploy, Critique (working, simpler)
- [ ] Agent write-back: runs emit episodes into mining

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

## Parked (post-v1, deliberate)
Team sync/merge, SQLite, embeddings, confidence formulas, phase detection,
PostToolUse tripwires, eval CI/baselines/ablation, TUI review, trusted co-reviewers.
