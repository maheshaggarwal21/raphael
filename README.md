# Raphael

A learning layer ("brain") for AI coding agents. Raphael distills lessons from your
real projects — the mistakes, the fixes, the decisions — and injects the relevant ones
back into your agent's context at the right moment, so known mistakes stop recurring.

**Status: early development.** See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Install (as a Claude Code plugin)

Two steps: install the CLI, then add the plugin.

```
# 1. the raph CLI (the engine — the plugin's hooks call it), from GitHub
npm install -g maheshaggarwal21/raphael

# 2. the Claude Code plugin (auto-wires recall + adds the /brain commands)
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael
```

(A published `raphael-brain` on the npm registry is a later convenience — the GitHub install
above works today and gives you the same `raph` CLI.)

Then run **`/brain`** — it walks you through the first five minutes (init, seed a lesson
pack or mine your own history, review, and turn injection on). The plugin ships:

- **Auto-injection hooks** — matching lesson headlines are added at session start and on
  relevant prompts (budgeted ≤1,200 tokens/session; `raph why` shows every one; `raph off` stops it).
- **Slash commands** — `/brain` (hub + setup), `/brain-learn` (mine + distill), `/brain-review`
  (approve/reject the queue), `/brain-eval` (prove it helps).
- **A recall skill** (`brain-recall`) and **10 agents** (Planner, Architect, Reviewer, Debugger, …)
  that pull from the brain before acting.

Run `raph doctor` any time to check the CLI, brain, and plugin wiring.

## Secret guard (for your own repos)

`raph guard` installs a pre-commit hook that blocks a commit if it would leak a secret —
API keys, tokens, private keys, `key=secret` assignments — using the same patterns as the
brain's safety chokepoint.

```
raph guard install          # in any git repo (or: raph init --guard)
raph guard scan --all       # audit every tracked file now
raph guard uninstall
```

High-precision by default; add `--entropy` for the noisier high-entropy pass. It scans the
staged content, never touches history, and fails open (a broken scan can't wedge a commit).
Bypass a single commit with `git commit --no-verify`.

## Adopt (drop a link, keep the knowledge)

Found a good repo, article, or skill file? `raph adopt` digests it into reviewable
knowledge instead of a browser tab you'll never reopen:

```
raph adopt https://example.com/great-post     # or a local file / repo dir / SKILL.md
raph adopt <src> --dry-run                    # read + license check, zero model calls
raph adopt list                               # the provenance ledger
raph adopt revoke <id>                        # one-command undo of everything it produced
```

Every adoption runs a six-layer gauntlet: bounded read-only fetch (https GET, size/time
capped, never executed) → secret scrub before any model sees it → a contained reviewer
agent that blocks prompt injection and malicious guidance → extraction → the same
validation chokepoint as everything else → your review queue. Lessons land as candidates
(nothing activates without approval); reusable procedures land as skill *drafts* under
`staged/skills/`, never auto-installed. Sources, licenses, and verdicts are recorded in
`state/adoptions.jsonl` — `revoke` walks that record and undoes it all.

## The console (`raph web`)

Everything above, in the browser — for the days the CLI feels like friction:

```
raph web            # prints a one-time URL and opens it
```

Eight tabs: **Dashboard** (status + self-use stats) · **Review queue** (batch
approve/reject; security and quarantined items render in full and unlock a one-item
"Approve --confirmed" only after an explicit "I read it" check) · **Lessons** (browse
or search with the exact scorer the hooks use, toggle injection, see what got
injected and why) · **Adopt** (paste a URL or path, dry-run or run the gauntlet,
revoke any adoption in one click) · **Activity** (the audit log) · **Company**
(the project portfolio and the weekly board report — `raph portfolio` and
`raph report weekly` in the browser) · **Guard** (scan the launch repo for secrets,
install the pre-commit hook) · **Settings** (the auto-approve dial and the
per-project mining consent registry).

The console holds zero business logic — every button calls the same functions as
the CLI verb it mirrors, so nothing is possible in the browser that isn't possible
(and tested) at the command line. Security model: binds `127.0.0.1` only, a fresh
token every launch, and every request must pass Host + Origin checks (a hostile
website cannot reach it even with the token) under a strict inline-only CSP.
Everything rendered is treated as untrusted text and escaped; adoption verdicts
re-pass the secret scrubber before display.

## Development

```
npm install
npm test
node bin/raph.js help
```

Point `RAPHAEL_HOME` at a scratch directory to sandbox any command.
