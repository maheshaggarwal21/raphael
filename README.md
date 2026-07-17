# Raphael

**A learning layer ("brain") for AI coding agents.** Raphael distills lessons from
your real projects — the mistakes, the fixes, the decisions — and injects the
relevant ones back into your agent's context at the right moment, so known mistakes
stop recurring.

Your coding agent forgets everything between sessions. You don't have to.

- **It learns from *your* work** — mining your real session history, not generic tips.
- **You approve every lesson** — nothing enters the brain without passing one
  validation chokepoint, and nothing activates without review (security lessons
  *always* need a human, by code, not convention).
- **Recall is budgeted and visible** — ≤ ~1,200 tokens/session, `raph why` shows
  every injection, `raph off` stops it.
- **Local by default** — the brain lives in `~/.raphael`, in its own git repo that
  blocks pushes; sharing is per-lesson opt-in.
- **Proof, not vibes** — `raph eval` measures the same tasks with the brain ON vs
  OFF; `raph atlas bench` measured **147.9× fewer tokens** answering "where do I
  look?" with the deterministic project graph vs grep-and-read.

**[The full manual — every command, how and when to use it → docs/manual.md](docs/manual.md)**
· [ARCHITECTURE.md](ARCHITECTURE.md) for the complete design.

## Install

```
# 1. the raph CLI (the engine — the plugin's hooks call it)
npm install -g raphael-brain        # or, from GitHub: npm install -g maheshaggarwal21/raphael

# 2. the Claude Code plugin (auto-wires recall + adds the /brain commands)
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael

# 3. one-command setup
raph arise --pack --guard
```

`arise` creates the brain, seeds 26 reviewed security lessons (as candidates — you
approve them), installs a pre-commit secret guard, and prints your first five
minutes. Run `raph doctor` any time to check health.

## The loop

```
 your real sessions ──▶ raph mine ──▶ raph distill ──▶ raph queue/approve ──▶ ACTIVE
                        (episodes,     (model + 4       (YOU are the gate)      │
                         scrubbed)      gates)                                  ▼
 your next session ◀────────────────────────────────────────────── auto-injection
                     budgeted, enveloped as data, fail-open, raph why explains it
```

Distillation uses your **Claude Code subscription** by default (fixed price, no API
key, model contained with zero tools). Add lessons by hand with `raph note`, or seed
curated packs with `raph pack add security`.

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
   declarative voice. No exceptions, including imports and curated packs.
2. Secrets scrubbed before any model sees mined text, and again on output.
3. Lessons are advisory data; they cannot command an agent. Containment canaries in
   the eval harness re-prove it (`raph eval run --dry-run` — free).
4. Security-category lessons never activate machine-only.
5. Network access: model calls + user-initiated read-only adopt fetches. Nothing else.
6. Everything mined stays local; sharing is opt-in per lesson.

## Development

```
npm install
npm test                  # 358 tests, node:test, no frameworks
node bin/raph.js help     # the full CLI surface (40 verbs)
```

Point `RAPHAEL_HOME` at a scratch directory to sandbox any command. CI runs the test
suite plus the canary gate on Linux + Windows, Node 18/20/22.

## License

[MIT](LICENSE)
