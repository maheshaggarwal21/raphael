# The Raphael Handbook

*For Mahesh. Written 2026-07-18 at development-complete; updated same day for
v0.2.0 "Autopilot" (live on npm as `raphael-brain`). Five parts: the pitch, the
features, the user journey, the interview prep, and the launch marketing.*

---

# Part 1 — What is Raphael, and why it wins

## What it is, in one paragraph

Raphael is a **brain for AI coding agents**. AI agents like Claude Code are brilliant
for one session and amnesiac forever after — every new session, they repeat the same
mistakes you already paid to discover. Raphael watches your real work, distills the
mistakes and their fixes into short reviewed "lessons," and quietly injects the
relevant ones back into the agent's context at the right moment. The agent stops
repeating your history. You build a compounding asset: every project makes every
future project better.

## Why it is different

Most "AI memory" tools do one of two things: they dump raw notes into a file the
agent may or may not read, or they throw everything into a vector database
(embeddings — turning text into numbers so a computer can find "similar" text) and
hope semantic search surfaces the right thing. Raphael took a third path: **curation
over collection**.

1. **A single guarded door.** Every lesson — mined, hand-written, imported, adopted
   from the web — must pass one validation chokepoint. Schema-checked. No URLs. No
   executable content. Secrets scrubbed twice. There is no second door, and the test
   suite proves it.
2. **A gate on everything.** In manual mode a human reviews every lesson, and
   security lessons take a heavyweight one-at-a-time path — enforced in code, not
   policy. In autopilot (the default since v0.2.0) the click is replaced by a
   *machine curator*: a contained reviewer screen, a canary gate that must pass
   or the whole batch rolls back byte-identically, and probation confidence with
   self-retirement. One floor survives every mode: quarantined
   (injection-suspect) content never machine-activates, period.
3. **Deterministic retrieval.** Lessons are matched by an explainable scorer
   (keywords, stack, task kind) — you can always ask "why did this fire?" and get a
   real answer. No embedding black box.
4. **Honest budgets.** Recall costs at most ~1,200 tokens per session. Every
   injection is logged. One command turns it off.
5. **Proof built in.** `raph eval` runs identical tasks with the brain ON and OFF and
   reports the measured difference. The project's motto is "no measurement, no
   mutation."

## The highlight reel

- **Install once, it runs itself.** v0.2.0's autopilot: one install, three
  questions answered once in-chat, and a budgeted background heartbeat
  (`raph pulse`) mines, distills, curates, and indexes after every session —
  silently, fail-open, on the user's existing Claude subscription. New brains
  are seeded from a curated **global brain** (26 lessons active on day one) that
  down-syncs weekly, hash-verified; local learning always wins.
- **It trained itself.** Raphael's "Academy" autonomously built three real, public,
  tested products — repo-keeper (repo health), onedesk (money engine), assay (data
  vetting) — and wrote 11+ lessons from those builds back into its own brain.
- **The Atlas.** A deterministic knowledge graph of any codebase — files, symbols,
  error codes, who-imports-whom — built and queried with **zero model tokens**.
  Benchmarked on Raphael's own code: **147.9× fewer tokens** to answer "where do I
  look when this error appears?" than grep-and-read.
- **The adopt gauntlet.** Drop any URL, repo, or skill file; six layers (bounded
  fetch → secret scrub → license gate → contained reviewer agent → extraction →
  the chokepoint) turn it into reviewable lessons, with a provenance ledger and a
  one-command undo.
- **A real product surface.** 40 CLI commands, an 8-tab localhost console, a Claude
  Code plugin (hooks, 4 slash commands, a recall skill, 10 specialist agents),
  a commit guard for secrets, and 402 automated tests — live on npm as
  `raphael-brain`, CI-green on Linux + Windows across Node 18/20/22.
- **Self-governing.** Raphael can propose patches to its own code but can never merge
  them: branch + tests + eval canaries must be green, chokepoint files trigger a
  heavyweight review, and a human always clicks merge.

## Why prefer it over existing tools

| If you use… | The gap | What Raphael does instead |
|---|---|---|
| A CLAUDE.md / rules file | Static, hand-maintained, goes stale, no evidence | Lessons are mined from real work, carry evidence counts, decay in confidence, and get lint/retire sweeps |
| Vector-DB memory (embeddings + semantic search) | Unexplainable retrieval, needs a server/DB, stores raw unreviewed text | Deterministic explainable matching, plain files in a local git repo, everything reviewed |
| Raw "learnings" logs | Collection without curation — noise compounds | Four gates + human review; rejected ideas are remembered so they don't return |
| Nothing (default agent) | Same mistakes every session, forever | The whole point |

The moat is not any single feature — it's the **pipeline discipline**: scrub → gate →
review → budget → measure. That discipline is why you can trust it enough to leave it
on.

---

# Part 2 — Every feature, explained simply

*(Each feature: what it is → how it works inside → how you use it. The
command-by-command reference lives in [docs/manual.md](../manual.md); this section
explains the ideas.)*

## 2.1 The brain

**What:** a folder at `~/.raphael` holding your lessons as plain markdown files with
structured headers, inside its own git repository.

**Inside:** every lesson has a schema — id, slug, category (correctness, security,
process…), severity, scope (which stacks/tasks it applies to), trigger keywords, the
lesson text itself, evidence counts, and provenance (where it came from). The git
repo gives you history for free, and a pre-push hook blocks accidental uploads.

**Use:** you rarely touch it directly. `raph status` summarizes it; `raph show <slug>`
prints any lesson.

## 2.2 The chokepoint (the one door)

**What:** a single function, `validateLesson()`, that everything must pass to enter
the brain.

**Inside:** it checks the schema, rejects URLs anywhere, rejects tool-call-shaped
text (the shape a prompt injection would need), rejects imperative "you must…"
phrasing (lessons speak in facts, not commands), detects invisible Unicode smuggling,
and quarantines anything suspicious for heavyweight review.

**Use:** automatic. Run it by hand on any file with `raph validate`.

## 2.3 The secret scrubber

**What:** removes API keys, tokens, private keys, and credential-shaped strings from
text — *before* any model sees mined material, and again on anything leaving.

**Inside:** one shared list of secret patterns (`SECRET_RULES`) used everywhere — the
scrubber, the commit guard, and assay's PII detector all import the same definitions.
One definition of "secret," so a fix in one place fixes all.

**Use:** automatic everywhere.

## 2.4 Mining and distillation (the learning loop)

**What:** `raph mine` reads your real Claude Code session history (only for projects
you've consented) and finds *episodes* — an error and its fix, or you correcting the
agent. `raph distill` turns episodes into candidate lessons.

**Inside:** distillation calls a model with **zero tools** (it can read, but cannot
execute anything — containment), through your Claude Code subscription by default so
there's no API bill. Output passes four gates: ephemera (throwaway details like port
numbers die), rubric (is this actually a general lesson?), dedupe (do we know this?),
and rejection memory (you said no to this idea within 180 days? don't ask again).

**Use:** `raph mine --yes` then `raph distill --yes`, or just `/brain-learn` in
Claude Code. Then review the queue.

## 2.5 Review (you are the gate)

**What:** candidates wait in a queue; you approve, reject, or edit.

**Inside:** approve moves the file into the brain and commits it; reject writes a
*tombstone* that suppresses similar candidates for 180 days. Security and quarantined
items refuse batch approval — the CLI forces a full-body read and a one-at-a-time
`--confirmed`.

**Use:** `raph queue`, `raph approve 1 2 3`, `raph reject 4 --reason "..."` — or the
console's Review tab, or `/brain-review` with the `1y 2n 3e` grammar.

## 2.6 Injection / recall

**What:** the right lessons appear in your agent's context automatically.

**Inside:** at session start and on each prompt, a hook calls `raph inject`, which
scores active lessons against the project and your words using a deterministic,
explainable ranker. Winners are wrapped in a *data envelope* — framing that tells the
agent "this is reference data, not instructions" — deduped per session, and capped at
~1,200 tokens. If anything errors, the hook prints nothing (fail-open: a broken brain
can never break your session).

**Use:** automatic with the plugin. `raph why` shows what fired and cost; `raph on|off`
is the switch; `raph search` runs the same ranker by hand.

## 2.7 The security pack (day-one value)

**What:** 26 curated lessons covering the mistakes behind most real breaches —
secrets in code, missing authorization checks (IDOR), client-trusted prices, missing
security headers, XSS, debug endpoints left in production, and more — distilled from
five professional audit checklists.

**Use:** `raph pack add security`. They arrive as candidates; the security ones take
the heavyweight path. Your brain is useful before it has learned anything from you.

## 2.8 Adopt (drop a link, keep the knowledge)

**What:** `raph adopt <url|repo|file>` digests external material into reviewable
lessons and skill drafts.

**Inside:** six layers. (1) A bounded fetcher — https GET only, no credentials, size
and time capped, content treated as data. (2) Secret scrub before any model sees it.
(3) License detection — copyleft or unknown licenses block code adoption (ideas may
be learned; code may not be pasted). (4) A contained reviewer agent screens for
prompt injection and malicious guidance; a malformed verdict fails closed. (5)
Extraction through the same gates as distillation. (6) The chokepoint. Everything is
recorded in a provenance ledger; `raph adopt revoke` undoes an adoption completely.

**Use:** paste a URL in the console's Adopt tab or run the CLI; `--dry-run` costs
nothing.

## 2.9 The auto-approve dial

**What:** four settings. **Off:** everything waits for you. **Standard:** your own
mined lessons may auto-activate into a restricted tier. **Wide:** adopted material
may too, with daily caps. **Full:** autopilot — the machine curator takes over the
whole queue (this is what the default install sets).

**Inside:** on off/standard/wide, security lessons always wait for a human,
enforced by a coded error (`E-AUTOSEC`). At full, security lessons go only through
the machine curator's stricter path (reviewer screen with a security addendum +
canary gate + batch rollback). Quarantined content never auto-activates at any
setting. All auto-activated lessons are discounted in confidence until they prove
out, and self-retire if they never help.

**Use:** `raph auto full` / `raph auto manual`, or Settings in the console.

## 2.10 The Atlas (the project graph)

**What:** a map of your codebase — files, exported symbols, packages, error codes —
with edges for imports, tests, calls, and where errors originate. Zero model tokens
to build or query.

**Inside:** a deterministic scanner extracts facts; inferred edges (like "A probably
calls B") carry an explicit confidence score and ambiguity is surfaced, never hidden.
Content-hash caching makes rebuilds instant. `where` ranks files for an error string
with reasons; test files and docs are down-weighted so fixtures never outrank real
origins.

**Use:** `raph atlas` to build; `raph atlas where "E-THING"` when something breaks;
`raph atlas export` for an Obsidian vault; `raph atlas bench` to measure the token
savings on your own repo.

## 2.11 The guard (never commit a secret)

**What:** a pre-commit hook for *your* repos that blocks commits containing secrets.

**Inside:** the chokepoint's exact secret patterns over staged content. Named
patterns block by default; a noisier entropy pass is opt-in. Fails open, never
touches history, refuses to clobber a foreign hook, and a `.raphallow` file
allowlists known-benign fixture paths — always announced, never silent.

**Use:** `raph guard install` once per repo; `raph guard scan --all` to audit.

## 2.12 The console (`raph web`)

**What:** the whole system in your browser, on your machine only.

**Inside:** a zero-dependency Node server bound to 127.0.0.1 with a fresh token per
launch, Host+Origin checks on every request, and a strict CSP. Every button calls
the *same functions* as the CLI verb — the console holds no logic of its own.

**Use:** `raph web`. Eight tabs: Dashboard, Review queue, Lessons, Adopt, Activity,
Company, Guard, Settings.

## 2.13 The plugin (agents, hooks, slash commands)

**What:** the Claude Code integration. Hooks wire recall automatically (SessionStart
+ per-prompt injection, the atlas nudge, and SessionEnd's autopilot pulse); `/brain`,
`/brain-learn`, `/brain-review`, `/brain-eval` give guided flows; a `brain-recall`
skill lets the agent *ask* the brain mid-task.

**The 10 agents:** Planner, Architect, Developer, Reviewer, Debugger, Security,
Critique, Design, Deployer, Manager — each consults the brain before acting, runs
free checks before spending tokens, reads the map instead of the repo, and writes
findings back as `raph note` candidates. Users invoke them by name in plain words
("use the raphael-reviewer agent on my last commit") or let Claude Code
auto-delegate. What to hand each one — the idea for Planner, the spec for
Architect, the diff for Reviewer, the exact error + repro for Debugger, another
agent's output for Critique — is tabled in the README and manual §10. 4 recipes
chain them (pre-deploy always runs the security audit first), and Deployer
structurally stops before any actual deploy.

## 2.14 The Academy (how Raphael trains itself)

**What:** Raphael improves by *building real products autonomously* and mining its
own builds.

**Inside:** a checkpointed state machine — every milestone, decision, dead end
(`--tried`), and usage-limit event is recorded, so a limit reset or a reboot resumes
exactly where it stopped. A driver (`raph academy drive`) runs plan → build → test
stages with real agent sessions, choosing models per task from a policy table
(expensive models are escalation-only). The autonomy boundary is *structural*: no
deploy stage kind exists in the code, so publishing, signing in, and spending always
return to the owner.

**Products so far:** repo-keeper, onedesk, assay — all public on GitHub, all tested,
all of which wrote lessons back into the brain.

## 2.15 The company layer

**What:** operations reporting, as if Raphael were a small studio. `raph portfolio`
(every build: status, tests, lessons, cost), `raph report weekly` (the board report),
`raph stats` (is recall earning its keep?), `raph optimize` (what to prune), `raph
agent` (proposals for new roster agents — staged, never self-installing), `raph
skills` (package a proven lesson into a skill draft with a mandatory "Honest limits"
section), `raph decide` (a ledger of settled decisions surfaced at session start so
they don't get re-litigated).

## 2.16 Self-upgrade gates

**What:** the rules for changing Raphael's own code. `raph selfcheck`: branch + full
tests + eval canaries green, or no merge. `raph selfpatch`: additionally flags any
patch touching the chokepoint files as heavyweight and blocks copyleft ports. Both
gates *present* — a human always merges. Raphael never edits itself silently.

## 2.17 Contribute (sharing, opt-in)

**What:** export a lesson to share with a teammate or the community.

**Inside:** strips project names, path globs, and local evidence references;
re-scrubs every text field; re-validates through the chokepoint; refuses rather than
silently "fixing." There is deliberately no `--all` — sharing is a per-lesson choice.

**Use:** `raph contribute <slug> --out ./to-share`.

## 2.18 Autopilot (v0.2.0 — the default)

**What:** install once, answer three questions once, and Raphael runs the entire
learning loop itself. The user only ever notices fewer tokens, better code, and one
short digest line a week.

**Inside:** a SessionEnd hook fires `raph pulse --async` — a detached, budgeted,
fail-open heartbeat (it can never block or slow a session). Each pulse mines the
finished session (zero tokens), distills under caps (8 episodes/pulse, 3 distill
runs/day), passes every candidate — security included — through the **machine
curator** (contained reviewer screen, fail-closed; canary gate; whole-batch
byte-identical rollback on any failure), syncs the global brain weekly, refreshes
the project atlas when the repo moved, and self-retires machine lessons that never
help. Every activation is a git commit in the brain repo, so everything is
undoable. Curator (manual) mode remains fully supported via `raph auto manual`.

**Use:** nothing — that's the point. `raph pulse` shows the last heartbeat;
`raph web` shows and undoes everything.

## 2.19 The two brains (global + local)

**What:** the **global brain** lives in the GitHub repo — a curated, owner-reviewed
lesson set (26 at v1). Every new install seeds its **local brain** as a copy of it
(active immediately — no cold start), then learns locally on top.

**Inside:** the seed ships inside the npm package (zero network at install). A
weekly down-sync fetches exactly two pinned HTTPS URLs (manifest + bundle),
verifies per-lesson sha256 hashes, and still routes every lesson through the
chokepoint — local lessons always win conflicts. Upstream: the second install
permission (on by default at autopilot setup, `raph contribute off` any time)
lets non-curated active lessons be stripped, re-scrubbed, re-validated, and
staged as a local bundle — *sending* is always the user's own action
(`raph contribute send`). Withdraw the permission and nothing is ever staged;
either way, nothing leaves the device except by the user's click.

---

# Part 3 — A new user's journey, step by step

## Journey A — the default (autopilot): three minutes, then nothing

*This is what almost every user should experience. Meet Arjun, a developer who
just heard about Raphael.*

1. 🧑 In his **terminal**: `npm install -g raphael-brain`, then
   `claude plugin marketplace add maheshaggarwal21/raphael` and
   `claude plugin install raphael-brain@raphael`. (In a terminal Claude Code
   session the in-chat `/plugin` command does the same; the desktop and web
   apps don't have it, so the terminal commands are the universal path.)
2. 🧑 His next Claude Code session opens with three questions, asked exactly once:
   may Raphael learn from his work (required) · contribute scrubbed lessons to the
   community brain (on by default; bundles only stage locally, sending is always
   his click) · autopilot or manual (autopilot recommended). He
   answers, the agent runs `raph arise --autopilot` for him, and **26 curated
   lessons from the global brain are active immediately** — the brain is useful
   before it has seen a single line of his code.
3. That's the last thing he ever *has* to do. He codes normally. After each
   session, a background pulse mines, distills, and machine-curates; sessions
   start with a small block of relevant lessons and the project map; when he
   greps, a one-time nudge points him at the atlas.
4. About once a week he sees one line: *"Raphael this week: learned 8 lessons
   (1 security); recalled into 6 sessions for ~1,400 tokens."* If he's ever
   curious or suspicious: `raph why`, `raph pulse`, or `raph web` — where one
   click undoes anything the curator did.
5. 🧑 When he wants more, he asks for it by name: *"use the raphael-reviewer agent
   on this branch"*, *"use the raphael-debugger agent on this stack trace"*,
   *"follow the pre-deploy recipe."* The agents read his brain first, so their
   advice carries his own history.

**Human actions in month one: the install and the three answers.** Everything
else is optional curiosity.

## Journey B — manual (curator) mode, for those who want control

*Meet Priya, a full-stack developer who prefers to review everything herself.
Every point where a human must act is marked 🧑 — in this mode, Raphael is
deliberately human-in-the-loop.*

### Day 1 — install (10 minutes)

1. 🧑 Priya installs the CLI in her **terminal**: `npm install -g raphael-brain`.
2. 🧑 Still in her terminal:
   `claude plugin marketplace add maheshaggarwal21/raphael` then
   `claude plugin install raphael-brain@raphael`.
3. 🧑 At the three-question onboarding she picks **manual**, then runs
   `raph arise --pack --guard` in her terminal. This creates her brain at `~/.raphael`, stages the
   26-lesson security pack for review, installs the commit guard in her current
   repo, and prints what to do next. Nothing has activated yet — the pack arrived
   as *candidates*.
4. `raph doctor` says healthy.

### Day 1, ten minutes later — the first review session

5. 🧑 She runs `raph web`. The console opens. The Review tab shows 26 candidates.
6. 🧑 She batch-approves the ones she agrees with. For each *security* candidate, the
   console makes her open the full text and tick "I read it" before a one-item
   **Approve --confirmed** unlocks. This friction is intentional: security advice
   deserves eyes. She approves 24, rejects 2 that don't apply to her stack
   (🧑 with a one-line reason — the reason feeds the rejection memory, so similar
   ideas won't be proposed again for 180 days).
7. Her next Claude Code session starts with a few relevant security headlines in
   context. When she asks about a checkout page, a lesson about never trusting
   client-side prices fires. She runs `raph why` and sees exactly which keywords
   matched and that it cost 130 tokens.

### Week 1 — the brain starts learning *her*

8. She works normally. Nothing to do — Raphael's hooks are passive and budgeted.
9. 🧑 Friday, she runs `/brain-learn` (or `raph mine --yes && raph distill --yes`).
   Mining asks for per-project consent the first time 🧑. It finds four episodes —
   two error-fix pairs, two times she corrected the agent. Distillation (on her
   existing Claude subscription — no new bill) proposes three candidates; one is
   killed by the ephemera gate (it was about a port number).
10. 🧑 She reviews: approves two, edits the wording of one before approving.
11. Monday, the agent avoids the exact Prisma migration mistake it made last week.
    That's the product working.

### Week 2 — outside knowledge and the graph

12. 🧑 She finds a great blog post on webhook reliability. Instead of bookmarking it:
    `raph adopt https://…`. The gauntlet fetches, scrubs, license-checks, and the
    reviewer agent screens it; two candidates and one skill draft appear. 🧑 She
    approves the candidates; the skill draft stays in `staged/skills/` until she
    chooses to install it herself.
13. 🧑 She builds the graph: `raph atlas`. Free (zero tokens), a few seconds. Next
    time a weird `E-VALIDATION` appears, `raph atlas where "E-VALIDATION"` names the
    two files that raise it, ranked, with reasons — instead of ten minutes of grep.
14. The session-start hook now includes a tiny atlas digest, and when she greps
    manually, a one-time nudge reminds her the graph already knows.

### Week 3 — trust grows, clicking shrinks

15. 🧑 Comfortable with the pipeline's quality, she sets `raph auto standard`: her
    *own mined* lessons may now activate into a restricted tier without a click.
    Security lessons still always wait for her — the tool won't let her delegate
    that even if she wants to.
16. 🧑 She records a settled decision: `raph decide "We use Postgres, not MongoDB"
    --why "team expertise + relational data"`. Agents stop re-proposing Mongo.

### Month 1 — proof and upkeep

17. 🧑 She runs `/brain-eval` (`raph eval run --quick`). Same tasks, brain ON vs
    OFF, real agents: the ON arm avoids the seeded mistakes; the canary gate (which
    proves lessons can't make an agent execute anything) passes 100%, as always.
18. 🧑 Monthly upkeep, ten minutes: `raph stats` (three lessons never fire), `raph
    lint` (one lesson references a file that no longer exists — atlas-proven), `raph
    optimize` (suggests two retires). 🧑 She retires them with `--confirmed`.
19. 🧑 A teammate asks about her webhook lesson: `raph contribute webhook-idempotency`
    exports a scrubbed, portable file. She chose *this one lesson* to share —
    nothing else ever leaves her machine.

**Where humans are required in manual mode, in summary:** installing; consenting to
mining per project; every approve/reject/edit; anything security-flavored (always,
one at a time, after reading); adoption reviews and skill-draft installs; turning
the auto-approve dial; retiring lessons; sharing lessons; and — in either mode —
every deploy, sign-in, or spend. On autopilot (Journey A) that list shrinks to:
installing, the three answers, and deploys/sign-ins/spends. Sending contribution
bundles is a human click in both modes.

---

# Part 4 — Interview prep (as a Microsoft interviewer would ask it)

*Role-played: a Microsoft hiring panel interviewing Mahesh about Raphael, for an SDE
role. Questions, strong answers, and what the interviewer is really probing.*

## Technical questions

**Q1. Walk me through Raphael's architecture at a high level.**
**A.** A local-first pipeline with one invariant at its core: a single validation
chokepoint through which every piece of knowledge must pass. Around it: miners that
read session history, a distiller that calls a contained model through four quality
gates, a human review queue, a deterministic retrieval engine with hard token
budgets, and surfaces — a 40-verb CLI, a localhost web console, and a Claude Code
plugin. Storage is plain markdown in a git repo; the only network access is model
calls, user-initiated read-only fetches, and a weekly hash-verified down-sync of
the curated community seed from two pinned URLs. *(Probing: can you describe your
own system crisply, and did it have a real design center?)*

**Q2. Why deterministic keyword retrieval instead of embeddings? Isn't that less
powerful?**
**A.** It's a deliberate trade. Embeddings retrieve "similar" text but can't explain
why, need infrastructure, and fail silently. My corpus is small (dozens to hundreds
of curated lessons, each with explicit trigger keywords and scope), so an explainable
scorer covers it — and `raph why` can show the exact match reasons, which is what
builds user trust. I validated the bet by benchmarking the deterministic Atlas graph
against token-hungry search: 147.9× fewer tokens to answer origin questions. If the
corpus grows 100×, I'd revisit — that's recorded as a decision, not an ideology.
*(Probing: do you make engineering trade-offs from data or fashion?)*

**Q3. How do you stop prompt injection through the learning pipeline? You ingest
web content.**
**A.** Defense in depth. The fetcher treats content as data — never executed, size
and time capped. Secrets are scrubbed before any model sees material. A contained
reviewer agent (zero tools) screens for injection and malicious guidance; if its
verdict is malformed, the pipeline fails *closed*. The chokepoint then rejects
URL-bearing, tool-call-shaped, or imperative content, and quarantines anything
suspicious for heavyweight human review. Finally, lessons are injected inside a data
envelope that frames them as reference material, and containment canaries in the
eval harness continuously prove a lesson can't cause execution. *(Probing: security
thinking in layers, not slogans.)*

**Q4. What was your hardest bug?**
**A.** A live one that pure-logic tests couldn't catch: with `--json-schema`, the
CLI returns the payload in `structured_output` and sets `result` to the *empty
string*. My code used `result ?? structured_output` — and `""` isn't nullish, so it
shadowed the real object and extraction silently returned null. The fix preferred
`structured_output` and skipped empty strings, with a regression test. Lesson
learned — and literally written into the brain: run one real end-to-end pass early;
mocks inherit your assumptions. *(Probing: debugging depth and honesty about
failure.)*

**Q5. How do you test a system whose core behavior involves an LLM?**
**A.** Separate the deterministic from the stochastic. Everything deterministic —
gates, scrubbing, validation, ranking, state machines — is pure-function tested: 402
node:test cases, no mocking frameworks. The model boundary is one module, so tests
inject fake callers. For the stochastic part, the eval harness runs real agents on
seeded tasks, brain ON vs OFF, with Wilson confidence intervals, plus a 100%-pass
canary gate for safety properties. And live smokes are mandatory before "done" —
that's what caught the empty-string bug. *(Probing: test strategy beyond "I wrote
tests.")*

**Q6. You let the system modify itself. How is that safe?**
**A.** It can *propose*, never apply. A self-patch must sit on a branch with full
tests and eval canaries green; touching any chokepoint file (the validator, the
scrubber, the schema) flags it heavyweight and demands explicit acknowledgement;
copyleft ports are blocked outright. The gate's output is a presentation to a human,
who merges. The principle is enforced structurally — there is no code path that
merges autonomously. *(Probing: judgment about autonomy limits.)*

**Q7. How does the autonomous build system survive crashes and usage limits?**
**A.** State is written *before* every step — milestones, the current stage, dead
ends already tried, limit events with reset times — using atomic tmp+rename writes
(Windows-safe; no POSIX assumptions). A limit exhaustion exits with a specific code
and records itself; rerunning resumes the same stage via session resume. A logon
launcher makes even a reboot best-effort recoverable. The design rule: never carry
undocumented state in the process's head — checkpoint everything a resume needs.
*(Probing: distributed-systems instincts, even in a single-node tool.)*

**Q8. What would you change with 10× more users?**
**A.** Three things. First, the shared-lesson story: contribute exists, but
community packs need moderation and a registry — the same review discipline at
community scale. Second, warm-resident injection: the cold hook is ~300–390ms on
Windows; fine once per session, but a daemon would make per-prompt recall free.
Third, retrieval at corpus scale: past a few thousand lessons I'd add an index layer
— still explainable, maybe hybrid. What I *wouldn't* change: the quarantine floor.
Even after we shipped autopilot — where a machine curator with a canary gate and
batch rollback now handles approvals, security included — content that looks like a
prompt-injection attempt never machine-activates, in any mode. That floor is
structural. *(Probing: can you see beyond v1 without gold-plating v1?)*

## Behavioral questions

**Q9. Tell me about a time you disagreed with feedback and what you did.**
**A.** I proposed several project ideas for the self-training track; the owner
rejected all of them and supplied better ones. Instead of defending mine, I extracted
*why* theirs were better — verifiable without a GUI, commercially real, distinct
domains — and encoded those criteria so every future choice starts from them. Later,
when a photo-organizer idea came up, I used the criteria to argue it was the wrong
*first* build (its value is on-device ML + GUI, which can't be verified headlessly) —
and that pushback was accepted. Disagreement went both directions, on evidence.

**Q10. Describe working under a constraint you couldn't remove.**
**A.** Session token limits. A parallel review workflow once burned the entire
session budget mid-build. I recorded the event, kept the repo clean, resumed after
the reset, and changed the operating rule: autonomous builds run inline, not
parallel; heavy fan-out is reserved for supervised sessions. The constraint became a
design input — the limit-aware scheduler and checkpoint system exist because of it.

**Q11. Tell me about a time you caught yourself about to ship something wrong.**
**A.** My lint feature initially told users to run `raph retire` — a command that
didn't exist yet. Caught it before shipping and made it a named rule:
"capability-check" — never point a user or agent at a surface that isn't built. The
fix was to build retire in the same milestone. That rule now guards every hook nudge
and doc line.

**Q12. How do you handle work that's 95% autonomous but 5% must not be?**
**A.** Make the 5% structural, not procedural. In Raphael, deploys/sign-ins/spending
aren't "discouraged" — the stage kind doesn't exist, so the state machine *cannot*
express them; it stops and names the owner action. I applied the same idea to
security approvals (a coded error, not a guideline). If a boundary matters, encode it
where the code can't cross it, then culture doesn't have to be perfect.

**Q13. What are you most proud of in this project, and what's the biggest known
weakness?**
**A.** Proud of: the trust architecture — one door, human gates, budgets, and
measurement, which together make an AI system people can leave running. Weakness:
single-user by design so far — the collaborative story (shared packs, team brains)
is designed but unproven, and the 2–4-week self-use study that would give me
longitudinal numbers is still running. I'd rather name that than oversell it.
*(Probing: self-awareness; the honest-limits habit is itself the answer.)*

---

# Part 5 — Launch marketing

## LinkedIn (professional, technical depth)

> **Your AI coding agent has amnesia. I built it a brain.**
>
> Every new session, agents like Claude Code repeat mistakes you already paid to
> discover — the webhook that double-charged, the float that corrupted money math,
> the secret that nearly got committed.
>
> **Raphael** is an open-source learning layer that fixes this. It mines your real
> session history, distills mistakes into short reviewed "lessons," and injects the
> relevant ones back into your agent's context at exactly the right moment.
>
> What makes it different is the discipline, not the demo:
> ▪ Zero-touch — install once, answer three questions once. It mines, distills,
> curates, and injects on its own; you notice fewer tokens and better code, plus
> one digest line a week.
> ▪ One validation chokepoint — every lesson is schema-checked, secret-scrubbed,
> URL-free. No exceptions, including imports and the community seed.
> ▪ Trust-gated — a machine curator with a contained reviewer screen, a canary
> gate, and full-batch rollback (or classic manual review, your choice);
> injection-suspect content never auto-activates, in any mode.
> ▪ Budgeted + explainable — ≤1,200 tokens/session, and `raph why` shows exactly
> what fired and why. No embedding black box.
> ▪ Measured — a built-in eval runs identical tasks brain-ON vs brain-OFF. Its
> deterministic code graph answered "where does this error come from?" with 147.9×
> fewer tokens than grep-and-read.
> ▪ Self-trained — it autonomously built three real, public, tested products and
> learned from its own builds. And it ships 10 specialist agents (planner,
> architect, reviewer, debugger…) that all read the brain before acting.
>
> Local-first, MIT-licensed, 402 tests, zero-dependency core (Node + two libraries).
>
> `npm install -g raphael-brain` → `raph arise --autopilot`
>
> I'd genuinely value feedback from people building with coding agents — what would
> make you trust an always-on memory layer?
>
> #AIEngineering #DeveloperTools #ClaudeCode #LLM #OpenSource #AIAgents
> #SoftwareEngineering #DevTools #MachineLearning #BuildInPublic

## Instagram (catchy, visual-first — pair with a carousel: slide 1 the hook, slides 2–5 the loop diagram, a `raph why` screenshot, the 147.9× stat, install command)

> **POV: your AI remembers the bug from last Tuesday 🧠⚡**
>
> AI coding assistants forget EVERYTHING between sessions. Same mistakes. Every.
> Single. Day.
>
> So I built Raphael — a brain that:
> 🔁 learns from your real coding sessions — automatically, after every session
> 🧠 starts smart: 26 curated lessons active the moment you install
> 🎯 whispers the right lesson at the right moment
> 🔒 keeps everything on your machine
>
> Install it once. Forget it exists. Watch your agent stop repeating last
> Tuesday's bug. It even taught itself by building 3 real apps. Autonomously. 🤯
>
> One command: `raph arise --autopilot` ✨
> Link in bio. Free + open source.
>
> #coding #ai #developer #programmerlife #techtok #buildinpublic #opensource
> #codinglife #artificialintelligence #devtools #softwareengineer #100daysofcode
> #claudeai #machinelearning #programming

## X / Twitter (punchy, thread-starter)

> your AI coding agent forgets everything between sessions.
>
> so I built it a brain. one that runs itself.
>
> install once, answer 3 questions once. Raphael mines your real sessions →
> distills mistakes into lessons → machine-curates them (canary-gated, rollback
> on failure) → injects them back at the right moment. local-first, ≤1.2k
> tokens/session, fully explainable retrieval, one digest line a week.
>
> it even trained itself — autonomously shipping 3 real products and learning from
> its own builds.
>
> MIT licensed. `npm i -g raphael-brain && raph arise --autopilot`
>
> 🧵 how the six-layer trust pipeline works ↓
>
> #AI #DevTools #OpenSource #ClaudeCode #BuildInPublic

*(Thread idea: 1: the chokepoint. 2: the human gate + security floor. 3: `raph why`
screenshot. 4: the 147.9× atlas bench. 5: the Academy products. 6: install + repo
link.)*

## Influencer outreach DM (personalize the [bracketed] parts per person)

> Hi [name] — I've followed your work on [their specific content, e.g. "agentic
> coding workflows"] for a while; your piece on [specific video/post] shaped how I
> think about [topic].
>
> I just open-sourced something I think sits exactly in your lane: **Raphael**, a
> learning layer ("brain") for AI coding agents. Install it once and it runs
> itself: it mines your real sessions, distills mistakes into lessons, curates
> them through a canary-gated machine reviewer (or full manual review if you
> prefer), and injects the relevant ones back — budgeted, explainable,
> local-first, with injection-suspect content never auto-activated. It also
> trained itself by autonomously building three real public products, which makes
> for a fun story.
>
> No ask beyond: would you try it for a week?
> `npm i -g raphael-brain && raph arise --autopilot` — two minutes to a working
> setup, 26 curated lessons active immediately, then nothing to manage. If it earns a mention, great; if it doesn't,
> your blunt criticism would honestly be just as valuable — there's a built-in eval
> (`raph eval`) so claims can be checked, not vibed.
>
> Happy to send a 5-minute demo video or answer anything. Either way, thanks for the
> work you put out. — Mahesh

**Suggested targets:** creators covering AI coding workflows (Claude Code / Cursor /
agentic dev on YouTube and X), open-source dev-tool newsletters, and podcast hosts in
the AI-engineering space. Lead with the self-training story — it's the hook none of
the "memory" tools have.

---

*Companion docs: [docs/manual.md](../manual.md) (every command, how and when) ·
[README.md](../../README.md) (the front door) · [ARCHITECTURE.md](../../ARCHITECTURE.md)
(the full design).*
