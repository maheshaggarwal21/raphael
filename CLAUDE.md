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

## Current state (updated 2026-07-16, session 05)
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
  One Desk M2 shipped (commit 794e7cf, 44 tests): categorization + recurring + anomaly flags;
  published; brain -> 31. M3 shipped (commit b9e78eb, 50 tests): deterministic advisor narrative
  (GUIDANCE/WATCH, no LLM) + `onedesk monthly`; published; brain -> 32.
- LIMIT EVENT self-handled (session 03): an adversarial money-review Workflow (3 parallel agents)
  burned the session limit; recorded `raph academy limit`, stayed clean + pushed, and resumed M3
  INLINE after the 3:30pm IST reset. Takeaway: run autonomous Academy builds inline; heavy parallel
  workflows hit the limit fast. That money-review is still INCONCLUSIVE (agents errored before
  running) — re-run it, or an inline review, before claiming the money logic is externally audited.
- M4 shipped (commit 357f383, 61 tests): bank-CSV import adapters + atomic local ledger with
  fingerprint dedupe (the ledger IS a dataset, so report/monthly read it directly); published;
  brain -> 33 (dedupe lesson). academy 4/5.
- ONE DESK v1 COMPLETE (commit 15749ce, 64 tests): M5 = self-contained, theme-aware static HTML
  dashboard (`onedesk html`) with all user text HTML-escaped (the brain's XSS lesson applied to its
  own build); no server/deploy so it stays in the boundary. All 5 milestones shipped + published;
  academy onedesk=done. Both Academy products (repo-keeper, onedesk) are now DONE + public. The
  One Desk build wrote back 4 approved lessons -> brain 33 active.
- PHASE 9 (plugin packaging) COMPLETE (session 03): plugin/.claude-plugin/plugin.json manifest +
  repo-root .claude-plugin/marketplace.json (-> ./plugin) + auto hooks (plugin/hooks/hooks.json:
  SessionStart + UserPromptSubmit -> `raph inject`) + 4 slash commands (/brain hub+onboarding,
  /brain-learn, /brain-review with the 1y2n3e batch grammar, /brain-eval) + doctor plugin-health
  checks. Install = `npm i -g raphael-brain` then `/plugin marketplace add maheshaggarwal21/raphael`
  + `/plugin install`. README + docs/hooks.md updated. test/plugin.test.js. 194 tests.
- Doctor surfaced + I FIXED 2 pre-existing brain-health issues on the real ~/.raphael: config.yaml
  was MISSING and the brain was NOT a git repo (it had been populated by pack/note/approve while
  commitBrain fails soft — so the 33 lessons wrote to disk but were never versioned and the pre-push
  guard was absent). Ran `raph init` (verified non-destructive in init.js: only creates what is
  missing, never touches lessons) -> created config.yaml (v1 schema) + git-init'd the brain +
  installed the pre-push guard; committed the 33 lessons as the initial snapshot (brain 034fe9f).
  `raph doctor` now reports healthy. The brain finally has history + the accidental-push guard
  (invariant #5). Note for future: a bare `raph status`/`pack`/`note`/`approve` on a fresh HOME does
  NOT auto-init the brain — run `raph init` first. (Phase 7's `--guard` is project-scoped and does
  NOT auto-init the brain; a small `raph init` auto-run-on-first-write guard is still open, Phase 7-ish.)
- Session 04 (2026-07-14) — owner directive: STOP asking each step; decide what's best for
  Raphael and just do it. Sequence set = Phase 7 -> Phase 10 -> confirm dev complete -> Academy #3.
  PHASE 7 COMPLETE: `raph init --guard` (+ `raph guard install|uninstall|scan`) = a deterministic
  pre-commit secret scanner for the OWNER's own repos (distinct from the brain's pre-push guard).
  src/lib/guard.js reuses the chokepoint's exact patterns (scrub.js now exports SECRET_RULES +
  isHighEntropyToken — one definition of "secret"); named rules block by default, entropy pass is
  opt-in (--entropy) so it won't false-fire on lockfiles; scans STAGED blob content; fails-open on
  binary/oversized/unreadable; refuses to clobber a foreign pre-commit hook (--force overrides);
  hook prefers global `raph`, falls back to a baked `node <bin>` path. 206/206 tests (+12). Live
  smoke: staged AWS key BLOCKED, env-var version committed clean. Closes the "used before init" gap
  (guard is git-repo-scoped, independent of ~/.raphael). Memory: [[full-autonomy-academy-mandate]].
- PHASE 10 TOOLING COMPLETE (session 04): `raph stats [--json]` (src/lib/stats.js pure
  aggregation + src/commands/stats.js) = the self-use report. Reads state/events.jsonl + the
  compiled index; surfaces TOKEN COST (per injection/session, cap hits), RETRIEVAL MISS (active
  lessons that never fire), and a FALSE-FIRE PROXY (prompt fires barely over the 4.0 threshold —
  labeled a proxy; a true "unhelpful" channel is unbuilt). Review funnel always shown. 213/213
  (+7). Dogfooded on the real brain (33 approved, 0 live injections yet, shown honestly) + sandbox
  smoke of the populated inject->events->stats path. The 2-4 week RUN itself is calendar, not code.
- DEVELOPMENT-COMPLETENESS AUDIT (session 04): the core engine is COMPLETE. Phases 1-9 done
  (Phase 7 closed this session with the guard); Phase 10 tooling done (raph stats), its 2-4 week
  RUN is calendar. `raph doctor` = healthy (only WARN = global `raph` not installed in the dev
  repo, expected). 213/213 tests. Full CLI surface verified (22 verbs incl. new guard + stats).
  Deliberately OUT of "development complete": (1) Phase 5 inject latency ~390ms cold — a tracked
  post-v1 optimization needing a warm-resident daemon, non-blocking (fires once/session); (2)
  Phase 11 distribution (npm publish, CI gates, contribute, launch) = launch prep, not the engine;
  (3) Phase 12 Academy AUTOMATION items (autopilot driver, model-policy table, etc.) = the ongoing
  self-training track, which I drive manually as the autopilot. Money-review Workflow still
  inconclusive (optional re-run). VERDICT: development part complete; proceed to Academy project #3.
- ACADEMY PROJECT #3 = "Assay" STARTED (session 04): a data-vetting CLI (schema + PII + quality +
  data contract) for any CSV/JSON/JSONL file. Chosen by Claude under the full-autonomy mandate
  (backlog's 3 ideas consumed; photo grouper parked as not head-lessly verifiable). Head-lessly
  verifiable (pure file-in -> report-out), dogfoods scrub.js (its PII detector will extend the
  exported SECRET_RULES/isHighEntropyToken), sellable (data governance/privacy/quality), distinct
  from money/repos. Spec: docs/academy/backlog.md (project #3 section). Workspace:
  Desktop/Projects/assay (own git). Memory: [[academy-project-3-assay]]. `raph academy status assay`.
  - M1 SHIPPED + PUBLISHED (commit in assay repo; 19 tests): zero-dep Node ESM CLI; src/lib/ingest.js
    normalizes CSV/TSV/JSON/JSONL into one column table (RFC-4180-ish CSV tokenizer w/ quotes,
    embedded commas/newlines, escaped quotes, CRLF; delimiter sniff , ; tab |; BOM strip;
    unquoted-empty=null vs quoted-""=empty; ragged-row warnings; JSON array/object + JSONL,
    key-union columns) + `assay profile`. Public: github.com/maheshaggarwal21/assay (topics added).
    Pre-publish gate: vetted with raphael's OWN new `raph guard scan --all` = clean (nice dogfood).
    academy status=in-progress 1/5, M2 next.
- Session 05 (2026-07-16): ASSAY v1 COMPLETE — resumed from the limit checkpoint and shipped
  M2 -> M5 inline, all pushed to github.com/maheshaggarwal21/assay; academy assay=done 5/5,
  59 tests. M2 schema inference (0e24def: most-specific-type classify -> resolve, integer
  collapses into number, MIXED drift flag, leading-zero numerics stay strings). M3 PII report
  (2ff9c3d: email/phone/SSN-SSA/card-Luhn/IPv4 searching inside free text; secret shapes
  ported 1:1 from scrub.js SECRET_RULES w/ sync test; column-name hints; masked samples,
  secrets never sampled; exit 1 on critical). M4 quality report (3cec9bd: completeness/
  validity-vs-dominant-type/uniqueness+candidate-keys/consistency scored + itemized; IQR
  outliers WATCH-only; --min gates). M5 data contract (522a8f3: emit locks types/required/
  unique + DECLARED PII w/ redaction plan + quality floor; check fails on drift, broken keys,
  quality regression, UNDECLARED critical PII even in new columns; ranges recorded not
  enforced; assay contract|check|report). GUARD DOGFOOD: `raph guard scan --all` blocked
  M4's commit on assay's own detector patterns + fixtures (20 findings, all hand-vetted
  benign — the Repo Keeper fixture class); bypassed consciously + lesson written. Learned:
  scan --all reads TRACKED files — use scan --staged after git add for new files. Brain
  writebacks: 4 approved lessons -> 37 active. Follow-up CLOSED same session: `.raphallow`
  guard allowlist (glob patterns at repo top; visible "allowlist active" announcement, never
  silent; explicit paths always scanned; brain chokepoint unaffected) — 216/216 tests,
  live-verified on assay (its 20-finding block now runs clean via a committed .raphallow).
- Session 06 (2026-07-16): owner delivered an EXPANDED VISION — Raphael as a self-running
  "company" (specialist agent employees, agent-maker + agent-manager, self-upgrading,
  self-record-keeping, reusable self-made skills) + a knowledge inlet (drop a repo/PDF/
  text/skill file -> Raphael adopts what's useful) + simple install for others. Brainstormed
  + reality-checked version: docs/company-vision.md (org chart role-by-role with honest
  limits; adopt pipeline design with license/injection/network analysis; build order
  A=adopt v1 local-only, B=skills factory, C=company ops, D=Phase 11 publish). TASKS.md
  Phase 13 (Scout/adopt) + Phase 14 (Company ops) added as PROPOSED. Boundary items for the
  owner: invariant #5 amendment for CLI network fetch (v2), npm publish timing.
- Session 06 round 2: owner APPROVED CLI fetch (invariant #5 amendment pending in
  ARCHITECTURE.md); clarified "copy code" = read/understand -> patch raphael itself;
  wants a management WEBSITE (two roles) + auto-approve option + reviewer-agent screen
  on adopted content. Brainstorm: docs/web-console-vision.md — resolution = LOCAL console
  (`raph web`, each user admins their own brain; zero-dep Node http, localhost+token,
  one-engine-three-faces: no verb, no button) + THIN static-first hosted hub (docs/pack
  registry/contribution face); auto-approve = dial (OFF/STANDARD/WIDE) with poisoning
  defenses; adopt v2 = six-layer gauntlet w/ reviewer agent; self-patches = branch +
  tests + eval + human merge. TASKS Phase 13 updated + Phase 15 added. PENDING owner
  decisions: security floor (keep human-always for security/self-patches — recommended)
  and hub scope (static vs accounts).
- Session 07 (2026-07-16): owner accepted both recommendations ("go with your
  recommendation... one by one maintaining proper history and planner"). ARCHITECTURE
  v1.1 (33feefe): §0.6 amended (bounded fetch) + invariant #5 above; §11.10-12 decided
  (fetch allowed / security floor KEPT — security lessons + self-patches always human,
  one click on the console / hub static-first); new §13 (adopt gauntlet) + §14 (console).
  PHASE 13 COMPLETE (5740df2..aba2557 + closeout): provenance ledger (append-only
  adoptions.jsonl, license detect w/ family gate — unknown/copyleft block code adoption),
  bounded fetcher (all §0.6 properties in one module, loopback-http carve-out for tests),
  adopt pipeline (six layers; malformed reviewer verdict = fail-closed block; skill
  drafts to staged/skills/ branded DRAFT, never installed; revoke = candidates deleted +
  active lessons RETIRED + ledger history), `raph adopt <src>|list|revoke` (--dry-run
  spends nothing; E-LIMIT exit 4; block exit 2). LIVE dogfood on gstack setup-gbrain:
  gauntlet verified layer-by-layer on the subscription (scrub caught 2, reviewer accurate,
  ephemera gate killed a port-number lesson live); found+fixed a real timeout bug (model
  calls now carry timeoutMs; adopt uses 240s; provider forwards w/ test). Real run: 8
  lessons + 1 good skill draft; curated (2 near-dupe rejects w/ reasons, 4 batch + 2
  security --confirmed approvals) -> BRAIN 43 ACTIVE. 244/244 tests. Trigram dedupe gap
  noted: differently-worded same-lesson pairs slip through — curator catches them.
- Console 15.1 + 15.2 SHIPPED (sessions 07-08): src/lib/web.js + `raph web` = localhost-
  only console, per-launch token, Host+Origin gate on EVERY request (hostile 403 even
  with the token), strict inline-only CSP. 15.2 (2026-07-17): approve/reject engine
  EXTRACTED to src/lib/review.js (approveRefs/rejectRefs hold ALL policy; commands are
  thin printers) so console buttons call the exact CLI engine (§14 law literal). Routes:
  /api/queue, /api/queue/item (=show), /api/stats, POST /api/approve|reject (64KB JSON
  cap, fail-closed). Page: dashboard (status+stats) + queue cards; batch approve/reject
  for normal candidates; security/quarantined = lock + full-body render + explicit
  "I read it" check unlocking a one-item Approve --confirmed. 257/257 tests; live
  browser smoke clicked the real flows end to end. Template-literal trap: the console
  page is ONE server-side template literal — no backticks inside it, even in comments.
  Doctor dashboard panel deferred (doctor's checks are inline in its command; extract
  to lib first or the web layer would duplicate logic).
- Console 15.3 SHIPPED (session 08, 258/258): lessons browser (browse-all + the EXACT
  rank() scorer with scores/reasons; /api/lessons[/item]), injection toggle (=on/off),
  `raph why` panel, adopt inbox (POST /api/adopt = same provider+gauntlet+dial pipeline;
  dry-run spends nothing; E-LIMIT->429; history + one-click revoke), activity feed.
  adoptConfig/estimateAdoptTokens extracted to lib/adopt.js (shared knobs). Defense in
  depth: adoption-ledger text re-passes scrubSecrets before display (verdicts derive
  from external material) — tested. Adopt fetch fires only on the user's click (#5b).
- Console 15.4 SHIPPED -> PHASE 15 COMPLETE (session 08, 259/259): setDial extracted to
  lib/autoapprove.js + scanTracked/hookStatus to lib/guard.js (commands now thin);
  Settings tab (dial radios + caps via POST /api/auto, consent registry via
  setProjectConsent) + Guard tab on the launch dir (hook install/uninstall, .raphallow
  announced, scan-all w/ optional entropy; explicit paths skip the allowlist like the
  CLI). Cross-face verified live: console click -> `raph auto` read back "standard".
  README has "The console (raph web)". Onboarding wizard deferred to Phase 11 (it's
  the install face). Console = 7 tabs, one engine.
- Session 09 (2026-07-17): PHASE 14 STARTED (company ops), dependency-ordered plan in
  TASKS.md (substrate -> driver stack -> meta layer). 14.1 portfolio registry SHIPPED
  (262/262): src/lib/portfolio.js (buildPortfolio pure over academy states + injected
  events; readPortfolio; renderPortfolio) + `raph portfolio [--json]`. tests/lessons
  are EXPLICIT records via `raph academy checkpoint --tests N --lessons N` (new flags,
  E-ACADEMY on junk) because lesson scope.projects is empty in the real brain — index
  attribution would lie 0. Backfilled repo-keeper 41/3, onedesk 64/4, assay 59/4;
  live table = 164 tests / 11 lessons / 0 recall tokens (honest). readEvents()
  consolidated into lib/events.js (stats/why/web now share it).
- 14.2 SHIPPED (265/265): `raph report weekly [--days N] [--json]` = src/lib/report.js
  computeWeekly (pure, `now` param): build activity (checkpoint notes in-window), brain
  changes funnel, recall cost, retrieval miss (ALL-TIME on purpose), adoptions, next/
  owner asks. Live: the real week rendered true (43 activated, gstack adoption, 1,650
  recall tokens, 39/43 never fired pre-RUN).
- 14.3 SHIPPED (266/266): console Company tab (8th tab) = GET /api/portfolio +
  /api/report[?days] calling readPortfolio/readWeekly verbatim; live-smoked on the
  real brain, zero console errors, no backticks added to the page template.
- 14.4 SHIPPED (270/270): src/lib/policy.js = 14 task kinds -> {model, effort,
  escalate, why}; opus is escalation-only (never first-pass, tested); roster
  alignment enforced (checkRosterAlignment — 'inherit' defers to policy);
  `raph policy [<kind>] [--escalated] [--json]`; provider buildCliArgs/callModelCLI
  forward --effort. distill stays model:null = CLI default.
- 14.5 SHIPPED (274/274): src/lib/driver.js = the autopilot. Pure state machine
  (driver state INSIDE academy state.json — all resume infra carries it; state
  written BEFORE every spawn) + makeStageRunner (real `claude -p`, tools ON,
  acceptEdits, workspace cwd, per-stage --session-id, API keys stripped) + drive()
  loop. E-LIMIT -> recordLimit + exit 4; rerun resumes the SAME stage via --resume.
  Fail -> one escalated retry (policy) else owner. Boundary IN CODE: no deploy kind
  exists (E-POLICY), completion -> recordBoundary + blocked. `raph academy drive
  <p> --brief|--brief-file [--pipeline] [--dry-run] [--max-stages]`. LIVE-verified:
  real plan stage wrote spec.md in a sandbox, 541 tokens, boundary recorded.
  Closes Phase 12: driver, scheduler, per-stage session resume, boundary-in-code.
- 14.5 SHIPPED (274/274): src/lib/driver.js = the autopilot. Pure state machine
  (driver state INSIDE academy state.json — all resume infra carries it; state
  written BEFORE every spawn) + makeStageRunner (real `claude -p`, tools ON,
  acceptEdits, workspace cwd, per-stage --session-id, API keys stripped) + drive()
  loop. E-LIMIT -> recordLimit + exit 4; rerun resumes the SAME stage via --resume.
  Fail -> one escalated retry (policy) else owner. Boundary IN CODE: no deploy kind
  exists (E-POLICY), completion -> recordBoundary + blocked. `raph academy drive
  <p> --brief|--brief-file [--pipeline] [--dry-run] [--max-stages]`. LIVE-verified:
  real plan stage wrote spec.md in a sandbox, 541 tokens, boundary recorded.
  Closes Phase 12: driver, scheduler, per-stage session resume, boundary-in-code.
- RESEARCH SWEEP DONE (session 09, owner ask): 13 repos + 25 screenshots + PDF
  analyzed end to end -> docs/atlas-upgrade-plan.md + TASKS Phase 16 (PROPOSED).
  Headline: graphify's zero-LLM deterministic knowledge graph (71.5x fewer tokens
  per query, audited) + the owner's awareness problem ("where do I look when it
  breaks") are solved by ONE engine: Phase 16 "Atlas" — deterministic project graph
  (16.1), `raph atlas where` error router (16.2), query-first inject/hook wiring
  (16.3), honest bench (16.4), Obsidian-compatible export (16.5), OKM freshness
  lint + lesson retirement (16.6), adopt runs over the sweep's skills incl.
  fable-method's twin check (16.7). NOT adopted (recorded w/ reasons): pxpipe image
  proxy, tree-sitter/embeddings, hosted memory, vibekit. URL fix: "fable-compiler/*"
  repos don't exist — real sources kpab/claude-fable-5-skills + Sahir619/fable-method.
- ATLAS 16.1+16.2 SHIPPED (session 09, owner go "continue, your recommendations";
  279/279 tests): src/lib/atlas.js = deterministic project knowledge graph, zero
  model tokens to build or query. Nodes files/symbols/packages/error-codes; edges
  imports/tests (EXTRACTED), calls (INFERRED 0.65-0.95 rubric, multi-exporter =
  AMBIGUOUS surfaced in report), raises/mentions (E-code origins incl. quoted
  no-throw lines), degree=importance, SHA256 cache w/ ATLAS_VERSION invalidation
  (live-found bug: extractor change + hash-keyed cache = stale reuse). `raph atlas
  [where|path|explain|digest]` (commands/atlas.js): where = the owner's error
  router (ranked files + reasons; test x0.4 / doc x0.6 query-time weights so
  fixtures never outrank real origins), path (pkg hubs never waypoints), digest =
  the 16.3 injection block. Artifacts: brain/atlas/<name>.{json,md}. Live:
  raphael = 146 files/459 nodes/1481 edges; "E-SCHEMA" -> src/lib/validate.js #1.
- GSTACK AUDIT DONE (session 10, owner ask "seriously audit garrytan/gstack"): cloned
  (1,179 files/~42.5k LOC). 4 parallel analysis agents ALL hit the session limit ->
  switched to inline reading (the CLAUDE.md lesson held). Read ETHOS, the full `learn`
  skill (gstack's brain), USING_GBRAIN_WITH_GSTACK.md, context/retro/review structure.
  Verdict: gstack is a ~60-skill dev-pipeline library, NOT a distilling brain; its memory
  = `learn` (raw learnings.jsonl, no chokepoint/scrub/review) + `gbrain` (embeddings +
  Postgres + MCP semantic search). Raphael is ahead on every governed-brain dimension;
  the curation-moat + deterministic-over-embeddings bet is validated (Atlas = our answer
  to gbrain). Changes NO architecture. Sharpened 16.3 (capability-check the nudge) + 16.6
  (retire heuristics: atlas-provable staleness + contradiction) + added 16.8 (computed
  confidence 0-10 + decision ledger + checkpoint --tried). Writeup: docs/atlas-upgrade-plan.md
  addendum. 279/279.
- ATLAS 16.3 SHIPPED (session 10, 286/286, live-verified): query-first wiring, one rule =
  capability-check (only ever point the agent at `raph atlas where` when an atlas is built).
  (a) SessionStart: atlas digest in its own <raphael-atlas> data-envelope + 250-tok budget
  (src/lib/inject.js atlasDigestBlock, ''-on-miss). (b) PreToolUse nudge: new `raph inject
  --event pre-tool` (runPreToolNudge) fires once/session for search tools (Grep/Glob + Bash
  grep/rg/find) when an atlas exists; plugin/hooks.json matcher Grep|Glob. (c) Driver:
  renderStagePrompt carries the workspace map (workspaceAtlasDigest, zero tokens) for
  CODE_BEARING_KINDS only. Live: raphael atlas (146 files) session-start block + Grep-once
  nudge + Read-silent all confirmed; smoke artifacts cleaned from the real brain.
- ATLAS 16.4 SHIPPED (session 10, 288/288, live-verified): `raph atlas bench` = honest
  tokens-to-answer, graph vs a conservative grep-and-read baseline (reads only the files
  the graph already surfaced, whole — ratio never inflated). benchAtlas/benchQuestions/
  renderBench in atlas.js (pure, tokensForFile DI'd); questions auto-derived (error codes
  then top symbols) or --questions; --json. LIVE on raphael: 10 error-code questions =
  174,324 grep+read vs 1,179 graph = 147.9x fewer (55x-385x/question), zero model tokens
  — the deterministic confirmation of graphify's 70-80x claim on our OWN code.
- ATLAS 16.4b SHIPPED (session 11, 291/291, live-verified): `raph atlas bench` now logs a
  durable `atlas-bench` event (project/questions/graph+raw tokens/saved/ratio) so the
  self-use reports can show the graph's measured leverage with zero re-scan. `raph stats`
  gained an "Atlas leverage" block (latest bench per project; a bench-only log renders now,
  no more "nothing recorded yet"); `raph report weekly` counts in-window bench runs + best
  ratio + latest project. Both pure over the events array. Sandbox smoke: stats
  "raphael : 148.3x fewer", weekly "1 bench run(s) — 148.3x fewer". +5 tests.
- Next: 16.5 Obsidian export / 16.6 freshness+retire heuristics / 16.7 adopt runs / 16.8
  (computed confidence + decision ledger + checkpoint --tried, from the gstack audit). Then
  Phase 14 meta layer or 13b. Parked: Phase 10 RUN (calendar), Phase 11 publish + hub (owner
  timing), doctor-to-lib extraction. Run builds INLINE (parallel Workflows hit the limit fast).
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
5. Raphael makes no network calls except (a) to reach a model — either the Anthropic
   Messages API directly (api provider) or by shelling out to the logged-in Claude Code
   CLI (subscription provider, the default; `claude -p` with `--tools ""` +
   `--strict-mcp-config` so the contained model still executes nothing) — and (b)
   user-initiated, read-only `raph adopt` fetches (AMENDED 2026-07-16 with the owner's
   explicit approval, ARCHITECTURE §0.6 + §13): https GET only, no credentials ever
   sent, ≤3 redirects, size/time capped, content treated as data — scanned, never
   executed; never a background behavior. No other network access. The brain repo
   blocks pushes by default (pre-push hook).
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
