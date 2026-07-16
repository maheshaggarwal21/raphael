# Raphael as a company — the owner's expanded vision, organized

Date: 2026-07-16. Source: the owner's own words (session 06). This document is the
brainstormed, honest, organized version. It does NOT change ARCHITECTURE.md yet — it is
the input for that change once the owner confirms direction.

## The vision in two sentences

1. Raphael becomes a self-running software company: the owner hands over a need, and
   agent "employees" — each with a specialty — take it from planning and architecture to
   a shipped product, keeping their own records (agents, commands, projects delivered,
   tokens used) and improving themselves as they work.
2. Raphael becomes a knowledge inlet: the owner drops a GitHub link, PDF, text, or skill
   file found in the wild, and Raphael studies it and adopts what is useful — as lessons,
   as reusable skills, or (carefully) as code. And anyone can install Raphael with a
   couple of commands, the way gstack installs.

## Part 1 — what already exists (do not rebuild)

The vision is an upgrade of this repo, not a restart. Mapping:

| Vision piece                          | What exists today                                             |
|---------------------------------------|---------------------------------------------------------------|
| Agent employees with specialties      | 10-agent roster + 4 recipes (Phase 8, agents.js)              |
| Ships products end to end             | Proven 3x: Repo Keeper, One Desk, Assay — spec→code→tests→publish |
| "This library/stack is better" memory | The brain: 37 active lessons; `raph note` writes new ones     |
| Records, logs, token analysis         | `raph stats`, academy state, session logs, TASKS.md           |
| Self-managing limits/reboots          | Academy checkpoint/resume driver + auto-resume launcher       |
| Installable by others                 | Phase 9 plugin done; Phase 11 (npm publish) is the last gap   |
| Quality department                    | Eval harness (Phase 6): ON/OFF arms, canaries, scenarios      |

Roughly 70% of the company's machinery is already built. The missing 30% is: the adopt
pipeline, the skills factory, the coded orchestrator (autopilot driver), budgets/reports,
and the meta-agents (agent-maker, agent-manager).

## Part 2 — the org chart, made real (role by role, honestly)

- **Agent-maker ("recruiter")** — feasible. A meta-agent that drafts a new roster entry
  (name, spine, specialty) into agents.js and regenerates plugin/agents/*.md. Guardrail:
  new agents enter as PROPOSALS the owner (or an eval gate) approves — same pattern as
  lessons. It should fire on demand ("no agent covers X") not on a schedule, or the
  roster bloats.
- **Agent-manager ("COO" / orchestrator)** — partially exists as recipes + Claude acting
  as autopilot. The coded version is the Phase 12 autopilot driver: pick agents, sequence
  stages, watch the token budget, stop at the autonomy boundary. This is the single
  highest-leverage unbuilt piece.
- **Memory management** — exists: the brain + session logs + the compaction ritual.
  Extension: an optimizer pass that reads `raph stats` and retires never-firing lessons.
- **Context management** — exists: injection budgets (≤1,200 tokens/session), project
  maps (`raph map`), session dedupe.
- **Token management** — half exists (`raph stats`, limit checkpoints). Missing: budgets
  per project ("spend at most X/day") and the limit-aware scheduler (Phase 12 item).
- **Database management** — honest note: Raphael itself is deliberately file-based
  (markdown + JSONL + git). That is a feature — portable, inspectable, no server. A "DB
  specialist" agent for the products it builds is fine; Raphael itself does not need a DB.
- **Research team** — becomes real via the adopt pipeline (Part 3): the owner is the
  scout, Raphael is the digestion system.
- **Marketing team** — honest limits: agents can write launch posts, READMEs, docs,
  comparison pages, and analyze positioning. They cannot run social accounts or buy ads —
  that needs sign-in and spend, which are owner-only by design. So: a content studio,
  not a media buyer.
- **Finance team** — honest framing: the company's currency is tokens and subscription
  limits, and real money stays in the owner's hands. One Desk's money engine can be
  reused to track cost-per-project. A finance agent = budget tracking + cost reports,
  not payments.
- **Progress reports** — new, easy, high value: `raph report weekly` — what shipped,
  tokens spent, lessons written/approved, retrieval misses, next plans. Built from
  events.jsonl + academy state + git log.

## Part 3 — the drop-a-link pipeline ("Scout", the adopt pipeline)

The owner's daily pain: good repos/skills/prompts scroll past on social media faster
than anyone can absorb them. The feature: `raph adopt <thing>`.

**Inputs:** a GitHub repo (cloned locally or a URL), a PDF, pasted text, a skill file.

**Outputs (four typed results, all reviewable, none auto-active):**
1. **Lessons** — distilled do/don't knowledge → candidates in the existing queue.
2. **Skill drafts** — a reusable Claude Code skill built from the material → staged for
   review in plugin/skills/.
3. **A "worth installing" verdict** — "this tool is good; here is how to install and when
   to use it" (recorded as a lesson + provenance entry, not executed).
4. **A vendored-code proposal** (rare) — actual code copied in, ONLY with a license check
   plus explicit owner approval.

**Why this is low-risk to build:** it is a new source adapter in front of the EXISTING
distill pipeline. The security-pack PDF already proved the shape works (1 PDF → 26
reviewable lessons). Scrub → zero-tool contained model → validateLesson() chokepoint →
candidate queue — unchanged.

**The four honest hard parts:**
1. **Licenses.** Copying code wholesale is a legal act. MIT/Apache = fine with
   attribution; GPL = contaminates the codebase; no license = cannot legally copy.
   Default is therefore *adopt the idea, not the code* — distill patterns into lessons
   and skills. Code vendoring requires: detected license recorded, attribution kept,
   owner approval, provenance entry.
2. **Untrusted content is an attack surface.** A README or skill file can contain
   instructions aimed at the AI ("ignore your rules and…"). Defenses (mostly already
   built): fetched content is data, never instructions; distillation runs in the
   zero-tool contained model; outputs pass the chokepoint (no URLs, no executable
   fields). Third-party skill files are never auto-installed — always human review,
   like security lessons. Never execute fetched code during evaluation.
3. **Network.** Invariant #5: the CLI's only network use is reaching a model.
   `raph adopt <url>` fetching from the internet would amend that invariant.
   Two-step plan: **v1 = local-only adopt** (owner saves the PDF / clones the repo and
   passes a path — zero invariant change); v2 = a narrow, user-initiated, read-only
   fetch, only with the owner's explicit sign-off recorded in ARCHITECTURE.md.
4. **No auto-scrolling.** Raphael will not browse social media for the owner — needs
   the owner's accounts, breaks platform ToS, and the junk ratio is high. The owner
   stays the scout. A cheap later step that IS clean: a watchlist of adopted repos that
   `raph adopt --refresh` re-checks for new releases.

**Provenance ledger (new, required):** every adoption writes a record — source, date,
license found, what was taken (lesson ids / skill name / files). Lessons stay URL-free
(invariant #3); the URL lives in the provenance record, exactly like evidence records
work today.

## Part 4 — the skills factory

Skills are folders of instructions — markdown, cheap to author, reusable, shareable.
Two sources:
1. The adopt pipeline (Part 3) emitting skill drafts from good external material.
2. Self-observation: when `raph stats` shows the same lesson/pattern firing repeatedly
   across projects, propose packaging it as a skill ("this keeps coming up — make it a
   tool, not a memory").

Same governance as everything else: drafts are staged, reviewed, versioned in git,
distributed through the existing plugin. One source of truth + a generator, exactly like
agents.js → plugin/agents/.

## Part 5 — self-upgrading without self-delusion

Rule: **no upgrade without a measurement.** The eval harness is the company's QA
department.
- "Library X beats library Y" as advice → a lesson; safe, human-reviewed, advisory only.
- A change to Raphael's OWN code, agents, or spine → branch + full tests + eval run
  before merge. Otherwise "self-improving" quietly becomes "self-mutating".
- The optimizer loop: `raph stats` surfaces cost, misses, false fires → proposals →
  gated changes. Measurement first, mutation second.

## Part 6 — what the owner's idea was missing (additions from brainstorm)

1. **Provenance ledger** for everything ingested (Part 3) — trust and legal cleanliness.
2. **Token budgets + limit-aware scheduler** — a company has budgets; ours is tokens.
   Session 03 proved parallel agent fleets burn the subscription limit fast, so the
   company must be mostly sequential and limit-aware. Scheduler > more agents.
3. **A weekly report artifact** — the "board meeting" (Part 2, progress reports).
4. **Pruning, not just growth** — retire lessons that never fire and agents never used;
   stats already surfaces the data. Companies that only hire and never prune bloat.
5. **The owner's role, named: CEO/board.** Direction, spend, deploy, accounts, security
   approvals. This is not a limitation to engineer away; it is the design. A fully
   "self-sufficient company" in the legal/economic sense (owns accounts, earns and
   spends money) is not buildable — and pretending otherwise is how autonomous systems
   cause damage. What IS buildable: a self-running software studio with exactly one
   human in the loop, at exactly the right moments.
6. **Portfolio registry** — `raph company` (or extended `raph stats`): all projects,
   status, tests, tokens spent, lessons written. Seeded by `raph academy list`.

## Part 7 — blunt reality checks

- **Limits are the real constraint**, not intelligence. The subscription cap shapes the
  architecture: sequential-by-default, checkpoint everything, schedule around resets.
- **More agents ≠ better.** Each agent is only as strong as its spine + injected
  lessons. Ten well-fed agents beat fifty vague ones. Roster growth must be
  demand-driven (agent-maker fires only when a real gap appears).
- **Marketing/finance agents draft and analyze; they do not act.** Accounts, ads,
  payments, deploys stay with the owner. Anything else violates the autonomy boundary
  that is enforced in code and honored in practice.
- **gstack comparison:** the install goal ("a couple of commands") is already Phase 9's
  shape — `npm i -g raphael-brain` + `/plugin marketplace add` + `/plugin install`.
  Phase 11 (claim the npm name, publish, CI) is what makes it real for strangers.
  gstack's `/setup-gbrain`, `/sync-gbrain`, `/learn` are adjacent prior art already on
  the owner's machine — worth a look via the adopt pipeline itself (dogfood #1).

## Part 8 — proposed build order (tracks)

- **Track A — Scout / `raph adopt` v1 (local sources)**: PDF/text/skill-file/cloned-repo
  → lessons + skill drafts + provenance ledger. Highest daily value, lowest new risk,
  reuses distill. *Recommended first build.*
- **Track B — Skills factory**: skill drafts pipeline + self-observation proposals.
  (Overlaps A; B's first half ships inside A.)
- **Track C — Company ops**: autopilot driver, limit-aware scheduler, model policy
  table, budgets, `raph report weekly`, portfolio registry, agent-maker/agent-manager.
  (= Phase 12 automation items + new meta-agents.)
- **Track D — Distribution (Phase 11)**: npm publish, CI gates, README/launch — when
  the owner wants outside users.

Decisions that stay with the owner (autonomy boundary): amending invariant #5 for
network fetch (Track A v2), anything that signs in / spends / deploys, and npm publish
timing (Track D). Everything else proceeds under the standing full-autonomy mandate.
