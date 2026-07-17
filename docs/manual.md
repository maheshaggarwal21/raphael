# The Raphael Manual — every command, how and when to use it

Raphael is a **learning layer ("brain") for AI coding agents**. It watches your real
work, distills the mistakes and fixes into short *lessons*, lets **you** approve each
one, and then whispers the relevant ones back to your coding agent at exactly the
right moment. The result: your agent stops repeating mistakes you already paid for.

This manual explains every command: what it does, **when** to reach for it, and how
to run it. Plain language throughout. Jargon is explained the first time it appears.

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

## 1. Getting started

### `raph arise` — the one-command first run
**When:** you just installed Raphael and want everything set up in one go.
**What:** creates the brain, optionally seeds the security lesson pack and installs the
commit guard, then prints the plugin wiring steps and your first five minutes.
```
raph arise --pack --guard     # brain + 26 security lessons to review + commit guard
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

---

## 2. The learning loop (how lessons get made)

The loop is: **mine → distill → review → active**. You are the gate in the middle.

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

### `raph auto` — the auto-approve dial
**When:** you trust the pipeline enough to skip some clicking.
```
raph auto off        # everything waits for you (default)
raph auto standard   # your OWN mined lessons may activate into a restricted tier
raph auto wide       # + adopted material too (capped per day)
```
Security lessons **always** wait for a human, at every dial setting. That floor is
enforced in code (`E-AUTOSEC`), not by convention.

### `raph contribute` — share a lesson, on purpose
**When:** a lesson is good enough to give to a teammate or the community.
```
raph contribute list
raph contribute webhook-idempotency --out ./to-share
```
Per-lesson opt-in only (there is deliberately no `--all`). The export strips project
names, path globs, and local evidence references, re-scrubs the full text for
secrets, and re-validates through the chokepoint. If the result can't pass the same
gate that guards your own brain, the export is refused.

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
**When:** every repo you own. Install once, forget it.
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

Installed with two lines:
```
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael
```

**Hooks (automatic):** SessionStart + UserPromptSubmit run `raph inject` — recall
with the budgets and envelopes described in §3. A PreToolUse nudge fires once per
session when you grep/search a project that has an atlas built: "the graph already
knows — try `raph atlas where`."

**Slash commands:**
- `/brain` — the hub: onboarding on first run, status + next best action after.
- `/brain-learn` — mine + distill the current project in one flow.
- `/brain-review` — the queue with a batch grammar (`1y 2n 3e` = yes/no/edit).
- `/brain-eval` — the ON/OFF proof, guided.

**The `brain-recall` skill:** lets the agent *pull* lessons mid-task when stuck,
before risky changes (deploys, migrations, auth, payments) — complementing the
automatic *push* of the hooks.

**10 agents** (Planner, Architect, Developer, Reviewer, Debugger, Security, Critique,
Design, Deployer, Manager) — each wired to consult the brain before acting, with
4 recipes (debug, review, pre-deploy, security-audit) that chain them. The
pre-deploy recipe runs the security audit first, always.

---

## 11. Safety model (the part that makes the rest trustworthy)

1. **One door:** every lesson enters through `validateLesson()` — schema, no URLs,
   no executable fields, no tool-call-shaped text, declarative voice.
2. **Secrets scrubbed twice:** before any model sees mined text, and again on output.
3. **Lessons are data:** they advise; they cannot command. Canary probes in the eval
   harness re-prove this continuously.
4. **Security lessons never activate machine-only.** Enforced in code.
5. **Network:** model calls (subscription CLI or API) and user-initiated, read-only
   adopt fetches. Nothing else. The brain repo blocks pushes by default.
6. **Local by default:** everything mined stays on your machine; sharing is
   per-lesson opt-in (`raph contribute`).

Sandbox anything: `RAPHAEL_HOME=<scratch dir> raph <cmd>` runs against a throwaway
brain, never your real one.
