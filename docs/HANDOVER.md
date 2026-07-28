# Handover — Raphael, as of 2026-07-28 (session 17)

You are picking up a live, shipped project from another AI model, mid-way through a
deliberate stress-testing phase. This document is a complete, standalone orientation:
read it and you should be able to continue without asking the owner to re-explain
anything already established here.

**Read these files, in this order, before doing anything substantive:**
1. `CLAUDE.md` — the project's standing instructions + a long dated "Current state" log
   going back to project start. It is the single most important file; its rules override
   your defaults. It is also very long — skim the dated entries near the bottom for the
   most recent sessions, but the invariants and working ritual near the top are load-bearing.
2. `.claude/TASKS.md` — the build checklist and source of truth for progress (1200+ lines,
   phases 1–23).
3. `docs/graph-engineering-plan.md` — the most recent major design, FINAL status, not yet
   built. Read this fully if you touch anything in `src/lib/driver.js`, `academy.js`, or
   the agent roster.
4. `.claude/observation/2026-07-26-run-01.md` and `.claude/observation/2026-07-28-run-05-agent-roster.md`
   — the stress-test logs this whole session was built around.

Everything below is a summary *of* those files plus context they don't carry (why decisions
were made, what the owner actually said, what traps I hit).

---

## 1. What Raphael is

A **learning layer ("brain") for AI coding agents.** It watches the developer's real work,
distills durable lessons from it, and injects the relevant ones back into an agent's context
at the moment they matter — so the agent stops repeating the same mistakes.

- Ships as a **Node CLI (`raph`, 44 verbs)** + a **Claude Code plugin** (hooks, 12 agents,
  slash commands, recipes, a recall skill, a localhost web console).
- **Public and published:** `github.com/maheshaggarwal21/raphael` (public),
  `raphael-brain` on npm. **Local package version is 0.5.4, UNRELEASED** — the registry is
  at 0.5.3 (owner published it). Publishing is owner-only; I bump the version the moment
  work lands past a release, not just at release time (this is itself a fix for a real bug,
  F8 — see §9).
- **The moat is curation, not model cleverness.** Every lesson enters through one validated
  chokepoint (`validateLesson()` in `src/lib/validate.js`); nothing bypasses it.
- Two brains: a **global** one (owner-curated, seeds every install) and a **local** one (the
  user's own, learns from their work).
- **Autopilot mode exists**: the brain can run in `curator` (human reviews everything) or
  `autopilot` (machine curator handles routine lessons; security stays human — see invariant
  #4 in CLAUDE.md). The owner's real brain runs in `autopilot`.

Zero runtime dependencies beyond `js-yaml` and `ajv`. Node ≥18, ESM, Windows-first — this
matters constantly; see §8.

---

## 2. Current state (verified 2026-07-28, this session, not inherited)

| | |
|---|---|
| Tests | **629 passing, 0 failing** (`npm test`) |
| `raph doctor` | **healthy** (all 12 checks pass) |
| Working tree | **clean, pushed to `main`** — HEAD is `a5afa58` |
| Package version | **0.5.4** (package.json / plugin.json / marketplace.json in lockstep) |
| Agent roster | **12 agents** (manager, planner, architect, developer, frontend, reviewer,
  security, debugger, design, deployer, critique, redteam), 7 recipes |
| Real brain (`~/.raphael`) | **88 active lessons**, mode = **autopilot**, **9 candidates
  pending review** |
| Development status | Core engine (Phases 1–17) is COMPLETE and has been for several
  sessions. This session's work was **stress-testing** the finished product against real
  builds, fixing what broke, then designing (not yet building) a significant architecture
  upgrade — Phase 23, "the graph layer." |

**Nothing is half-built in the committed repo.** One thing IS half-built *outside* the repo:
a test project called `notecard` at `C:/Users/Mahesh/Desktop/Projects/notecard`, produced by
an interrupted agent-roster run — see §5.1. It is not part of Raphael and needs no action
unless the owner asks you to resume it.

---

## 3. What this session actually was (read this to understand everything else)

The owner gave one long-running directive that shaped the whole session: **stress-test
Raphael by building real projects with it, observe every action, verify every claim
independently, fix what's broken, and do none of the building yourself.**

Concretely, this happened in two phases:

### 3.1 — Driving the academy autopilot (`raph academy drive`) against real builds

Two real, from-scratch projects were built entirely by Raphael's own coded autopilot (a
state machine in `src/lib/driver.js` that spawns headless `claude -p` subprocesses per
pipeline stage): **Gatepost** and **Microcache**. A third, **Notecard**, was attempted via a
different path (§3.2).

This surfaced 15 real findings, all logged in `.claude/observation/2026-07-26-run-01.md`
with full evidence, and **all fixed** (Phase 22 in TASKS.md, commits through `674c4b6`):

- **F4** — the planner asked a clarifying question with nobody to answer it; the driver
  accepted it as a finished spec. Fixed: `BOUNDARY_RULES` now states plainly there is no
  human in the loop, and every deliverable must carry a `## DECISIONS` section, parsed and
  gated deterministically (`gateDeliverable()`/`parseDecisions()` in `driver.js`).
- **F9** — Claude Code's own ungoverned project-memory tool competed with Raphael's governed
  brain. Owner decided **"absorb"**: `BOUNDARY_RULES` now explicitly steers agents to the
  sanctioned `raph decide` channel instead of the host's raw memory files. Confirmed holding
  across two independent from-scratch builds.
- **F10/F11/F12/F14** — timeout-vs-failure confusion, a misleading hardcoded failure message,
  `develop` never escalating to a stronger model, and a dead-end `retry` command. All fixed
  with real regression tests (red-without/green-with).
- **The verifier finding (biggest one)** — a `test` stage's own deliverable said "the counts
  are exact: 135 total tests" and satisfied the DECISIONS gate, while an INDEPENDENT
  `node --test` run showed a real failure. This is *the* reason `--verify "<cmd>"` exists now
  (`runVerify()` in driver.js): the driver runs the owner's own command after code-bearing
  stages and refuses to advance on a lie.
- **The sticky-false token bug** — a stage killed once (0 tokens recorded) then resumed and
  finished could end up reporting `tokens_captured: true` over an incomplete total. Fixed to
  be sticky-false.
- **F13** — a manual `raph update` never recorded that it had upgraded (only the automatic
  pulse path did). Fixed.

All of this is why the owner then handed me `Loop Engineering.md` (a skill doc on
plan/execute/recover/escalate loop discipline) partway through, asking me to apply it — most
of the fixes above are direct applications of that document's principles, discovered
independently through live observation before the doc was even supplied.

**Standing constraint from this phase, still in force:** *"remember dont run multi-agent
workflow from now on as we dont have enough limits."* **I have not used the `Workflow` tool
since, except once at the owner's own later explicit request (see §3.3) — and even that one
hit the session limit mid-run.** Default to inline work (Read/Bash/Grep/Edit), not fan-out.

### 3.2 — Testing the OTHER code path: the actual agent roster (run 05)

The owner then asked for something different: **not** the coded driver, but the real
Claude Code subagent roster, manager-orchestrated, the way an actual user would type "use
the manager to build X." Brief: `.claude/observation/notecard-brief.md`. Log:
`.claude/observation/2026-07-28-run-05-agent-roster.md`.

This is architecturally a *different, unrelated code path* — nothing in `driver.js` runs
here. I invoked `raphael-brain:raphael-manager` via the Agent tool in the background and
watched it drive the other 11 agents through its own Task tool.

It got through planner → architect → critique → frontend → a real
design↔frontend loop (confirmed genuinely iterative: two `raph decide` records exist, the
second an explicit correction of the first's focus-ring colors) → developer → a
reviewer↔debugger loop, and was about to start the security stage when the owner asked me
to pause it (usage-limit concern). I stopped it cleanly via `TaskStop`.

**What this run proved, the hard way:** this path has **no Raphael-managed checkpoint at
all**. Files on disk survive (a real, substantial Notecard app — see §5.1), but the
orchestration *position* — which loop iteration, what was mid-flight — has no durable record
anywhere. I told the owner this plainly when asked "will it resume from a checkpoint": no,
not the way `raph academy drive` does. This became the direct trigger for the next phase.

### 3.3 — The graph engineering design (Phase 23) — the most recent work, NOT YET BUILT

The owner supplied a long article (`Graph-Engineering.md`, still in the repo root, not
deleted on purpose — it's the design's primary source) on "graph engineering": the idea that
an agent loop's implicit "what runs next" decision should instead be an explicit, validated,
bounded graph — locked before the run starts, auditable after. The owner: *"this is the thing
our autopilot and our agents need... design it completely and take care of all edge cases,
follow the graph-engineering.md."*

I did four things, in order:
1. Read the source fully and mapped it honestly against Raphael's real code (not
   aspirationally — I verified every claim with grep/node one-liners before writing it down).
2. Wrote a first draft, `docs/graph-engineering-plan.md`.
3. **At the owner's explicit request**, ran a 7-agent adversarial `Workflow` critique against
   that draft — the one exception to the no-Workflow constraint this session, and it still
   hit the session limit on its final synthesis step (7 of 8 agents completed; the 8th,
   pure synthesis, failed on limit). I did NOT waste that: I read the raw per-agent journal
   output directly (`journal.jsonl` in the workflow's transcript dir) and manually harvested
   all 91 findings myself, since the synthesis agent's death didn't invalidate the 7 completed
   critiques.
4. **Independently re-verified every critical/high finding against the real code** (not
   trusting the critique agents at face value — several early findings in the session had
   already taught this lesson) before rewriting the design. One finding I disproved outright:
   the draft claimed the manager-orchestrated path "cannot be checkpointed because Raphael
   doesn't own that runtime" — I found `SubagentStart`/`SubagentStop` hook event strings
   inside the actual installed Claude Code binary, meaning that premise was simply wrong.

The result is `docs/graph-engineering-plan.md`, marked **FINAL**, and milestones 23.1–23.10
are in `.claude/TASKS.md`, all currently **`[ ]` — designed, not built**. Read that document
before touching `driver.js` or `academy.js`. Highlights worth knowing without re-reading the
whole thing:

- **The honest premise, corrected from the first draft:** the graph doesn't fix any observed
  bug — Phase 22 already fixed everything real, and both post-fix driver runs on disk
  finished clean. The one thing genuinely missing is that **the driver cannot express a
  loop at all** (stage records are keyed by kind; a repeated kind silently overwrites). That
  is what makes the owner's "frontend builds → design reviews → send back → repeat" request
  currently unbuildable through the governed path, and it's the actual justification.
- The build order puts the *earned* part first (23.1–23.4: graph model, validation, POLICY
  gaining a `frontend` kind, the driver running on the graph) and defers the general/
  speculative machinery (23.5–23.10) until that's live and proven.
- `redteam` (the pentest agent) is **deliberately never added to POLICY** — doing so would
  make it invocable, unattended, via the existing `--pipeline` flag, with Edit/Write tools
  the roster withheld on purpose. This is a considered decision, not an oversight — don't
  "fix" it later without re-reading why.
- §7 of the design ("the brain in the loop") found that `driver.js` computes exactly the
  right lesson matches (`lessonMatchesFor`) and then **discards them** — they only feed a log
  line. The autopilot's most expensive builds run with zero lessons actually injected. This
  is milestone 23.7, and it's arguably the most important one for the product's own thesis.

---

## 4. Decisions that are CLOSED — do not re-open these

1. **Never run the `Workflow` (multi-agent) tool unless the owner explicitly asks for it in
   that turn.** Stated flatly, twice, after a costly workflow burned session limit early in
   this session. This is the single most important standing behavioral constraint right now.
2. **Raphael's own code stays single-vendor** — no second AI vendor call from Raphael's own
   code (settled session 14; invariant #5 unchanged, no "#5e").
3. **The two-tier `flagship` agent flag is retired for good** — one bar for every agent.
4. **`redteam` does not get a POLICY kind** (Phase 23 decision, this session) — it stays
   reachable only through human-in-the-loop paths (the manager, the `pentest` recipe).
5. **F9 resolved as "absorb"**, not "govern" (lint the host's memory) or "complement" (leave
   the split as-is) — steer via prompt, confirmed holding across two builds.
6. **Version bump discipline:** bump semver the moment work lands past a published release,
   not just at release time. This exists because an earlier bug (F8) let an unbumped version
   hide real fixes from the self-updater's string comparison.
7. **Out of scope permanently:** embeddings/vector DB, unbounded agent-driven external fetch,
   `pptx`/`docx`/slide/logo generation as a Raphael feature, gstack's heavy telemetry
   preamble.
8. **`AskUserQuestion` tool is banned in this environment** — it errors. Ask inline in chat
   text instead.

---

## 5. What's actually open (pick up from here)

Ordered by how ready each is.

1. **9 candidates pending review on the real brain, right now.** `raph queue`, then
   `raph show <n>`, then `raph approve`/`raph reject`. Genuinely actionable immediately.
2. **Phase 23 (the graph layer) — designed, nothing built.** Start with 23.1
   (`src/lib/graph.js`: the graph model + `validateGraph()`, pure, zero spawns, fully
   testable alone) if the owner says go. Full milestone list and rationale in
   `docs/graph-engineering-plan.md` §11.
3. **Phase 18 (v2 vision, 13 milestones) — designed since session 14, still not built.**
   `docs/v2-vision.md`. Priority order already decided: 18.1 (cache-stable injection
   ordering) → 18.11 (unverifiable-claim reviewer check) → 18.6 (AGENTS.md reach). Awaiting
   owner go — this predates Phase 23 and may now be lower priority; ask if unclear rather
   than assuming.
4. **§5.1 below — the paused Notecard build.** Not Raphael code; a test artifact. Do nothing
   with it unless asked.
5. **A9 / 19.6 — per-agent outcome mining.** Deliberately deferred; needs its own design pass.
   The known trap: transcript evidence alone can't tell "ignored because wrong" from "ignored
   because busy" from "fixed differently."
6. **Owner-gated switches:** `npm publish` for 0.5.4 (owner-only, per the "do not npm publish
   yourself" pattern — I bump version and prep CHANGELOG, the owner runs the actual publish
   command); the Phase 10 self-use RUN (calendar, not code).

### 5.1 — The paused Notecard build (context, not a to-do)

`C:/Users/Mahesh/Desktop/Projects/notecard` — a real, substantial local notes app (markdown
body, tags, search, zero-dep Node HTTP API, safe-HTML rendering) built by the manager-
orchestrated roster before being stopped mid-pipeline (it had just reached the security
stage). Files exist: `SPEC.md`, `ARCHITECTURE.md`, 7 backend modules under `src/`, a 3-file
frontend under `public/`, 18 sample note JSON files. **No `test/` directory exists** — the
brief explicitly required `node:test` coverage of the markdown-to-safe-HTML path, and whether
that gap is a real defect or just "the run never got that far" is **unconfirmed** — I was
mid-investigation on this exact question when the previous context window ended. If the owner
wants this resumed, the honest options are: continue via `SendMessage` to the same stopped
agent (untested whether that actually restores full context after a real stop, as opposed to
a live background agent), or restart it once Phase 23's driver improvements make the governed
path capable of the same build (it currently can't run `frontend` — see §3.3).

---

## 6. How the owner works — read this carefully

This matters more than any technical detail. Getting it wrong is the fastest way to waste his
time or annoy him.

### Communication
- **Simple language, short sentences.** Explain jargon the first time you use it.
- Direct questions get direct answers. No preamble, no flattery.

### Autonomy — bias hard toward acting, with one sharp exception
- **Standing full-autonomy mandate**: build milestone by milestone without checking in;
  publish green work; pick the next project yourself when asked to.
- **Don't over-defer.** Publishing repos, approving authorized candidates, choosing next
  steps — that's your job. He has corrected me on this explicitly, more than once, across
  sessions.
- **The one sharp exception, from THIS session:** multi-agent `Workflow` use is now
  gated — never run it unless he explicitly asks in that turn. This slightly narrows the
  "just act" default; everything else about autonomy still applies fully.
- When he delegates a decision ("decide yourself"), actually decide it — state the choice and
  why, don't hand back a menu.

### Where you MUST stop
Deploy, sign-in, spending money, amending a "NEVER violate" security invariant. That's the
complete list. Everything else: proceed.

### Verify before you propose or report — this was tested hard this session
He does not want self-reported success taken at face value, from Raphael's own stages OR
from other agents (including critique/review agents). The verifier feature in `driver.js`
exists *because* a stage's own deliverable confidently claimed "135 tests passing" while the
real test run was red. When I harvested the 91-finding critique this session, I did not
report it — I independently re-verified every critical/high claim against real code with
grep and one-off Node scripts before writing a single line of the rewritten design. Do the
same: **trust nothing that reports its own success; check.**

### Tooling notes
- `AskUserQuestion` is banned — errors in this environment.
- Prefer inline work over the `Workflow`/multi-agent tool by default (§4.1). When you do use
  it (only if explicitly asked), don't waste a partial result if it hits the session limit —
  raw per-agent transcripts are still readable from the journal file even if a synthesis step
  fails.
- The model was switched mid-session (`claude-opus-5` → `claude-sonnet-5`) via `/model`, at
  the owner's own command — not something you need to manage, just don't be surprised if the
  effective model changes between turns.

---

## 7. Hard rules you cannot break

### The 6 security invariants (full text in `CLAUDE.md`)
1. `validateLesson()` is the ONLY way anything enters the brain. No exceptions, ever.
2. Secrets scrubbed before any model sees mined text, and again on output.
3. No URLs in lessons, no executable fields — lessons are advisory data only.
4. Security-category lessons never machine-activate in curator mode; quarantined content
   never machine-activates in ANY mode.
5. Raphael's network calls are a **closed, enumerated list** (reaching a model,
   user-initiated adopt fetches, global-brain down-sync, npm self-update check). Do not add
   to it without an explicit owner-approved invariant amendment.
6. Everything mined stays local; nothing transmits without the user's own action.

### The testing standard (owner directive, strictly enforced this session)
Every function gets **(a)** a success case, **(b)** at least one failure case, **(c)** edge
cases. A regression test for a bug fix **must be shown failing without the fix, passing with
it** — this was checked literally, multiple times this session, including on my own first
attempts at some of these tests (I twice wrote a "vacuous" test that passed even with the
fix removed — the deliverable-gate test and the verifier test both had this happen and had
to be redone end-to-end through the real runner, not just the pure function). Watch for this
failure mode in your own work.

### The working ritual (mandatory at every task boundary)
1. `npm test` — must stay green. **Always assert the actual pass/fail line, never `| tail -3`
   or similar truncation** — this hid a real CI failure once (lesson:
   `truncated-test-output-hides-failures`, now in the brain itself).
2. Update docs: tick `.claude/TASKS.md`, append to `.claude/logs/YYYY-MM-DD-NN.md`, update
   `CLAUDE.md`'s "Current state" if the project's shape changed.
3. Commit **and push**.
4. Bump the version if work has landed past the last published release (§4.6).
5. Then it's safe to compact.

---

## 8. Practical mechanics

```bash
node bin/raph.js <cmd>        # the CLI during development
npm test                      # full suite (node:test, no framework), 629 tests currently
node scripts/build-agents.mjs # REQUIRED after any agents.js change — commits generated output
node scripts/build-global-brain.mjs  # after editing a pack's specs
```

- **Sandbox any risky run:** `RAPHAEL_HOME=<scratch-dir> node bin/raph.js ...`
- **Windows-first, always.** No `flock`, no POSIX perms, quote every path, atomic writes via
  tmp+rename (`src/lib/files.js`). Git Bash `/tmp` maps to `C:\Program Files\Git\` when passed
  to Node — use real Windows paths.
- **Never put backticks inside a double-quoted shell string** — not `node -e "..."`, not
  `bash -c "..."`, not `git commit -m "..."`. Bash performs command substitution inside double
  quotes, so prose merely *mentioning* a backticked command name can actually run it. This
  bit twice in earlier sessions (once nearly triggering a real `npm publish`). Write prose
  with Write/Edit tools; use a quoted heredoc for commit messages:
  ```bash
  git commit -F - << 'ENDOFMSG'
  message with `backticks` intact, never expanded
  ENDOFMSG
  ```
- **Coded errors:** `E-<NAME>` (E-SCHEMA, E-URL, E-SECRET, E-GRAPH (new, Phase 23), …).
- `plugin/agents/*.md` and `plugin/agents/README.md` are **generated** — edit
  `src/lib/agents.js`, never the output.
- Research clones live outside the repo (not committed).

### Layout
```
bin/raph.js       CLI entry
src/cli.js        command router
src/commands/     one file per verb (academy.js is the autopilot CLI)
src/lib/          agents.js (roster+SPINE), driver.js (autopilot state machine),
                   validate.js (THE chokepoint), scrub.js, atlas.js, guard.js, curator.js,
                   policy.js (model/effort per task kind), decisions.js (the ledger), …
src/schemas/      lesson.schema.json (canonical)
src/eval/         canaries + scenarios + harness
test/             node:test suites (driver.test.js is the largest, ~600+ lines)
plugin/           the Claude Code plugin (agents/ + recipes/ are GENERATED)
global-brain/     the owner-curated seed brain
docs/             architecture, audits, plans, manual, owner handbook, THIS FILE
.claude/
  TASKS.md        the checklist, phases 1-23
  observation/    stress-test logs + project briefs (this session's primary artifact)
  logs/           dated session logs
```

---

## 9. Traps hit this session — don't repeat them

- **Self-reported success is not evidence.** A driver stage claimed "135 tests passing" and
  satisfied its own gate while the real suite was red. Always independently verify.
- **A test that passes even with the fix removed proves nothing.** Happened twice this
  session on my own first-draft tests; fixed by testing end-to-end through the real runner.
- **`npm test | tail -3` can hide the actual failure line.** Assert the explicit pass/fail
  count.
- **Backticks inside double-quoted shell strings execute as command substitution**, even in
  plain prose that only *mentions* a command name. See §8.
- **A killed subprocess never delivers a usage/token envelope** — treat any token count from
  a timed-out or interrupted stage as untrustworthy (`tokens_captured: false` exists for
  exactly this).
- **Parallel multi-agent fan-out burns session limit fast** — and per the standing
  instruction, don't reach for it unasked anyway.
- **A background agent stopped via `TaskStop` has no Raphael-managed resume** — only files
  on disk persist; orchestration position does not (proven live on the Notecard run).
- **An adversarial critique's raw per-agent output survives even if a later synthesis step
  hits the session limit** — read the journal file directly rather than treating a failed
  synthesis as a lost result.
- **Verify a critique's own claims too**, not just the original work — one lens flagged
  something as "unverifiable"; I checked it directly (grepped the installed Claude Code
  binary) and found the critique's own pessimistic conclusion was wrong.

---

## 10. If you only remember six things

1. **`CLAUDE.md` is the contract.** Read it before acting; update it when the shape changes.
2. **The chokepoint (`validateLesson()`) is sacred.** It's the whole product.
3. **Never run the `Workflow` tool unless explicitly asked this turn** — the one hard
   exception to "act, don't ask" carved out this session.
4. **Act, don't ask** otherwise — except at deploy / sign-in / spend / security-invariant
   changes.
5. **Verify against real code before you claim anything — including other agents' claims,
   including your own prior claims.** Say so plainly when something is unverified.
6. **Run the ritual at every boundary** (test → docs → commit+push → version bump if past
   release), so the next handover is as clean as this one.

The project is healthy: 629 tests green, doctor clean, working tree clean and pushed. The
engine has been complete for a while; this session's work was proving it under real load,
fixing what broke, and designing (not yet building) the next real upgrade — Phase 23. Start
there if the owner says go; otherwise the 9 pending candidates are the fastest concrete win.
