# Raphael

**A learning layer ("brain") for AI coding agents — install it once, and it runs
itself.** Raphael distills lessons from your real projects — the mistakes, the
fixes, the decisions — and injects the relevant ones back into your agent's context
at the right moment, so known mistakes stop recurring.

Your coding agent forgets everything between sessions. You don't have to.

- **Zero-touch by default (autopilot)** — one install, one consent, done. Raphael
  mines, distills, screens, approves, and indexes after each session, silently, on
  your existing Claude subscription. You notice the *result*: fewer tokens, better
  code, production-grade security — plus one short line a week saying what it learned.
- **It starts smart** — every new brain is seeded from the **global brain**: a
  curated, human-reviewed lesson set (26 security lessons at v1) that updates
  weekly from this repo. Your local learning stacks on top and always wins.
- **Curation never left** — autopilot replaces the human queue with a *machine
  curator*: a contained reviewer screen, a canary gate with whole-batch rollback,
  probation confidence, and self-retirement. Quarantined (injection-suspect)
  content never machine-activates, in any mode.
- **Recall is budgeted and visible** — ≤ ~1,200 tokens/session, `raph why` shows
  every injection, `raph web` shows everything and undoes anything in one click.
- **Local by default** — the brain lives in `~/.raphael`, in its own git repo that
  blocks pushes. Contribution to the global brain (on by default at autopilot
  setup, one command to withdraw) only ever *stages* scrubbed bundles locally —
  nothing is sent except by your own action.
- **Proof, not vibes** — `raph eval` measures the same tasks with the brain ON vs
  OFF; `raph atlas bench` measured **147.9× fewer tokens** answering "where do I
  look?" with the deterministic project graph vs grep-and-read.
- **Prefer control?** `raph auto manual` keeps the classic curator mode: you review
  every lesson, security always waits for you.

**[The full manual — every command, how and when to use it → docs/manual.md](docs/manual.md)**
· [ARCHITECTURE.md](ARCHITECTURE.md) for the complete design.

## Install (and forget)

Two steps, in two different places:

**Step 1 — in your terminal** (PowerShell, cmd, or any shell — anywhere on your
system; needs [Node.js](https://nodejs.org) 18+):

```
npm install -g raphael-brain        # or, from GitHub: npm install -g maheshaggarwal21/raphael
```

This installs the `raph` CLI — the engine. Check it worked: `raph version`.

**Step 2 — also in your terminal** (the `claude` CLI comes with Claude Code):

```
claude plugin marketplace add maheshaggarwal21/raphael
claude plugin install raphael-brain@raphael
```

This installs the plugin, which auto-wires recall into your sessions and adds the
`/brain` commands and the 10 agents. Verify with `claude plugin list` — you should
see `raphael-brain` enabled.

> Using Claude Code **in a terminal**? You can type the same two lines as
> `/plugin marketplace add …` and `/plugin install …` in the chat instead — same
> result. The `/plugin` dialog is **not** available in the desktop app or web,
> which is why the `claude plugin …` terminal commands above are the reliable
> path everywhere.

That's the whole install. **Your next Claude Code session asks you three questions
once** (may Raphael learn from your work · contribute scrubbed lessons to the
community — on by default, bundles only ever stage locally and sending is always
your own click · autopilot or manual) and runs the setup itself — just answer in
chat. Prefer to set up by hand? Run one of these **in your terminal**:

```
raph arise --autopilot            # zero-touch: consent + seed + autopilot + sharing in one command
raph arise --autopilot --no-contribute   # same, but nothing is ever staged for sharing
raph arise --pack --guard         # or the manual (curator) setup — you review everything
```

Change your mind any time: `raph contribute on|off`, or the console's Settings tab.

From here on: every `raph …` command in this README runs **in your terminal**;
everything starting with `/` (like `/brain`) is typed **inside Claude Code**.

`arise --autopilot` seeds your brain with the global brain's curated lessons
(active immediately — cold-start solved) and turns on the background loop. Run
`raph doctor` any time to check health; `raph pulse` shows the last heartbeat.

### Your first session — what to expect

- **Right after install:** your next Claude Code session shows the three setup
  questions, once. Answer them (or run `raph arise --autopilot` yourself) and
  you're done forever.
- **From then on:** sessions just start with a small block of relevant lessons
  (and your project's map, once built). You don't run anything.
- **Wondering if it's on?** `raph status` (one-line picture), `raph why` (what got
  injected into your last sessions and what it cost), `raph pulse` (what the last
  background heartbeat learned).
- **Want it quiet?** `raph off` stops injection instantly; `raph on` resumes.

## The loop (autopilot)

```
 session ends ──▶ raph pulse (background, budgeted, fail-open)
                   ├─ mine your real session history        (zero tokens)
                   ├─ distill episodes into candidates      (your subscription)
                   ├─ MACHINE CURATOR: reviewer screen ▸ canary gate ▸ activate
                   │   (security included; quarantine never; rollback on any failure)
                   ├─ sync the global brain (weekly, hash-verified, local wins)
                   ├─ refresh the project atlas             (zero tokens)
                   └─ self-retire lessons that never help   (probation)
 your next session ◀── auto-injection: relevant lessons + project map + weekly digest
                       budgeted, enveloped as data, fail-open, raph why explains it
```

In manual mode the same loop runs through your hands: `raph mine` → `raph distill`
→ `raph queue/approve`. Add lessons by hand with `raph note`, or seed curated packs
with `raph pack add security`. Distillation uses your **Claude Code subscription**
by default (fixed price, no API key, model contained with zero tools).

## The agents — 10 specialists that share your brain

The plugin ships ten ready-made agents. They are not generic personas: every one
**consults your brain first** (`raph search` for the task's keywords), runs **free
checks before paid ones** (linters, grep, git — zero tokens), reads the **project
map instead of the whole repo**, and **writes back** anything durable it learned
(`raph note`). Using the agents literally feeds the brain — that's the flywheel.

**How to run one — just ask for it by name in Claude Code:**

> "Use the **raphael-reviewer** agent to review my last commit."
> "Use the **raphael-planner** agent — I want to build a habit tracker."

Claude Code will also pick one automatically when your request matches an agent's
job description. Run `/agents` in Claude Code to see them all listed.

| Agent | Reach for it when… | What to give it |
|---|---|---|
| **raphael-planner** ★ | you have a fuzzy idea and want a sharp, buildable spec | the idea in a few sentences + your constraints (time, stack, must-haves) |
| **raphael-architect** ★ | the spec is done and you need the technical design | the planner's spec (or your own), stack preferences, expected scale |
| **raphael-developer** | it's time to write the code | the architect's plan or the concrete task + which files/dirs are in scope |
| **raphael-reviewer** ★ | before you merge anything | the diff — a branch name, commit, or "review my uncommitted changes" |
| **raphael-security** | before shipping anything touching auth, payments, or user data | the repo path + one line on what the app does (it scans the rest itself) |
| **raphael-debugger** ★ | something is broken and you don't know why | the exact error text + how to reproduce it (command, input, environment) |
| **raphael-design** | the UI feels off or inconsistent | the screens/components to look at + any design decisions you've recorded |
| **raphael-deployer** | you're about to ship | the target platform; it produces the checklist and **stops** — it never deploys |
| **raphael-critique** | you want any other agent's output stress-tested | that output, verbatim — it reads only the output and its cited evidence |
| **raphael-manager** | multi-step work and you don't want to route it yourself | the goal; it picks the specialists and merges their answers |

★ = flagship (deepest polish, covered by eval scenarios). For a from-scratch build
the natural order is **planner → architect → developer → reviewer + security →
deployer**, with critique on anything you're unsure about.

**Recipes** — four short playbooks the agents follow, in
[plugin/recipes/](plugin/recipes/): `debug`, `review`, `pre-deploy` (always runs
`security-audit` first), `security-audit`. Ask for one in plain words: *"follow the
pre-deploy recipe for this repo."*

**Slash commands** — guided flows: `/brain` (hub + status), `/brain-learn` (mine +
distill this project), `/brain-review` (the queue, `1y 2n 3e` batch grammar),
`/brain-eval` (the ON/OFF proof). On autopilot you rarely need them — they're the
manual-mode and power-user surface.

## Beyond the loop

- **`raph adopt <url|repo|file>`** — drop a link, keep the knowledge: a six-layer
  gauntlet (bounded fetch → scrub → license gate → contained reviewer agent →
  chokepoint → your queue) with a provenance ledger and one-command `revoke`.
- **`raph atlas`** — a deterministic knowledge graph of any codebase (files, symbols,
  error codes; imports/tests/calls). Built and queried with zero model tokens.
  `raph atlas where "E-THING"` answers "where do I look when this breaks?";
  `raph atlas export` produces an Obsidian vault.
- **`raph guard`** — a pre-commit hook that blocks secret leaks in your own repos,
  using the same patterns as the brain's chokepoint.
- **`raph web`** — the local console: eight tabs, localhost-only, token-guarded,
  every button calling the exact CLI engine.
- **`raph academy` / `portfolio` / `report weekly`** — Raphael trains itself by
  building real products autonomously (checkpointed across limits and reboots, with
  deploy/sign-in/spend always reserved for the owner) and reports like a company.
- **`raph contribute`** — share a lesson on purpose: local traces stripped, full body
  re-scrubbed, re-validated through the chokepoint before it leaves your machine.
- **`raph eval` / `stats` / `lint` / `optimize`** — proof and upkeep: ON/OFF lift,
  cost per injection, retrieval misses, stale/contradicting lessons, prune candidates.

Three products built by Raphael's own autonomous Academy while training itself:
[repo-keeper](https://github.com/maheshaggarwal21/repo-keeper) ·
[onedesk](https://github.com/maheshaggarwal21/onedesk) ·
[assay](https://github.com/maheshaggarwal21/assay)

## Security model

1. One door in: `validateLesson()` — schema-checked, URL-free, no executable fields,
   declarative voice. No exceptions — imports, curated packs, the global brain,
   and autopilot all pass the same chokepoint.
2. Secrets scrubbed before any model sees mined text, and again on output.
3. Lessons are advisory data; they cannot command an agent. Containment canaries in
   the eval harness re-prove it (`raph eval run --dry-run` — free), and autopilot's
   canary gate re-runs them before every automatic activation (fail = full rollback).
4. In manual mode, security lessons never activate without you. In autopilot they
   activate only through the machine curator (strict reviewer screen + canary gate);
   quarantined injection-suspect content never machine-activates in ANY mode.
5. Network access: model calls, user-initiated read-only adopt fetches, and the
   weekly global-brain down-sync (two pinned HTTPS URLs, hash-verified, covered by
   your install consent). Nothing else — contribution bundles stage locally and are
   only ever sent by your own action.
6. Everything mined stays local unless you granted contribution — and even then,
   bundles are stripped of project traces, re-scrubbed, and re-validated first.

## Development

```
npm install
npm test                  # 402 tests, node:test, no frameworks
node bin/raph.js help     # the full CLI surface (40 verbs)
```

Point `RAPHAEL_HOME` at a scratch directory to sandbox any command. CI runs the test
suite plus the canary gate on Linux + Windows, Node 18/20/22.

## License

[MIT](LICENSE)
