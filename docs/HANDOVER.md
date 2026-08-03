# Handover — Raphael, as of 2026-07-29 (session 18)

You are picking up a live, shipped, actively-dogfooded project from another AI model. This
document is a complete, standalone orientation — read it and you should be able to continue
without asking the owner to re-explain anything already established here.

**Read these files, in this order, before doing anything substantive:**
1. `CLAUDE.md` — the project's standing instructions + a long dated "Current state" log going
   back to project start. The single most important file; its rules override your defaults.
   It is very long — skim the dated entries near the bottom for the most recent sessions, but
   the invariants and working ritual near the top are load-bearing.
2. `.claude/TASKS.md` — the build checklist and source of truth for progress (phases 1–23).
3. `docs/graph-engineering-plan.md` — the design for Phase 23 (the graph layer), now SHIPPED.
   Read it fully before touching `src/lib/driver.js`, `graph*.js`, `stage-runner.js`,
   `recovery.js`, `policy.js`, or the agent roster.
4. `.claude/observation/` — the stress-test logs. `2026-07-26-run-01.md` (15 findings against
   the pre-graph driver, all fixed), `2026-07-28-run-05-agent-roster.md` (the manager path has
   no checkpoint — the reason Phase 23 exists), `2026-07-28-run-06-graph-live.md` (two real
   post-graph driver runs, one complete, one escalated live).

---

## 1. What Raphael is

A **learning layer ("brain") for AI coding agents.** It watches the developer's real work,
distills durable lessons from it, and injects the relevant ones back into an agent's context
at the moment they matter — so the agent stops repeating the same mistakes.

- Ships as a **Node CLI (`raph`)** + a **Claude Code plugin** (hooks, 12 agents, slash
  commands, recipes, a recall skill, a localhost web console).
- **Public and published:** `github.com/maheshaggarwal21/raphael` (public), `raphael-brain`
  on npm, **registry version 0.6.0** (the owner ran `npm publish` — repo and registry are in
  sync as of this session).
- **The moat is curation, not model cleverness.** Every lesson enters through one validated
  chokepoint (`validateLesson()` in `src/lib/validate.js`); nothing bypasses it, ever.
- Two brains: a **global** one (owner-curated, seeds every install) and a **local** one (the
  user's own, learns from their work).
- **Autopilot mode**: the brain runs in `curator` (human reviews everything) or `autopilot`
  (machine curator handles routine lessons; security stays human — invariant #4). The owner's
  real brain runs in `autopilot`.
- **`raph academy drive`**: a real, checkpointed, unattended build autopilot — the thing this
  whole session (and several before it) has been proving against real builds. As of this
  session it runs on an explicit, validated, bounded **graph** rather than a flat pipeline
  (Phase 23 — see §3).

Zero runtime dependencies beyond `js-yaml` and `ajv`. Node ≥18, ESM, **Windows-first** — this
matters constantly; see §8.

---

## 2. Current state (verified this session, not inherited)

| | |
|---|---|
| Tests | **812 passing, 0 failing** (`npm test`) |
| `raph doctor` | **healthy** (all 12 checks pass) |
| Working tree | clean, pushed to `main` — check `git log -1` for the current HEAD |
| Package version | **0.6.0**, matches the published npm registry |
| Agent roster | **12 agents** (manager, planner, architect, developer, frontend, reviewer,
  security, debugger, design, deployer, critique, redteam), 7 recipes |
| Real brain (`~/.raphael`) | **91 active lessons**, mode = **autopilot**, roughly 20
  candidates pending review at any time (the number moves — check `raph status`) |
| Development status | Phases 1–17 (core engine) and Phase 23 (the graph layer, 23.1–23.8 +
  23.10) are **shipped**. 23.9 (a full-build live run) is **partial by design** — it proved
  the loop mechanism live but never finished a full 11-node run, so `full-build` correctly
  keeps its EXPERIMENTAL flag. |

**Nothing is half-built in the committed repo.** Test projects Raphael's own agents built
along the way (`gatepost`, `microcache`, `notecard`, `tallyboard`) live as separate git repos
under `Desktop/Projects/`, outside this repo, and need no action unless the owner asks.

---

## 3. What the last two sessions actually were

### Session 17 — stress-testing the pre-graph autopilot, then designing the graph layer

The owner's directive: build real projects with Raphael's own tooling, observe everything,
verify every claim independently, fix what breaks, do none of the building yourself. This
produced:

- **15 findings (F1–F15)** against the coded driver (`raph academy drive`), all fixed —
  covering a planner that asked a question with nobody to answer it (F4), a stage that
  self-reported "135 tests passing" while the real suite was red (the reason `--verify
  "<cmd>"` exists — the driver runs the owner's own command and refuses to advance on a lie),
  timeout/failure confusion, a dead-end retry command, and Claude Code's own ungoverned
  project-memory tool competing with Raphael's governed brain (resolved as "absorb": steer
  agents to the sanctioned `raph decide` channel instead).
- **Run 05**: testing the *other* code path — the real Claude Code agent roster,
  manager-orchestrated, the way an actual user would type "use the manager to build X." It
  produced a real app (`notecard`) but proved this path has **no Raphael-managed checkpoint
  at all** — files survive, orchestration position does not.
- **The graph engineering design**: the owner supplied `Graph-Engineering.md` (a framework for
  making an agent loop's "what runs next" decision explicit and bounded, before the run
  starts, rather than implicit inside a model's head). The resulting design
  (`docs/graph-engineering-plan.md`) went through a 7-lens adversarial critique (91 findings)
  before being finalized — every critical/high finding was independently re-verified against
  real code, not taken on the critique's word.

### Session 18 — Phase 23 built end to end, then dogfooded live, then a real architecture audit

All ten milestones attempted; nine shipped, one partial by design:

- **23.1** `src/lib/graph.js` — the graph model, `validateGraph()` (16 rules: explicit
  entry, forward + co-reachability, Tarjan-SCC-bounded cycles, `when` exclusivity, required
  declarative `check`, a boundary deny-scan), `pipelineToGraph()`, `renderGraph()`. Pure —
  zero spawns, zero tokens.
- **23.2** POLICY gains a `frontend` kind (the driver could not run the Frontend agent at
  all before this) and an explicit per-kind `tools` grant sourced from the roster —
  `buildStageArgs` now emits `--tools <list>` and fails closed on a missing grant, live-verified
  twice against the real CLI. `redteam` deliberately still has **no** POLICY kind — adding one
  would make an offensive agent drivable unattended via the existing `--pipeline` flag.
- **23.3** `ensureGraph()` — migrates all 8 pre-graph on-disk state shapes (landed inside the
  23.4 commit; its own checkbox had been left unticked in TASKS.md until this session —
  fixed).
- **23.4 + 23.6** the engine swap: the driver reads every state through `ensureGraph`, the
  runner (`stage-runner.js`) is provably separated from routing (`recovery.js`), recovery is
  scoped per node-visit, `MAX_NODE_ATTEMPTS` closes the between-classes seam, three checks
  run on every resume (revalidate, hash match, state-vs-graph binding).
- **23.5** shipped graphs (`linear` default, `fix`, `full-build` experimental), `--graph`/
  `--graph-file`, `raph academy graph [--mermaid]`, exit code 3 = escalated.
- **23.7** **the brain is finally in the loop** — the driver had been computing the right
  lesson matches per stage and discarding them; they now render into every stage prompt.
- **23.8** `graph-run`/`graph-escalation` events feed `raph stats` and `raph report weekly`.
- **23.9** two real live runs (`.claude/observation/2026-07-28-run-06-graph-live.md`): a
  `fix` graph completed clean and was independently verified; a `full-build` run hit the
  subscription limit at 4/11 nodes but proved the loop mechanism fires for real (a `critique
  → architect` loop-back left two separate visit records with separate token accounting,
  which the old kind-keyed driver would have silently overwritten). `full-build` correctly
  **keeps** its experimental flag — the gate is a run that finishes, and this one didn't.
- **23.10** a spike, not a build: confirmed (by reading the installed Claude Code binary's own
  zod schemas, not by inference) that `SubagentStop` hooks carry `agent_id`/`agent_type`,
  refuting the design's original pessimism about the manager-orchestrated path being
  uncheckpointable. Recorded as a **new**, not-yet-built milestone — deliberately not folded
  into Phase 23.

**Then real live dogfooding on a new project, "Tallyboard"** (a scoreboard app), which
surfaced two more real things, both fixed the same session:

- The `architect ⇄ critique` loop hit its bound (`maxTraversals: 2`) and escalated —
  correctly, since critique kept finding real bugs on every round. Owner's call: raise the
  bound (architect↔critique to 5, every other shipped bound to a floor of 4, enforced by a
  test across all templates) **and** give `architect` a first-pass **opus** model — a
  deliberate, named exception to "opus is escalation-only, never first-pass," visible in code
  as `FIRST_PASS_OPUS_KINDS` and tested both ways so no other kind can quietly join it.
- **The artifact-ownership bug**: `architect` has Bash but no Write/Edit, so it created
  `ARCHITECTURE.md` via shell redirection on visit 1, then on visit 2 needed to *edit* it,
  couldn't, and gave up — leaving a stale v1 file on disk while the corrected version lived
  only in the response text. Fixed by making **the pipeline own the artifact**: an optional
  `artifact` node field, written by the driver itself (atomic, path-validated, fails open).
  A second, subtler version of the same bug was caught by `critique` itself doing its job on
  a later run (an artifact-write guard used the *visit* start instead of the *attempt* start,
  so a corrected second attempt within one visit could still be blocked by its own first
  attempt's file) — fixed the same session.
- **A real architecture audit** (owner: "reinspect the whole architecture, find the gaps, fix
  them, give me a working feature-tested system") found and fixed four more gaps, all with
  live evidence: environmental failures (a revoked OAuth token, a transient DNS blip) were
  being misclassified as `model` failures, which either wasted a human escalation on a
  network blip or (worse) burned an opus escalation trying to reason past DNS — now classified
  as `infra`, retried automatically; the run lock never checked whether its owner process was
  actually alive, so a killed drive could wedge a project for 45 minutes — fixed with a
  liveness check; `limit`/`paused` terminal states were never logged as graph-run events,
  undercounting the escalation-rate denominator — fixed.

**The Windows Startup-folder auto-resume launcher was removed this session**, at the owner's
request — it had been popping up a visible `claude` terminal window at every login, which the
owner didn't want. `resume.ps1` itself is still in the repo; nothing invokes it anymore.
TASKS.md has been corrected to say so (it previously described the launcher as active).

---

## 4. Decisions that are CLOSED — do not re-open these

1. **Never run the `Workflow` (multi-agent) tool unless the owner explicitly asks in that
   turn.** Stated flatly after a workflow burned session limit early in session 17. Still in
   force. Everything else defaults to acting without asking.
2. **Raphael's own code stays single-vendor** — no second AI vendor call from Raphael's own
   code (settled session 14; invariant #5 unchanged).
3. **`redteam` does not get a POLICY kind** — stays reachable only through human-in-the-loop
   paths (the manager, the `pentest` recipe).
4. **F9 resolved as "absorb"** — steer agents to `raph decide` via prompt, not host memory.
   Confirmed holding across every build since.
5. **Version bump discipline**: bump semver the moment work lands past a published release,
   not just at release time (this exists because an earlier bug, F8, let a stale version hide
   real fixes from the self-updater's string comparison).
6. **`full-build` stays EXPERIMENTAL** until a run of it actually completes end to end. Do not
   remove the flag on partial evidence — that would be exactly the self-reported-success
   failure mode Phase 23 was built to eliminate.
7. **Architect gets a first-pass opus model — a named, tested exception.** Every other kind
   stays "opus is escalation-only." Do not generalize this without the owner's say-so; the
   test suite enforces the exception list stays exactly `{'architect'}`.
8. **The Startup-folder auto-resume launcher is gone, on purpose.** Don't recreate it without
   being asked — the owner found the popup window intrusive.
9. **`AskUserQuestion` tool is banned in this environment** — it errors. Ask inline in chat.
10. **Out of scope permanently:** embeddings/vector DB, unbounded agent-driven external
    fetch, `pptx`/`docx`/slide/logo generation as a Raphael feature.

---

## 5. What's actually open (pick up from here)

1. **~20 candidates pending review on the real brain** — run `raph queue` / `raph show <n>` /
   `raph approve`/`raph reject`. Genuinely actionable right now.
2. **23.10's follow-on**: a `SubagentStop`-hook-driven cursor for the manager-orchestrated
   path is now known to be *buildable* (confirmed via the CLI's own schemas), but is not yet
   built. It's a real milestone, deliberately not folded into Phase 23.
3. **19.6 / A9 — per-agent outcome mining.** Deliberately deferred; needs its own design pass.
   The known trap: transcript evidence alone can't distinguish "ignored because wrong" from
   "ignored because busy" from "fixed differently."
4. **A full `full-build` live run, start to finish**, to actually clear its experimental flag
   — an 11-node build on a real brief is a multi-limit-window job; plan for that before
   scheduling one.
5. **Phase 18 (v2 vision)** — most of its 14 milestones were folded in and shipped across
   sessions 14–15 (cache-stable ordering, the `preference` category, AGENTS.md, testing/
   performance packs, etc. — check `.claude/TASKS.md` Phase 18 directly rather than assuming
   anything here, it has moved since any earlier summary).
6. **Owner-gated switches**: further `npm publish` runs (owner-only); the Phase 10 self-use
   RUN (calendar, not code).

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
  steps — that's your job. He has corrected me on this explicitly, more than once.
- **The one sharp exception**: multi-agent `Workflow` use is gated — never run it unless he
  explicitly asks in that turn (§4.1). Everything else about autonomy still applies fully.
- When he delegates a decision ("decide yourself"), actually decide it — state the choice and
  why, don't hand back a menu.
- When he gives direct feedback on a live result (e.g. "raise the loop bound and give
  architect a first-pass opus model"), that becomes a standing, tested rule immediately —
  not a one-off tweak. See §4.7 for the exact pattern this takes in code.

### Where you MUST stop
Deploy, sign-in, spending money, amending a "NEVER violate" security invariant. That's the
complete list. Everything else: proceed.

### Verify before you propose or report
He does not want self-reported success taken at face value — from Raphael's own stages, from
other agents, or from an adversarial critique's own findings. The verifier feature in
`driver.js` exists *because* a stage's own deliverable confidently claimed "135 tests passing"
while the real test run was red. When a 91-finding adversarial critique came back on the graph
design, every critical/high claim was independently re-checked against real code before being
acted on — one of the critique's own findings turned out to be wrong (it said the manager path
"cannot be checkpointed," which a five-minute check of the installed CLI's binary disproved).
**Trust nothing that reports its own success or failure; check.**

### Root-cause, not patch
When something breaks live (the Tallyboard artifact bug, the misleading "claude reported
success" error message), the fix traces to the actual mechanism — read the real transcript,
resume the exact killed session, quote the raw error envelope — rather than guessing from
symptoms. Both real bugs this session were root-caused this way before a line of code changed.

### Tooling notes
- `AskUserQuestion` is banned — errors in this environment.
- Prefer inline work over the `Workflow`/multi-agent tool by default.
- Run builds **inline**, not via parallel agent fan-out unless explicitly asked — heavy
  parallel workflows hit the session limit fast, confirmed multiple times.

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

### The testing standard (owner directive, strictly enforced)
Every function gets **(a)** a success case, **(b)** at least one failure case, **(c)** edge
cases. A regression test for a bug fix **must be shown failing without the fix, passing with
it** — a test that always passes proves nothing. This session's own harness pattern for Phase
23: a "gate" is proven by disabling it and asserting the covering test fails (RED-WITHOUT) —
used repeatedly, and it caught real vacuous tests more than once (a test whose escape-path
assertion wrote a stray file into the shared system temp root; a test that only checked one
of three shipped graph templates and so missed a real gap in the other two).

### The working ritual (mandatory at every task boundary)
1. `npm test` — must stay green. **Always assert the actual pass/fail line, never truncate
   output** — this hid a real CI failure once (lesson: `truncated-test-output-hides-failures`,
   now in the brain itself).
2. Update docs: tick `.claude/TASKS.md`, append to `.claude/logs/YYYY-MM-DD-NN.md`, update
   `CLAUDE.md`'s "Current state" if the project's shape changed.
3. Commit **and push**.
4. Bump the version if work has landed past the last published release.
5. Then it's safe to compact.

---

## 8. Practical mechanics

```bash
node bin/raph.js <cmd>        # the CLI during development
npm test                      # full suite (node:test, no framework)
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
  has bitten multiple sessions, including once nearly triggering a real `npm publish`. Write
  prose with Write/Edit tools; use a quoted heredoc for commit messages:
  ```bash
  git commit -F - << 'ENDOFMSG'
  message with `backticks` intact, never expanded
  ENDOFMSG
  ```
- **Coded errors:** `E-<NAME>` (E-SCHEMA, E-URL, E-SECRET, E-GRAPH, E-POLICY, …).
- `plugin/agents/*.md` and `plugin/agents/README.md` are **generated** — edit
  `src/lib/agents.js`, never the output.
- A killed subprocess never delivers a usage/token envelope — treat any token count from a
  timed-out or interrupted stage as untrustworthy (`tokensCaptured: false` / `complete: false`
  exist for exactly this, and token budgets are advisory, never a hard bound).

### Layout
```
bin/raph.js       CLI entry
src/cli.js        command router
src/commands/     one file per verb (academy.js is the autopilot CLI)
src/lib/
  agents.js        roster + SPINE (spine is DATA — renderSpine adapts to each agent's tools)
  driver.js        the autopilot loop: spawns stages, applies results
  graph.js         the planning layer — validateGraph(), pipelineToGraph(), pure
  graphstate.js    ensureGraph() — migrates every pre-graph on-disk state shape
  graph-templates.js  linear / fix / full-build
  graphrun.js      graph-run / graph-escalation event recording
  stage-runner.js  the execution layer — raw observations only, no routing
  recovery.js      RECOVERY table + classifyFailure() + MAX_NODE_ATTEMPTS
  policy.js        model/effort/tools per task kind, escalation table
  validate.js      THE chokepoint
  scrub.js, atlas.js, guard.js, curator.js, decisions.js, academy.js, …
src/schemas/      lesson.schema.json (canonical)
src/eval/         canaries + scenarios + harness
test/             node:test suites (driver.test.js and graph*.test.js are the largest)
plugin/           the Claude Code plugin (agents/ + recipes/ are GENERATED)
global-brain/     the owner-curated seed brain
docs/             architecture, audits, plans, manual, owner handbook, THIS FILE
.claude/
  TASKS.md        the checklist, phases 1-23
  observation/    stress-test logs + project briefs (the primary evidence trail)
  logs/           dated session logs
```

---

## 9. Traps hit across these sessions — don't repeat them

- **Self-reported success is not evidence** — from a stage, from another agent, from a
  critique. Always independently verify.
- **A test that passes even with the fix removed proves nothing.** Prove every regression
  test RED-WITHOUT the fix before trusting it GREEN-WITH it.
- **Truncating test output can hide the actual failure line.** Assert the explicit pass/fail
  count, never pipe through `tail`.
- **Backticks inside double-quoted shell strings execute as command substitution**, even in
  plain prose that only *mentions* a command name. See §8.
- **A killed subprocess never delivers a usage/token envelope** — any token/cost figure from
  an interrupted stage is a lower bound, not a fact.
- **An agent that can create a file via shell but can't edit it will silently give up on a
  second pass**, leaving stale content on disk while the corrected version exists only in its
  response. If the driver ever owns a file the agent also touches, use the *attempt* start
  time as the "did the agent already write this" cutoff, not the *visit* start — a visit can
  hold more than one attempt.
- **A well-formed response envelope does not mean success** — a revoked OAuth token and a
  transient DNS failure both arrive as valid envelopes with `is_error: true`; classify by the
  actual error content, not by "did it parse."
- **A lock needs a liveness check, not just a staleness timer** — a killed process leaves a
  lock file that looks fresh.
- **Parallel multi-agent fan-out burns session limit fast** — and per the standing
  instruction, don't reach for it unasked anyway.
- **A background agent stopped via `TaskStop` has no Raphael-managed resume** on the
  manager-orchestrated path — only files on disk persist, though a `SubagentStop`-hook-based
  cursor is now known to be buildable (§5.2) if that path ever needs it.

---

## 10. If you only remember six things

1. **`CLAUDE.md` is the contract.** Read it before acting; update it when the shape changes.
2. **The chokepoint (`validateLesson()`) is sacred.** It's the whole product.
3. **Never run the `Workflow` tool unless explicitly asked this turn** — the one hard
   exception to "act, don't ask."
4. **Act, don't ask** otherwise — except at deploy / sign-in / spend / security-invariant
   changes.
5. **Verify against real code before you claim anything — including other agents' claims,
   including your own prior claims.** Say so plainly when something is unverified.
6. **Run the ritual at every boundary** (test → docs → commit+push → version bump if past
   release), so the next handover is as clean as this one.

The project is healthy: 812 tests green, doctor clean, working tree clean and pushed. The
core engine has been complete for a while; the graph layer (Phase 23) shipped and has real
live dogfood evidence, including a genuine escalation and two real bugs found and fixed by
watching it run. The fastest concrete next step is the pending review queue; the most
interesting open one is 23.10's follow-on (a checkpointable manager path).
