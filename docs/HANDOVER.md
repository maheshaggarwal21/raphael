# Handover — Raphael, as of 2026-07-20

You are picking up a live, shipped project from another AI model. This document is your
orientation: what the project is, exactly where it stands, what the owner expects of you,
and which questions are already settled so you don't waste his time re-asking them.

**Read these three files before doing anything substantive:**
1. `CLAUDE.md` — the project's standing instructions + a dated "Current state" log. It is
   the single most important file. Its rules override your defaults.
2. `.claude/TASKS.md` — the build checklist and source of truth for progress.
3. `docs/agent-architecture-final.md` — the decided agent design (the most recent major work).

Everything below is a summary *of* those files plus session context they don't carry.

---

## 1. What Raphael is

A **learning layer ("brain") for AI coding agents.** It watches the developer's real work,
distills durable lessons from it, and injects the relevant ones back into an agent's context
at the moment they matter — so the agent stops repeating the same mistakes.

- Ships as a **Node CLI (`raph`, 42 verbs)** + a **Claude Code plugin** (hooks, 12 agents,
  slash commands, recipes, a recall skill).
- **Public and published:** `github.com/maheshaggarwal21/raphael` (public),
  `raphael-brain` on npm. Local package version is **0.2.4**; publishing is owner-only, so
  the registry may lag the repo — check `npm view raphael-brain version` if it matters.
- **The moat is curation, not model cleverness.** Every lesson enters through one validated
  chokepoint; nothing bypasses it. That discipline is the product.
- Two brains: a **global** one (owner-curated, seeds every install: 40 lessons = 26 security
  + 14 design) and a **local** one (the user's own, learns from their work).

Zero dependencies beyond `js-yaml` and `ajv`. Node ≥18, ESM, Windows-first.

---

## 2. Current state (verified 2026-07-20)

| | |
|---|---|
| Tests | **441 passing, 0 failing** (`npm test`) |
| `raph doctor` | **healthy** |
| Working tree | **clean, everything pushed** to `main` (HEAD was `ce2f5de` before this handover commit) |
| Agent roster | **12 agents**, 7 recipes |
| Real brain | **61 active lessons**, mode = **autopilot**, **15 candidates pending review** |
| Development status | **Core engine complete.** The finalized agent architecture (A1–A8) is fully built. |

**Nothing is half-finished.** The last session ended at a clean, committed, documented
checkpoint by design (see §6, the working ritual).

---

## 3. What was built in this session (8 rounds)

This session was unusually long and mostly **research → decide → build**. Rounds 1–6 were
documentation and design; rounds 7–8 were code.

| Round | What happened |
|---|---|
| 1 | Verified all docs were current after the owner hand-edited README/ARCHITECTURE. |
| 2 | Deep research: 10 fast-growing GitHub repos + 3 pasted research reports → `docs/v2-vision.md` + Phase 18 (14 milestones, **proposed, not built**). |
| 3 | Finalized 18.2 (after reading hermes-agent's *actual source* — caught a real conflation error), decided 18.6 scope, dropped 18.8. |
| 4 | Cloned and read **all 54 gstack skills** → `docs/gstack-agents-audit.md`; wrote an agent-roster plan and an adversarial architecture audit (`docs/architecture-audit-v2.md`). |
| 5 | Studied `ui-ux-pro-max-skill` + Anthropic's design skills → `docs/frontend-design-skills-audit.md` + a flagship plan. Key finding: ui-ux-pro-max is **fully deterministic** (BM25 over CSVs, zero LLM calls) — the same architectural bet as Raphael's Atlas. |
| 6 | **Finalized the whole agent architecture** with every decision made → `docs/agent-architecture-final.md`. |
| 7 | **BUILT** the Red Team agent (authorized pentester) + **auto-invocation** for all agents. |
| 8 | **BUILT A1–A8** — the entire finalized architecture, milestone by milestone, committing green at each boundary. |

### What A1–A8 actually delivered (all live)
- **A1/A3** — Retired the two-tier `flagship` flag (a badge on everything is meaningless; on
  a subset it makes the rest look second-class). Replaced with `EVAL_COVERAGE`, an eval
  roadmap. Added a 6th spine rule (*one decision, one question*). Rewrote **every** agent
  mission to a named methodology: planner's mandatory NOT-in-scope, architect's Error &
  Rescue Map, debugger's Iron Law + 3-strike rule, reviewer's confidence-banding +
  quote-the-line-or-suppress, security's LLM/AI-security category, design's AI-slop tells.
- **A2** — Added **`raphael-frontend`**, a builder that can actually build UI (the confirmed
  gap: `design` could only review). Gave `debugger` edit tools. Roster 11 → 12, recipes → 7.
- **A4/A5** — New `design` lesson category + a **14-lesson curated design pack**
  (`src/lib/design-pack.js`), seeded into the global brain. `raph pack add design` works.
- **A6** — 3 checkable design-floor eval scenarios (tokens-not-hex, visible-focus,
  reduced-motion).
- **A7** — `raph guard scan --skills` (skill supply-chain: prompt-injection / credential
  access / network exfil) and `--design` (hardcoded-hex lint).
- **A8** — Cross-model "outside voice" for critique on security-audit + pre-deploy, in the
  **safe form only** (see §4).

---

## 4. Decisions that are CLOSED — do not re-open these

The owner has settled these. Re-proposing them wastes his time and reads as not having read
the history. Several are also in the decision ledger (`raph decide list`).

1. **Raphael's own code stays single-vendor.** I asked whether Raphael should be allowed to
   call a second AI vendor directly (which would have needed a new invariant #5e). Owner:
   **"leave it."** Invariant #5 is UNCHANGED, there is no #5e, and the cross-model outside
   voice exists only as agent/recipe *text* the host executes — no new Raphael network
   surface. **Closed 2026-07-20.**
2. **The two-tier flagship flag is retired for good.** Every agent is held to one bar. Don't
   reintroduce a per-agent quality badge.
3. **Design lessons ship at `curated` tier** — that *is* the taste-decay policy, because
   `confidence.js` already floors curated at 6 and makes it resist age-based auto-retire. No
   new decay code was needed.
4. **18.6 (multi-CLI reach) scope:** v1 ships AGENTS.md + exactly **one** real CLI wrapper,
   not four. Deliberately narrow.
5. **18.8 (markitdown extraction) is dropped** entirely.
6. **Out of scope permanently:** embeddings/vector DB (the deterministic-Atlas bet is
   validated and re-confirmed by three independent sources), unbounded agent-driven external
   fetch, pptx/docx/slide/logo generation, gstack's heavy telemetry preamble.

---

## 5. What's actually open (pick up from here)

Ordered by how ready each is.

1. **15 candidates are pending review on the real brain** — genuinely actionable *now*.
   Autopilot mined them from this session's own work (nice dogfooding signal). One is
   `security`-category and needs the heavyweight full-body review path. Run `raph queue`,
   then `raph show <n>`, then `raph approve`/`raph reject`. **Note:** several look like real
   Windows/Git-Bash environment lessons worth keeping.
2. **Phase 18 (v2 vision) — 13 milestones, designed but NOT built.** `docs/v2-vision.md` +
   `.claude/TASKS.md`. Priority order is already decided: **18.1** (cache-stable injection
   ordering — the correctness foundation), then **18.11** (an `unverifiable-claim` reviewer
   check, best evidence-to-effort), then **18.6** (reach). Awaiting owner go.
3. **A9 — per-agent outcome mining.** Deliberately a separate track. Needs its own design
   pass first; the known trap is that transcript evidence can't distinguish "ignored because
   wrong" from "ignored because busy" from "fixed differently." Don't build it naively.
4. **The 5-item punch list** in `docs/architecture-audit-v2.md` §4 — real gaps I found by
   auditing my own work, still unaddressed. The sharpest: `status: active` has **no
   provenance check** tying it to `approve.js`, so a structurally-valid hand-written lesson
   would pass compile-time revalidation. Framed as a decision to make, not a bug to panic
   about.
5. **Owner-gated switches:** `npm publish` for the next version; the Phase 10 self-use RUN
   (calendar, not code); launch promotion (posts are written and ready in
   `docs/owner/raphael-handbook.md`).

---

## 6. How the owner works — read this carefully

This matters more than any technical detail. Getting it wrong is the fastest way to annoy him.

### Communication
- **Simple language, short sentences.** He has said dense technical writing is hard to
  follow. Explain jargon the first time you use it. When he asks "tell me clearly and in
  simple words," he means it — drop the register, keep the substance.
- He asks direct questions and wants direct answers. No preamble, no flattery.

### Autonomy — bias hard toward acting
- **He does not want to be asked to "resume."** There's a standing full-autonomy mandate.
  Build milestone by milestone without checking in.
- **Don't over-defer.** Publishing product repos, approving authorized candidates, choosing
  the next project — that's your job, not his. He has corrected me on this explicitly.
- His words this session: *"stop asking each step; decide what's best and just do it"* and
  *"for decisions go with your recommendation that will be best and convenient for users."*
- **When he delegates a decision, actually decide it.** Don't hand back a list of options.
  Pick, state why, move.

### Where you MUST stop
Only these: **deploy, sign-in, spending money**, and **amending a "NEVER violate" security
invariant**. The last one is why I stopped on A8-deeper — and he confirmed that was the right
call by answering it. Everything else: proceed.

### Verify before you propose
He caught me once proposing something based on a README rather than the real source, and his
instruction since: *"read the code and understand the features... so that you can understand
it properly and apply it properly."* I now verify claims against actual code before writing
them down, and say plainly when something is unverified. **Do the same.** Fabricating a
plausible-sounding fact is the worst failure mode here.

### Tooling notes
- **Do not use the `AskUserQuestion` tool** — it errors in this environment. Ask inline in chat.
- Run builds **inline**, not via parallel agent fan-out. Heavy parallel workflows hit the
  session limit fast (learned the hard way, twice — including on the gstack repo specifically).

---

## 7. Hard rules you cannot break

### The 6 security invariants
They're in `CLAUDE.md` in full — read them there, don't rely on this summary. The essentials:
1. **`validateLesson()` is the ONLY way anything enters the brain.** Every write path calls
   it. No exceptions, ever, including imports.
2. Secrets are scrubbed before any model sees mined text, and again on output.
3. **No URLs in lessons. No executable fields.** Lessons are advisory *data* — nothing in a
   lesson may command an agent.
4. Security-category lessons never machine-activate in curator mode; quarantined content
   never machine-activates in **any** mode.
5. **Raphael makes no network calls except** a small, explicitly enumerated list (reaching a
   model, user-initiated adopt fetches, global-brain down-sync, the npm self-update check).
   **This list is closed** — see §4.1.
6. Everything mined stays local; nothing transmits without the user's own action.

### The testing standard (owner directive)
Every function gets **(a)** a success case, **(b)** at least one failure/error-handling case,
and **(c)** relevant edge cases (empty/null/boundary/first-run). A regression test for a bug
fix **must be shown failing without the fix and passing with it** — a test that always passes
proves nothing. Don't skim coverage for a function that "should work."

### The working ritual (mandatory at every task boundary)
1. `npm test` — must stay green.
2. Update docs: tick `.claude/TASKS.md`, append to `.claude/logs/YYYY-MM-DD-NN.md`, update
   `CLAUDE.md`'s "Current state" if the project's shape changed.
3. Commit **and push**.
4. Then it's safe to compact. Say plainly *"task complete, clean + pushed — safe to /compact."*

The point: never carry undocumented or uncommitted work across a context boundary.

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
- **Coded errors:** `E-<NAME>` (E-SCHEMA, E-URL, E-SECRET, …).
- `plugin/agents/*.md` and `plugin/agents/README.md` are **generated** — edit
  `src/lib/agents.js`, never the output.
- Research clones (gstack, hermes-agent, ui-ux-pro-max, anthropic-skills) live **outside** the
  repo at `Desktop/Projects/_research/` and are intentionally not committed.

### Layout
```
bin/raph.js       CLI entry
src/cli.js        command router
src/commands/     one file per verb
src/lib/          agents, validate (THE chokepoint), scrub, atlas, guard, curator, …
src/schemas/      lesson.schema.json (canonical)
src/eval/         canaries + scenarios + harness
test/             node:test suites
plugin/           the Claude Code plugin (agents/ + recipes/ are GENERATED)
global-brain/     the owner-curated seed brain
docs/             architecture, audits, plans, manual, owner handbook
```

---

## 9. Traps I hit this session — don't repeat them

- **`npm test | tail -3` hid a real failure** once (the `# fail` line got cut). Assert
  `# fail 0` explicitly.
- **Changing a schema enum isn't enough** — `scope.agents` had its *own* separate enum that
  silently rejected the new agent slugs. Grep for every enum touching a value you add.
- **The web console page is ONE server-side template literal** — no backticks anywhere inside
  it, not even in comments.
- **`raph guard scan --all` reads TRACKED files**, so brand-new files are invisible to it.
  Use `--staged` after `git add`.
- **Parallel agent fan-out on a large repo burns the session limit.** Read inline.
- The **Anthropic `engineering:*` / `design:*` skills are SDK-provided**, not files on disk —
  you cannot read them. Ground agent work in gstack's audited equivalents instead.

---

## 10. If you only remember five things

1. **`CLAUDE.md` is the contract.** Read it before acting; update it when the shape changes.
2. **The chokepoint (`validateLesson()`) is sacred.** It's the whole product.
3. **Act, don't ask** — except at deploy / sign-in / spend / security-invariant changes.
4. **Verify against real code before you claim anything.** Say so when you can't.
5. **Run the ritual at every boundary** (test → docs → commit+push), so the next handover is
   as clean as this one.

Good luck. The project is in a genuinely healthy state: green, pushed, documented, and with
its next steps already decided and prioritized.
