# The Raphael Manual — every command, how and when to use it

Raphael is a **learning layer ("brain") for AI coding agents**. It watches your real
work, distills the mistakes and fixes into short *lessons*, lets **you** approve each
one, and then whispers the relevant ones back to your coding agent at exactly the
right moment. The result: your agent stops repeating mistakes you already paid for.

This manual explains every command: what it does, **when** to reach for it, and how
to run it. Plain language throughout. Jargon is explained the first time it appears.

**Where commands run — the one rule to remember:**

| Command looks like… | Type it in… |
|---|---|
| `raph …` (e.g. `raph status`) | your **terminal** (PowerShell, cmd, bash — any shell) |
| `/…` (e.g. `/brain`) | the **Claude Code chat input** — slash commands |
| `claude plugin …` | your **terminal** — Claude Code's own CLI (works even where `/plugin` doesn't) |
| "use the raphael-… agent" | the **Claude Code chat input** — plain words |

Quick vocabulary:

- **Brain** — a folder (`~/.raphael`) holding your lessons, kept in its own git repo.
- **Lesson** — one short, reviewed fact learned from real work ("webhook handlers must
  dedupe on event id"). Lessons are *advisory data* — they can never command an agent.
- **Candidate** — a lesson waiting for your review. Nothing becomes active without approval.
- **Injection / recall** — the act of adding relevant lesson headlines into your coding
  agent's context automatically (budgeted, visible, and easy to turn off).
- **Chokepoint** — the single validation gate (`validateLesson()`) every lesson must pass
  to enter the brain. There is no other door.

---

## 0. Autopilot — the default way to run Raphael

Install once, answer three questions once, and Raphael runs itself. This is the
recommended mode for almost everyone.

### The three questions (asked once, in your first chat session)
The first Claude Code session after installing the plugin, the agent asks you:
1. **May Raphael learn from your coding sessions on this machine?** (required —
   this is the whole point; "no" leaves Raphael dormant)
2. **Contribute your anonymized, scrubbed lessons to the community brain?**
   (recommended, on by default — the grant only lets bundles *stage* on your
   machine; sending is always your own click; change any time with
   `raph contribute on|off`)
3. **Autopilot or manual?** (autopilot recommended)
It then runs `raph arise --autopilot` for you (with `--no-contribute` if you
declined sharing). Never asks again.

### What autopilot does after every session (`raph pulse`)
A background heartbeat, budgeted and fail-open — it can never block or slow you:
- **mines** the session you just finished (zero tokens, incremental)
- **distills** episodes into candidate lessons (your Claude subscription,
  capped at 8 episodes/pulse and 3 distill runs/day)
- **machine-curates**: every candidate — security included — passes a contained
  reviewer screen, then the whole batch faces the canary gate (the chokepoint
  canaries must still block + the index must rebuild) or it ALL rolls back
- **syncs the global brain** weekly (new curated lessons flow in, hash-verified;
  your local lessons always win any conflict)
- **stages a contribution bundle** (only with grant #2, weekly, local-only —
  sending is always your own click)
- **refreshes the project atlas** when the repo changed (zero tokens)
- **self-retires** machine-activated lessons that never help (probation)
- **installs the commit guard** in the project's git repo automatically (the
  pre-commit secret hook, §7) — never clobbering a hook you already had;
  opt out with `autopilot.auto_guard: false` in config.yaml
- **keeps the `raph` CLI up to date** — a daily check of the npm registry, and if
  a newer `raphael-brain` is published it runs `npm install -g raphael-brain@latest`
  for you (npm's own integrity check is the gate; never downgrades). Opt out with
  `autopilot.auto_update: false`

### What you see
One short line, at most once a week, only when something happened:
> Raphael this week: learned 12 lessons (2 security); recalled into 9 sessions
> for ~2,100 tokens total. Inspect or undo anything: raph web.

Useful verbs while on autopilot:
```
raph pulse            # the last heartbeat: what ran, what it learned
raph auto             # current mode + dial
raph auto manual      # step down to curator mode (you review everything)
raph web              # the console: activity feed, lessons, one-click undo
```

---

## 1. Getting started

### Installing (before any `raph` command exists)
Both steps run **in your terminal** (needs Node.js 18+):
`npm install -g raphael-brain` gives you the `raph` CLI; then
`claude plugin marketplace add maheshaggarwal21/raphael` and
`claude plugin install raphael-brain@raphael` wire the hooks, agents, and
`/brain` commands into Claude Code. Details (and the in-chat `/plugin`
alternative for terminal sessions) in §10.

### `raph arise` — the one-command first run
**When:** you just installed Raphael and want everything set up in one go
(the in-chat onboarding runs this for you if you let it).
**What (autopilot):** records the three permissions, seeds your brain from the
global brain's curated lessons (active immediately), turns on the background loop.
**What (manual):** creates the brain, optionally stages the security pack for your
review and installs the commit guard, then prints your first five minutes.
```
raph arise --autopilot                # zero-touch (sharing on by default; --no-contribute opts out)
raph arise --pack --guard             # manual: 26 security lessons to review + guard
```

### `raph init` — create the brain
**When:** you want just the brain, no extras (arise calls this for you).
**What:** creates `~/.raphael` (config, folders, the brain git repo, and a pre-push
guard so the brain can never be pushed anywhere by accident). Non-destructive: it only
creates what is missing and never touches existing lessons.
```
raph init             # the brain
raph init --guard     # + the secret-scanning pre-commit hook in the current repo
```

### `raph status` — where am I?
**When:** any time you want the one-line picture.
**What:** brain location, lesson counts, how many candidates await review, current mode.

### `raph doctor` — is everything healthy?
**When:** something feels off, or after installing/updating.
**What:** checks the environment (Node, git, the Claude CLI), the brain's integrity,
and the plugin wiring, and tells you the exact fix for anything wrong.

### `raph update` — stay on the latest version
**When:** almost never by hand — on autopilot the pulse checks daily and upgrades
for you. Reach for it if you're in manual mode, or want to update right now.
**What:** asks the npm registry whether a newer `raphael-brain` exists and, if so,
runs `npm install -g raphael-brain@latest` (npm verifies the download's integrity;
never downgrades). `--check` looks without changing anything.
```
raph update           # upgrade if a newer version is published
raph update --check   # just tell me if I'm behind
```

---

## 2. The learning loop (how lessons get made)

The loop is: **mine → distill → review → active**. In manual (curator) mode, **you**
are the gate in the middle — this section is how you work it. On autopilot the same
loop runs itself after every session (§0), with the machine curator holding the gate;
these commands still work and still matter when you want to intervene by hand.

### `raph mine` — read your own history
**When:** after a few real working sessions in a project, or weekly.
**What:** reads your Claude Code session transcripts for that project (only with
per-project consent, recorded in config) and finds *episodes* — an error and its fix,
or a moment you corrected the agent. Secrets are scrubbed before anything else sees
the text. Found episodes go to a local ledger; nothing leaves your machine.
```
raph mine --dry-run     # see what it would find, write nothing
raph mine --yes         # mine for real
```

### `raph distill` — turn episodes into candidate lessons
**When:** after mining, when the ledger has episodes.
**What:** sends each scrubbed episode to a model (your Claude Code subscription by
default — fixed price, no API key needed) which extracts a short general lesson.
Four gates then filter the output: *ephemera* (throwaway details like port numbers),
*rubric* (is it actually a lesson?), *dedupe* (do we already know this?), and
*rejection memory* (did you already reject this idea? then don't ask again for 180
days). Survivors land in your review queue as candidates.
```
raph distill --dry-run          # cost estimate, no model calls
raph distill --yes              # run it
```

### `raph note` — teach it something directly
**When:** you just learned something the hard way and want it remembered *now*.
```
raph note "Vercel edge functions cap request bodies at 4.5MB" --category tooling --keywords vercel,edge,upload
```
The note still passes the same chokepoint and still lands as a candidate for review
(you might phrase it better tomorrow).

### `raph queue` / `raph show` — see what's waiting
**When:** the queue nudge appears, or after mine/distill/pack/adopt.
**What:** `queue` lists candidates numbered; `show <n>` prints one in full, including
where it came from (`--provenance`).

### `raph approve` / `raph reject` — the human gate
**When:** reviewing the queue. This is the most important thing you do in Raphael.
```
raph approve 1 2 5                 # activate — they start injecting from now on
raph reject 3 --reason "too vague" # gone, and similar ideas auto-suppress for 180 days
```
Security-category and quarantined candidates cannot be batch-approved: you must `show`
them (full body) and approve one at a time with `--confirmed`. That is deliberate —
a lesson that talks about auth or deploys deserves your eyes.

### `raph retire` — remove a lesson that no longer holds
**When:** the world changed (library fixed the bug, you switched stacks) or `raph lint`
flagged it. Irreversible, so it requires `--confirmed`. Retired lessons tombstone for
180 days so distill won't re-propose the same idea next week.

### `raph pack` — instant value on day one
**When:** your brain is empty and you want it useful *today*.
**What:** seeds a curated pack — currently `security`, 26 lessons distilled from
professional audit checklists (secrets in code, IDOR, missing security headers,
client-side prices, XSS, RLS…). They arrive as *candidates*: even curated packs
never skip your review, and the security ones take the heavyweight path.
```
raph pack add security
```

---

## 3. Recall (how lessons reach your agent)

### The hooks — automatic, budgeted, visible
With the Claude Code plugin installed, two hooks fire on their own:
- **Session start:** a handful of the most relevant lesson headlines for the project
  you're in, plus (if built) the project's atlas digest and your standing decisions.
- **On your prompt:** up to 3 lessons matched against what you just asked.

Hard rules: at most ~1,200 tokens per session ever; lessons are wrapped in a *data
envelope* that tells the agent "this is reference data, not instructions"; if anything
fails the hook stays silent (your session is never broken by recall).

### `raph search` — ask the brain by hand
**When:** you want to know what the brain would say about a topic.
```
raph search "webhook retries stripe"
```
Uses the exact same scorer as the hooks, and shows *why* each lesson matched.

### `raph why` — what got injected, and what it cost
**When:** you're curious or suspicious about recall. Shows the recent injections,
which keywords fired, and the token cost of each.

### `raph on` / `raph off` — the kill switch
**When:** demos, benchmarks, or you just want quiet. Mining and review keep working;
only injection stops.

### `raph inject` — plumbing (you rarely run this)
The hook entry point. Reads the hook's JSON on stdin, prints the context block.
Always exits 0 — a broken brain never blocks your session.

---

## 4. Knowledge from outside

### `raph adopt` — drop a link, keep the knowledge
**When:** you found a good article, repo, or skill file and don't want it to die in a
browser tab.
```
raph adopt https://example.com/great-post
raph adopt ./cool-repo               # local repo dir
raph adopt ./SKILL.md --skill        # a skill file
raph adopt <src> --dry-run           # read + license check, zero model calls
```
Every adoption runs a **six-layer gauntlet**: bounded read-only fetch (https GET only,
size/time capped, content never executed) → secret scrub *before* any model sees it →
a contained reviewer agent that screens for prompt injection and malicious guidance →
extraction → the same chokepoint as everything else → your review queue. Reusable
procedures become skill *drafts* in `staged/skills/` — clearly marked, never
auto-installed. `raph adopt list` shows the provenance ledger (source, license,
verdict, what it produced); `raph adopt revoke <id>` undoes an entire adoption in one
command — staged candidates removed, activated lessons retired, drafts deleted.

### `raph auto` — the auto-approve dial (and the autopilot switch)
**When:** you want to choose how much clicking you do.
```
raph auto off        # everything waits for you
raph auto standard   # your OWN mined lessons may activate into a restricted tier
raph auto wide       # + adopted material too (capped per day)
raph auto full       # = AUTOPILOT: mode + dial together, the machine curator takes over
raph auto manual     # back to curator mode — you review everything again
```
On the plain dial (off/standard/wide), security lessons **always** wait for a human —
enforced in code (`E-AUTOSEC`), not by convention. At `full` (autopilot), security
lessons may activate too, but **only** through the machine curator's stricter path:
a contained reviewer screen with a security addendum, then the canary gate, with
whole-batch rollback on any failure. Quarantined (injection-suspect) content never
machine-activates at **any** setting, in any mode.

### `raph contribute` — share lessons, safely
**When:** sharing with a teammate, or feeding the community brain.
```
raph contribute on|off                          # the community-sharing grant (on by
                                                #   default at autopilot setup)
raph contribute list
raph contribute webhook-idempotency --out ./to-share   # export one named lesson
raph contribute bundle                          # stage new local lessons as a bundle
raph contribute send                            # show staged bundles + where to submit
```
Every export strips project names, path globs, and local evidence references,
re-scrubs the full text for secrets, and re-validates through the chokepoint. If
the result can't pass the same gate that guards your own brain, it is refused.
The grant only lets bundles **stage on your machine** — Raphael never uploads
anything; `send` shows you the files and the submission page, and the click is
yours. Withdraw any time with `raph contribute off` (or Settings in the console).

---

## 5. Project intelligence (zero model tokens)

### `raph map` — the cheap project map
**When:** you want agents to read a summary instead of crawling the repo.
Deterministic scan + git-churn hot files. Free by default.

### `raph atlas` — the project knowledge graph
**When:** any codebase you work in regularly; build it once, query it forever.
**What:** a deterministic graph of files, symbols, packages, and error codes with
imports/tests/calls edges — built and queried with **zero model tokens**.
```
raph atlas                       # build/refresh (cached by content hash)
raph atlas where "E-SCHEMA"      # "where do I look when this breaks?" — ranked files + reasons
raph atlas path src/a.js src/b.js  # how two files connect
raph atlas explain validateLesson  # one symbol: who calls it, who tests it
raph atlas digest                # the compact block the hooks inject at session start
raph atlas bench                 # honest measurement: graph vs grep-and-read
raph atlas export                # a self-contained Obsidian vault of your codebase
```
Measured on Raphael itself: answering "where does this error come from" cost **147.9×
fewer tokens** with the graph than with grep-and-read.

### `raph lint` — health check on the lessons themselves
**When:** monthly, or before contributing/publishing lessons.
Finds dated wording ("as of 2025…"), file paths that no longer exist (proven against
the atlas — only for file types the atlas actually indexes), possible contradictions
between lessons, and low-confidence retire candidates. All advisory; it never deletes.

### `raph decide` — the decision ledger
**When:** you settle something you don't want re-litigated ("we use Postgres, not
Mongo"). Recorded decisions are surfaced at session start so agents stop reopening
them. `raph decide list` shows history; superseding is explicit and keeps the old entry.

---

## 6. Proof and self-measurement

### `raph eval` — prove the brain helps, with numbers
**When:** you doubt it, or before recommending Raphael to someone.
**What:** runs the same task with the brain ON and OFF (real agents, throwaway
fixtures) and reports the lift with confidence intervals. Also runs the **canary
gate**: containment probes that must pass 100% — they verify a lesson can never make
an agent execute anything.
```
raph eval run --dry-run    # canaries + "would the defending lesson even fire?" — free
raph eval run --quick      # a small real run
```

### `raph stats` — is it earning its keep?
**When:** weekly. Shows token cost per injection/session, which lessons fire (and
which never do — *retrieval miss*), the review funnel, and the latest atlas bench
leverage per project.

### `raph validate` — run the chokepoint by hand
**When:** editing lesson files manually, or checking a shared lesson before import.
```
raph validate --all
```

---

## 7. Guard rails for your own repos

### `raph guard` — don't commit secrets
**When:** every repo you own. On **autopilot you don't even install it** — the
pulse adds the hook to any consented git repo you work in automatically (a
foreign pre-commit hook is never touched; `autopilot.auto_guard: false` opts
out). The commands below are for manual mode, audits, and special cases.
```
raph guard install       # pre-commit hook in the current repo
raph guard scan --all    # audit every tracked file right now
```
Uses the same secret patterns as the brain's chokepoint — one definition of "secret".
Blocks named-pattern hits by default; add `--entropy` for the noisier high-entropy
pass. Scans staged content only, fails open (a broken scan can't wedge your commit),
refuses to clobber someone else's pre-commit hook. A `.raphallow` file at the repo
root allowlists known-benign paths (test fixtures) — always announced, never silent.

---

## 8. The console — `raph web`

**When:** reviewing feels nicer with a mouse, or you want the dashboard view.
```
raph web
```
Eight tabs — Dashboard, Review queue, Lessons, Adopt, Activity, Company, Guard,
Settings — every button calling the *same functions* as the CLI verb it mirrors.
Settings covers the autopilot/manual mode switch, the auto-approve dial (including
`full`), the community-sharing grant, injection status, and per-project mining
consent.
Nothing is possible in the browser that isn't possible (and tested) at the command
line. Security: binds to `127.0.0.1` only, a fresh token per launch, Host + Origin
checks on every request, strict inline-only CSP, and everything rendered is treated
as untrusted text.

---

## 9. The company layer (Raphael as a self-running studio)

These commands exist because Raphael trains itself by **building real products**
("the Academy") and runs its own operations like a small company.

### `raph academy` — autonomous builds that survive anything
Start, checkpoint, and resume long autonomous builds. State is written before every
step, so a usage-limit reset or a reboot resumes exactly where it stopped.
`checkpoint --tried "<dead end>"` records approaches that failed so a resume never
repeats them. The **autonomy boundary is enforced in code**: there is no "deploy"
stage kind — publishing, signing in, and spending are always the owner's actions.
```
raph academy start my-product --brief "..."   # register a build
raph academy drive my-product --pipeline      # the autopilot: plan → build → test → …
raph academy status my-product
```

### `raph portfolio` — every build at a glance
Project table: status, milestones, tests, lessons written back, recall cost.

### `raph report weekly` — the board report
What was built, what changed in the brain, what recall cost, what's waiting on you.

### `raph policy` — which model runs which task
The routing table (task kind → model + effort). Cheap models for mechanical work,
big ones only as escalation — never as the default first pass.

### `raph agent` / `raph skills` / `raph optimize` — the meta layer
- `raph agent` drafts *proposals* for new roster agents when demand shows up in the
  data — staged as files, never self-installing.
- `raph skills` packages a broadly-firing lesson into a SKILL.md draft with a
  mandatory "Honest limits" section — staged, never auto-installed.
- `raph optimize` is the pruning report: retire candidates, retrieval misses,
  confidence distribution, agent coverage. Recommendations only.

### `raph selfcheck` / `raph selfpatch` — how Raphael changes itself
Before any change to Raphael's own code merges: branch + full tests + eval canaries
must be green (`selfcheck`). A proposed self-patch additionally gets flagged
heavyweight if it touches the chokepoint files, and copyleft near-verbatim ports are
blocked (`selfpatch`). Both gates **present** a patch for a human to merge — Raphael
never merges its own code. "No measurement, no mutation."

---

## 10. The Claude Code plugin surface

Installed with two lines **in your terminal** (the `raph` CLI from §1 should
already be installed):
```
claude plugin marketplace add maheshaggarwal21/raphael
claude plugin install raphael-brain@raphael
```
Verify with `claude plugin list`. If you use Claude Code **in a terminal**, the
in-chat equivalents `/plugin marketplace add …` and `/plugin install …` do the
same thing — but the `/plugin` dialog does not exist in the desktop or web app,
so the `claude plugin …` terminal commands are the path that works everywhere.

**Hooks (automatic):** SessionStart + UserPromptSubmit run `raph inject` — recall
with the budgets and envelopes described in §3. A PreToolUse nudge fires once per
session when you grep/search a project that has an atlas built: "the graph already
knows — try `raph atlas where`." SessionEnd runs `raph pulse --async` — the
autopilot heartbeat (§0): it returns in milliseconds and does the mining,
distilling, curating, and atlas upkeep in a detached background process. On a
fresh install, the very first SessionStart instead delivers the one-time
onboarding (the three permission questions, §0).

**Slash commands:**
- `/brain` — the hub: onboarding on first run, status + next best action after.
- `/brain-learn` — mine + distill the current project in one flow.
- `/brain-review` — the queue with a batch grammar (`1y 2n 3e` = yes/no/edit).
- `/brain-eval` — the ON/OFF proof, guided.

**The `brain-recall` skill:** lets the agent *pull* lessons mid-task when stuck,
before risky changes (deploys, migrations, auth, payments) — complementing the
automatic *push* of the hooks.

### The 10 agents — who they are and how to use them

The plugin ships ten specialist agents. What makes them different from generic
personas is the shared **spine** baked into each one, in this order:
1. **Brain first** — pull the relevant lessons (`raph search`) before doing anything.
2. **Free checks before paid checks** — linters, grep, git stats cost zero tokens.
3. **Map, not the whole repo** — read the project map / atlas, open only what's needed.
4. **Cheap → strong** — sweep with a cheap model, escalate only survivors.
5. **Write back** — durable findings become `raph note` candidates. Using the
   agents feeds the brain.

**Invoking one:** ask for it by name in plain words — *"Use the raphael-debugger
agent on this stack trace"* — or let Claude Code auto-delegate when your request
matches an agent's description. `/agents` (in Claude Code) lists them.

**What to hand each agent** (the better the input, the better the output):

| Agent | Job | Give it |
|---|---|---|
| `raphael-planner` ★ | turns a vague idea into a finalized, buildable spec | the raw idea + constraints (time, stack, budget, must/must-not) |
| `raphael-architect` ★ | designs a production-grade architecture from a spec | the finalized spec; stack preferences; expected scale |
| `raphael-developer` | implements in small verifiable diffs, lessons in hand | the plan or task + the files/dirs in scope |
| `raphael-reviewer` ★ | reviews a diff like a senior engineer new to the codebase | the diff: branch, commit range, or "my uncommitted changes" |
| `raphael-security` | audits for secrets, injection, authn/authz mistakes | repo path + one line on what the app does |
| `raphael-debugger` ★ | root-cause finder, production-incident style | the exact error text + reproduction steps/environment |
| `raphael-design` | UI/UX consistency against your recorded design decisions | the screens/components in question |
| `raphael-deployer` | pre-ship checks: migrations, env vars, rollback plan | the target platform — it prepares everything and **stops before deploying** |
| `raphael-critique` | adversarial pass over another agent's output | that output verbatim (it reads only the output + cited evidence) |
| `raphael-manager` | routes multi-step work to the right specialists | just the goal |

★ flagship — deepest polish, covered by eval scenarios first. From-scratch build
order: planner → architect → developer (+ design) → reviewer + security →
deployer, with critique over anything you want double-checked.

**4 recipes** (short playbooks in `plugin/recipes/` the agents follow when you ask
— *"follow the pre-deploy recipe"*): `debug`, `review`, `pre-deploy`, and
`security-audit`. Pre-deploy runs the security audit first, always.

---

## 11. Safety model (the part that makes the rest trustworthy)

1. **One door:** every lesson enters through `validateLesson()` — schema, no URLs,
   no executable fields, no tool-call-shaped text, declarative voice.
2. **Secrets scrubbed twice:** before any model sees mined text, and again on output.
3. **Lessons are data:** they advise; they cannot command. Canary probes in the eval
   harness re-prove this continuously.
4. **Security lessons are mode-gated.** In manual (curator) mode they never
   activate without you — enforced in code (`E-AUTOSEC`). In autopilot they
   activate only through the machine curator: a stricter reviewer screen, then
   the canary gate, with whole-batch rollback on failure. **Quarantined**
   (injection-suspect) content never machine-activates in ANY mode — it expires
   silently after 30 days.
5. **Network:** exactly four things — model calls (subscription CLI or API),
   user-initiated read-only adopt fetches, the weekly global-brain down-sync
   (two pinned HTTPS URLs, hash-verified, every lesson still through the
   chokepoint, local lessons always win), and the daily self-update check (the
   npm registry document for this package; then `npm install -g
   raphael-brain@latest` — the same command you installed with — only when a
   newer version exists, never a downgrade). Nothing else. The brain repo blocks
   pushes by default.
6. **Local by default:** everything mined stays on your machine unless you granted
   contribution at install — and even then, bundles are stripped, re-scrubbed,
   re-validated, staged locally, and only ever *sent* by your own action
   (`raph contribute`).

Sandbox anything: `RAPHAEL_HOME=<scratch dir> raph <cmd>` runs against a throwaway
brain, never your real one.
