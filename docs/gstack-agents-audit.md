# gstack agent architecture — a deep read

Owner ask (2026-07-19): clone garrytan/gstack and understand how *each* of its
agents is built — architecture, system prompts, approach to tasks — not scoped to
what a prior session already looked at, for all of them. This is that read,
written up for future reference.

**Honesty note on depth.** gstack has 54 skills (`SKILL.md` files) and is genuinely
large — 1,179 files, and individual skill files run 800–1,850 lines each because
they embed a large shared framework verbatim in every file. Reading all 54 at full
depth would mean re-reading the same ~700-line shared preamble ~50 times over —
not deeper understanding, just repetition. The approach taken: **full, line-by-line
reads** of the skills that define genuinely distinct architecture or the closest
analogs to Raphael's own agents (listed in §2), plus a **structural catalog** (full
YAML frontmatter — name, description, triggers, tools, declared context needs) for
literally all 54, so every skill's purpose and shape is accounted for even where its
step-by-step instructions weren't read verbatim. §7 marks exactly which skills got
which treatment. Nothing was skipped; some were read for shape rather than prose.

The clone lives at (outside this repo, reference only, not committed):
`C:/Users/Mahesh/Desktop/Projects/_research/gstack` (shallow clone, `garrytan/gstack`).

---

## 1. What gstack actually is — correcting the framing

gstack is not an "agent roster" in the sense Raphael has one (named specialist
personas with system prompts, invoked by name or auto-routed). It's **54 slash-
command skills** for Claude Code (and, via thin adapters, Codex/other hosts) —
each a single `SKILL.md` file that is simultaneously: YAML frontmatter (trigger
phrases, allowed tools, a declarative context-fetch spec), a large **shared
operational framework** injected into every skill verbatim, and then the skill's
own differentiated instructions.

The closest thing gstack has to "agents" in Raphael's sense are the **specialist
panels** dispatched *from within* a handful of the review-family skills (§3) —
those are genuinely separate persona definitions with their own system prompts,
not slash commands a user invokes directly.

---

## 2. The shared framework — every skill carries this

This is injected (the file literally says "AUTO-GENERATED from SKILL.md.tmpl")
into every one of the 54 skills, so understanding it once explains ~70% of what
every skill file contains. Read in full from `review/SKILL.md`'s preamble
(1,853 lines) and cross-checked against `qa`, `ship`, `investigate`, `learn`,
`plan-eng-review`, `plan-ceo-review`.

- **Session/telemetry preamble**: session tracking, opt-in local + remote
  telemetry, feature-discovery prompts (asked once, ever, per feature), an
  "activated" first-run flag, upgrade-check plumbing.
- **AskUserQuestion protocol** — the single most elaborate piece of the whole
  framework. Every decision is a "brief": `D<N>` numbered, mandatory ELI10 in
  plain English, a `Recommendation: X because Y` line, per-option `Completeness:
  N/10` (or an explicit "options differ in kind, not coverage" note — fabricating
  a score is explicitly forbidden), minimum 2 pros/1 con per option at ≥40
  characters each, a closing `Net:` synthesis line. **One issue = one question,
  never batched** — this rule recurs in every review skill verbatim. A whole
  fallback ladder exists for hosts where the native tool is unreliable (an MCP
  variant, a "Conductor" host-specific prose fallback, a `spawned`/`headless`/
  `interactive` session-kind branch) so the discipline survives even when the
  tool itself doesn't work.
- **Cross-model "Outside Voice"** — after a plan review completes, an
  *independent* second opinion runs automatically (Codex CLI if available and
  authenticated, else a fresh Claude subagent as fallback) against a prompt that
  explicitly tells it not to repeat the first review, only to find what it
  missed. Findings are always presented as **tension points**, never
  auto-applied — "**User Sovereignty**" (§6) is stated as the reason, verbatim,
  in the skill file itself.
- **Learnings** (`gstack-learnings-log`) — every skill can append a JSONL
  learning at completion: `type` (pattern/pitfall/preference/architecture/tool/
  operational), `key`, `insight`, `confidence` (1–10, self-reported by the
  model, "be honest"), `source` (observed/user-stated/inferred/cross-model),
  and optionally `files` (enabling staleness detection — a learning is flagged
  if its referenced files later get deleted). Read in full in `learn/SKILL.md`
  (§4).
- **Review Readiness Dashboard + staleness-by-commit-drift** — every review
  skill logs a JSONL entry (status, findings, commit hash) to a shared log;
  a dashboard aggregates the latest entry per review type, and separately
  compares each entry's stored commit hash against current HEAD to warn "this
  review may be stale — N commits since review." A concrete, cheap way to know
  whether a review's verdict is still trustworthy.
- **Brain Calibration Write-Back (gated, largely unshipped)** — the most
  forward-looking piece found in this read. Skills can write a typed
  **prediction** ("bet": a claim, a weight, an `expected_resolution` date) to
  the "brain" (gbrain, §5) so a calibration profile builds over time — i.e.
  were this skill's recommendations actually right in hindsight? Gated behind
  a feature flag that's `false` today pending an upstream API, so this is
  aspirational, not live — but the *shape* of the idea (agents make falsifiable
  predictions, get scored later, feed a calibration profile) is real and
  documented as intended.
- **`gbrain` declarative context-fetch spec** — several skills declare a
  `gbrain: context_queries:` block right in their YAML frontmatter: named
  queries against either the filesystem (glob + sort + tail/limit) or a
  semantic store (type/tag/content filters), each with a `render_as` heading.
  Example (`investigate/SKILL.md`): pulls prior investigations in this repo,
  the tail of the project's `learnings.jsonl`, and recent cross-project
  "eureka" moments — three *different* memory sources, declared once, per skill,
  rather than one global dump every skill gets identically.
- **Voice / writing style guide, "Boil the Ocean" completeness principle,
  Confusion Protocol, checkpoint-commit mode** — style and workflow scaffolding,
  covered under philosophy in §6.

---

## 3. The specialist-panel architecture — the real "agents"

Four skills carry genuinely distinct multi-persona review architectures, each
read in full.

### 3.1 `/review` — diff-scoped pre-landing review (`review/SKILL.md`, 1,853 lines + 7 specialist files)

The main agent runs its **own** built-in "critical pass" checklist first (SQL
safety, race conditions, LLM-output trust boundary, shell injection, enum
completeness — a fixed, deterministic category list, not a sub-agent). Then it
conditionally dispatches a **panel of named specialists**, each a standalone
`.md` file in `review/specialists/`:

| Specialist | Scope condition | Notable rule |
|---|---|---|
| `testing.md` | always-on | missing negative-path/edge-case/security-enforcement test checks |
| `maintainability.md` | always-on | dead code, magic numbers, stale comments, DRY, module-boundary violations |
| `api-contract.md` | `SCOPE_API` | breaking changes, versioning drift, error-format consistency |
| `data-migration.md` | `SCOPE_MIGRATIONS` | reversibility, lock duration, backfill strategy |
| `performance.md` | backend or frontend scope | N+1, missing indexes, bundle size, blocking-in-async |
| `security.md` | auth scope, or backend+diff>100 lines | auth bypass, injection beyond SQL, crypto misuse, XSS escape hatches |
| `red-team.md` | diff>200 lines OR security found CRITICAL; **runs last** | explicitly adversarial, told to find what the *other specialists missed*, given their findings as input |

Two mechanisms make this more than a static checklist fan-out:
- **Adaptive gating**: `gstack-specialist-stats` reads historical hit rates per
  specialist and informs which ones actually get dispatched — a specialist that
  never finds real issues on this codebase gets deprioritized over time. Raphael
  has nothing analogous for its own *agents* (only for lessons, via
  `confidence.js`).
- **Pre-emit verification gate** (explicitly named `#1539` in the file, with a
  measured false-positive class it kills): every finding must **quote the exact
  motivating code line(s)** before it's allowed into the report. If it can't be
  quoted, confidence is force-capped to 4–5 and the finding is suppressed from
  the main report (kept in an appendix only). This is the review-time twin of
  Raphael's own proposed §7.3 `unverifiable-claim` reviewer check — same
  principle ("don't let an unverified claim reach the user"), applied at a
  different point in each system's pipeline.

Findings carry a confidence score (1–10) with a **display rule per band**
(9–10 shown normally, 5–6 shown with a caveat, 3–4 suppressed to appendix,
1–2 shown only if severity would be P0) — confidence isn't just a number, it
changes what the user even sees.

### 3.2 `/plan-eng-review` and `/plan-ceo-review` — architecture-stage review (each ~924 lines, read in full)

Not sub-agents this time — a single agent works through **numbered sections**
(eng review: 4 sections; CEO review: 11, including its own security/threat-model
section, data-flow tracing with an explicit nil/empty/error path diagram for
*every* new data flow, an interaction-edge-case matrix, and a mandatory
Error & Rescue Map: every method that can fail, every exception class, whether
it's rescued, what the user sees on failure — any row that's unrescued +
untested + silent is auto-flagged **CRITICAL GAP**). The discipline that
matters most: **one AskUserQuestion per issue, never batched**, and a hard
"**STOP**" after every section until the user responds — an issue with an
"obvious fix" still requires explicit approval before it lands in the plan.
A **"May 2026 transcript bug"** is named directly in the file as the failure
mode this exists to prevent: the model explored, found issues, and dumped them
into a deliverable instead of walking the user through them one at a time.

Also produces, every time: a **"NOT in scope"** section (deferred work + one-line
rationale each) and a **"What already exists"** section (does the plan reuse or
needlessly rebuild something that already solves part of the problem) — both
mandatory outputs, not optional. Ends by synthesizing findings into a flat,
build-actionable task list, written both as markdown checkboxes *and* a JSONL
artifact another skill (`/autoplan`) can aggregate across review phases.

### 3.3 `/cso` — security audit, 14 phases (`cso/sections/audit-phases.md`, read in full)

A scope-gated phase machine (phases 2–11 only run if the resolved audit mode
selected them) covering: secrets archaeology (git history + tracked `.env` +
CI configs — grep patterns for AKIA/`sk-`/`ghp_`/`xoxb-` etc.), dependency
supply chain (install-script detection in prod deps, lockfile integrity),
CI/CD pipeline security (unpinned actions, `pull_request_target` risk, script
injection via `${{ github.event.* }}`), infrastructure shadow surface
(Dockerfiles without `USER`, prod DB URLs in config, IaC wildcard IAM), webhook/
integration audit (signature verification presence, TLS-disabled detection),
**LLM & AI security as its own phase** (prompt-injection vectors, unsanitized
LLM output rendered as HTML, tool-calling validation, RAG poisoning, unbounded-
LLM-call cost attacks), **skill supply chain** (scans installed Claude Code
skills for exfiltration/credential-access/prompt-injection patterns — citing a
real stat, "36% of published skills have security flaws, 13.4% are outright
malicious," Snyk ToxicSkills research), full OWASP Top 10, STRIDE per
component, and a data classification pass (RESTRICTED/CONFIDENTIAL/INTERNAL/
PUBLIC). Every phase carries its own severity rubric **and an explicit
false-positive rule list** (e.g. "`pull_request_target` without PR-ref checkout
is safe — precedent #11").

### 3.4 What's genuinely transferable from §3

- Adaptive per-agent hit-rate gating (§3.1) — Raphael has nothing like this for
  its 10 agents.
- The pre-emit "quote the motivating line or get suppressed" gate — independent
  confirmation of the same principle behind Raphael's proposed §7.3 check,
  applied one layer earlier (review findings, not stored lessons).
- One-decision-per-question with mandatory pros/cons and a stated
  recommendation — Raphael's agents don't currently have any structured
  decision-presentation discipline at all; this is a real, adoptable gap.
- Mandatory "NOT in scope" / "what already exists" sections — independent
  confirmation of a principle Raphael already adopted (the fable-method sweep's
  `no-gold-plating` and `read-sources` lessons, session 12).
- Review staleness by commit-hash drift — cheap, concrete, and something
  Raphael's own agent outputs (if it ever logs review verdicts) could adopt.
- Cross-model "Outside Voice" with mandatory tension-presentation, never
  auto-apply — a genuinely new idea for Raphael (§4 of the agent-roster plan).

---

## 4. The memory system — `learn` + `gbrain`, and how it compares to Raphael

`learn/SKILL.md` (953 lines, read in full) is a thin CRUD/search layer over
`~/.gstack/projects/<slug>/learnings.jsonl` — an **append-only, unvalidated**
log. Confirmed directly from the code:

- No schema chokepoint, no secret-scrubbing, no security review before a
  learning is written — any skill can call `gstack-learnings-log` at any time
  with a self-reported confidence.
- `/learn prune` is the only correction mechanism, and it's manual/reactive:
  flags a learning as stale only if its referenced files were deleted, or as
  conflicting only if the same `key` has two different `insight` values later.
  There's no automatic retirement, no confidence decay from actual usage.
- The `type` taxonomy is `pattern | pitfall | preference | architecture | tool |
  operational` — **"preference" is one of gstack's own first-class learning
  types**, arrived at independently of Raphael's proposed §4.1
  `category: preference` addition (itself derived independently from reading
  hermes-agent's Honcho). Two unrelated systems converging on the same category
  is a real signal that it's a legitimate addition, not a stretch.
- `gbrain` (referenced constantly but not itself in this repo — a separate
  binary/service) is the actual cross-session semantic layer: embeddings,
  Postgres or PGLite, MCP-registered, with a whole separate setup skill
  (`setup-gbrain`) supporting four deployment paths including remote-MCP mode.
  This is the same finding the prior gstack audit (CLAUDE.md, session 10)
  already made about `gbrain` — reconfirmed here from the actual skill-level
  integration points (declarative `context_queries`, `.gbrain-source` worktree
  pins, brain cache TTL refresh), not just gbrain's own docs.

**Net comparison, unchanged from the prior audit's conclusion, now with more
evidence**: gstack's memory is broader in reach (semantic search, cross-project,
declarative per-skill context fetching) but has none of Raphael's governance
(chokepoint, scrubbing, structured review, confidence computed from evidence
rather than self-reported, automatic retirement). Raphael's moat is curation
discipline; gstack's is breadth and polish. Neither claim changes based on this
deeper read — it's now grounded in the actual `learn/SKILL.md` code rather than
inference.

---

## 5. Operational skills — deploy, debug, test (representative deep reads)

- **`/investigate`** (1,074 lines, differentiated content read in full) — a
  5-phase debugging methodology under one **Iron Law: "NO FIXES WITHOUT ROOT
  CAUSE INVESTIGATION FIRST."** Phase 1 gathers evidence and checks prior
  learnings/investigation history on the *same files* (recurring bugs in the
  same area are explicitly called "an architectural smell, not a coincidence").
  Phase 2 pattern-matches against a table of known bug signatures (race
  condition, nil propagation, state corruption, stale cache, etc.). Phase 3
  requires **confirming the hypothesis with real evidence before writing any
  fix**, with a hard **3-strike rule**: three failed hypotheses forces a STOP
  and an AskUserQuestion offering escalation rather than a fourth guess. Phase
  4 requires a regression test that **fails without the fix and passes with
  it** before the fix ships, plus a >5-files blast-radius check. Phase 5
  requires fresh reproduction of the *original* bug scenario to confirm the fix
  actually worked — "never say 'this should fix it' — verify and prove it."
  This is directly comparable to `raphael-debugger` and is the single most
  concretely useful read for this document's §Testing-standard cross-check.
- **`/qa`** (differentiated content partially read — setup, framework
  bootstrap, and first-real-tests generation) — "Test → Fix → Verify." Refuses
  to start on a dirty working tree (forces commit-or-stash first, so every bug
  fix lands as its own atomic commit). If no test framework exists, it
  *bootstraps* one: detects runtime, researches current best practice via
  WebSearch (with a built-in fallback table if WebSearch is unavailable),
  proposes a framework choice via AskUserQuestion, installs it, and writes 3–5
  **real** tests against existing code — explicitly banning smoke-only
  assertions like `expect(x).toBeDefined()` in favor of testing actual
  behavior, prioritized by risk (error handlers > business logic with
  conditionals > API endpoints > pure functions).
- **`/ship`** (frontmatter + structure only, not the differentiated body) —
  detects/merges the base branch, runs tests, reviews the diff, bumps VERSION,
  updates CHANGELOG, commits, pushes, opens the PR. Comparable in role to
  `raphael-deployer`, though `raphael-deployer` deliberately stops before any
  of this and produces a checklist only (§8's rejected-idea note applies: this
  is a real, deliberate divergence, not a gap — Raphael's boundary is
  deploy/spend/sign-in always being the owner's action, and `/ship`'s automatic
  push+PR creation is exactly the kind of action that boundary exists to keep
  out of an agent's hands).

## 6. Philosophy — `ETHOS.md` (read in full, 169 lines)

Three named principles, injected into every skill's preamble:

1. **"Boil the Ocean"** — AI makes completeness cheap, so build the complete
   thing (full test coverage, all edge cases, complete error paths) rather than
   a shortcut, "one lake at a time." States a genuine, honest tension worth
   naming against Raphael's own posture: gstack's philosophy is *"always prefer
   the complete option when the AI-assisted cost delta is small"*; Raphael's own
   adopted `no-gold-plating` lesson (fable-method sweep, session 12) cautions
   against building *speculative breadth* before something is proven. These
   aren't strictly contradictory — one is about depth-within-a-task
   (thoroughness), the other about breadth-across-untested-futures (premature
   generality) — but they pull in different directions and are worth holding
   in tension deliberately rather than treating one as simply "the" answer.
2. **"Search Before Building"** — a three-layer knowledge model (Layer 1:
   tried-and-true, don't reinvent; Layer 2: new/popular, search but scrutinize,
   "the crowd can be wrong about new things just as easily as old things";
   Layer 3: first-principles reasoning, "prize above all"). The "Eureka
   Moment" — understanding the conventional approach *and why it's wrong here*
   — is named as the most valuable outcome of searching, more valuable than
   finding something to copy.
3. **"User Sovereignty"** — "AI models recommend. Users decide. This is the one
   rule that overrides all others." Cross-model agreement is framed explicitly
   as *signal, not proof* — even when two models agree and the user disagrees,
   "the user is right, always." This is the stated justification for the
   Outside Voice mechanism's mandatory present-don't-apply discipline (§3), and
   it's functionally identical in spirit to Raphael's own repeated pattern
   (lessons as advisory data, curator's canary-gate-then-present, `selfpatch`'s
   present-never-merge rule) — independent convergence on the same principle
   from a different project, worth citing as validation.

---

## 7. Full skill catalog (all 54 — depth of read noted)

**FULL** = read line-by-line, including differentiated task content.
**FRONTMATTER** = full YAML frontmatter read (name, description, triggers,
tools, `gbrain` context spec if present); step-by-step body not read.
**PARTIAL** = frontmatter + a meaningful slice of the differentiated body.

| Skill | Read depth | Purpose (one line) |
|---|---|---|
| `gstack` (root) | FRONTMATTER | Router — picks which skill to invoke |
| `autoplan` | FRONTMATTER | Runs CEO+design+eng+DX reviews sequentially with auto-decisions |
| `benchmark-models` | FRONTMATTER | Cross-model (Claude/GPT/Gemini) benchmark for gstack skills |
| `benchmark` | FRONTMATTER | Performance regression detection via the browse daemon |
| `browse` | FRONTMATTER | Headless browser for QA/dogfooding |
| `canary` | FRONTMATTER | Post-deploy error-rate monitoring |
| `careful` | FRONTMATTER | PreToolUse hook: warns before destructive Bash commands |
| `codex` | FRONTMATTER | OpenAI Codex CLI wrapper (3 modes) — the "outside voice" engine |
| `context-restore` / `context-save` | FRONTMATTER | Save/resume working context across sessions |
| `cso` | **FULL** (audit-phases.md) | 14-phase security audit — see §3.3 |
| `design-consultation` | FRONTMATTER | Proposes a full design system (aesthetic/type/color/motion) |
| `design-html` | FRONTMATTER | Renders an approved design into production HTML/CSS |
| `design-review` | FRONTMATTER | Visual QA — spacing, hierarchy, "AI slop" pattern detection |
| `design-shotgun` | FRONTMATTER | Generates + compares multiple AI design variants |
| `devex-review` | FRONTMATTER | Live developer-experience audit (time-to-hello-world) |
| `diagram` | FRONTMATTER | English/mermaid → diagram triplet (source + editable + rendered) |
| `document-generate` / `document-release` | FRONTMATTER | Write missing docs / post-ship doc updates |
| `freeze` / `unfreeze` / `guard` / `careful` | FRONTMATTER | PreToolUse hooks: scope-lock edits, destructive-command warnings |
| `gstack-upgrade` | FRONTMATTER | Self-upgrade the gstack install |
| `health` | FRONTMATTER | Code-quality dashboard |
| `investigate` | **FULL** | 5-phase root-cause debugging — see §5 |
| `ios-clean` / `ios-design-review` / `ios-fix` / `ios-qa` / `ios-sync` | FRONTMATTER | iOS-specific debug-bridge instrumentation, QA, and fix family |
| `land-and-deploy` | FRONTMATTER | Merge + deploy workflow |
| `landing-report` | FRONTMATTER | Read-only PR/version queue dashboard |
| `learn` | **FULL** | Learnings CRUD/search/prune/export — see §4 |
| `make-pdf` | FRONTMATTER | Markdown → publication-quality PDF |
| `office-hours` | FRONTMATTER | YC-office-hours-style brainstorming/validation |
| `open-gstack-browser` / `pair-agent` | FRONTMATTER | Launch an AI-controlled Chromium; pair a remote agent with it |
| `plan-ceo-review` | **FULL** | 11-section strategy/scope plan review — see §3.2 |
| `plan-design-review` | FRONTMATTER | Interactive design-focused plan review |
| `plan-devex-review` | FRONTMATTER | Interactive DX-focused plan review |
| `plan-eng-review` | **FULL** | 4-section architecture/code/test/perf plan review — see §3.2 |
| `plan-tune` | FRONTMATTER | Self-tuning AskUserQuestion sensitivity + auto-decide preferences |
| `qa` | **PARTIAL** | Test→Fix→Verify against a live browser — see §5 |
| `qa-only` | FRONTMATTER | Same as `/qa` but report-only, no fixes |
| `retro` | FRONTMATTER | Weekly engineering retrospective from timeline+learnings |
| `review` | **FULL** (+ 7 specialists) | Diff-scoped pre-landing review — see §3.1 |
| `scrape` / `skillify` | FRONTMATTER | Pull data from a page; codify a successful scrape into a reusable skill |
| `setup-browser-cookies` | FRONTMATTER | Import real-browser cookies into the headless session |
| `setup-deploy` | FRONTMATTER | Configure deploy target for `/land-and-deploy` |
| `setup-gbrain` / `sync-gbrain` | FRONTMATTER | Install/init and keep current the gbrain semantic memory service |
| `ship` | **PARTIAL** | Fully automated ship workflow — see §5 |
| `spec` | FRONTMATTER | Vague intent → precise 5-phase executable spec/issue |

---

## 8. What NOT to import into Raphael, stated plainly

- **Telemetry-by-default plumbing, feature-discovery prompts, upgrade nags** —
  gstack's shared preamble is genuinely heavy (a ~150-line bash block runs on
  *every* skill invocation before any real work starts). Raphael's equivalent
  (`pulse`, `inject`) is deliberately lighter; this is confirmation to stay
  that way, not an invitation to add gstack's overhead.
- **Unvalidated, self-reported-confidence learnings** (§4) — already covered;
  Raphael's chokepoint discipline is the correct call, reconfirmed by seeing
  what the absence of it looks like in production code.
- **`/ship`'s automatic push + PR creation** — a deliberate divergence from
  Raphael's deploy/spend/sign-in-is-the-owner's-action boundary, not a gap.
- **Full "Boil the Ocean" as an unqualified default** — the tension with
  `no-gold-plating` (§6) means this should inform individual completeness
  decisions (e.g. "write the regression test, don't defer it") without being
  adopted as a blanket "always build the maximal version" stance, which would
  conflict with Raphael's own recently-decided §5.1 scope discipline (18.6's
  deliberately-narrow v1).
