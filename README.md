# Raphael

A learning layer ("brain") for AI coding agents. Raphael distills lessons from your
real projects — the mistakes, the fixes, the decisions — and injects the relevant ones
back into your agent's context at the right moment, so known mistakes stop recurring.

**Status: early development.** See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Install (as a Claude Code plugin)

Two steps: install the CLI, then add the plugin.

```
# 1. the raph CLI (the engine — the plugin's hooks call it)
npm install -g raphael-brain

# 2. the Claude Code plugin (auto-wires recall + adds the /brain commands)
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael
```

Then run **`/brain`** — it walks you through the first five minutes (init, seed a lesson
pack or mine your own history, review, and turn injection on). The plugin ships:

- **Auto-injection hooks** — matching lesson headlines are added at session start and on
  relevant prompts (budgeted ≤1,200 tokens/session; `raph why` shows every one; `raph off` stops it).
- **Slash commands** — `/brain` (hub + setup), `/brain-learn` (mine + distill), `/brain-review`
  (approve/reject the queue), `/brain-eval` (prove it helps).
- **A recall skill** (`brain-recall`) and **10 agents** (Planner, Architect, Reviewer, Debugger, …)
  that pull from the brain before acting.

Run `raph doctor` any time to check the CLI, brain, and plugin wiring.

## Development

```
npm install
npm test
node bin/raph.js help
```

Point `RAPHAEL_HOME` at a scratch directory to sandbox any command.
