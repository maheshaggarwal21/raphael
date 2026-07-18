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
  blocks pushes. Contribution to the global brain is a separate, optional grant —
  scrubbed bundles, staged locally, sent only by your own action.
- **Proof, not vibes** — `raph eval` measures the same tasks with the brain ON vs
  OFF; `raph atlas bench` measured **147.9× fewer tokens** answering "where do I
  look?" with the deterministic project graph vs grep-and-read.
- **Prefer control?** `raph auto manual` keeps the classic curator mode: you review
  every lesson, security always waits for you.

**[The full manual — every command, how and when to use it → docs/manual.md](docs/manual.md)**
· [ARCHITECTURE.md](ARCHITECTURE.md) for the complete design.

## Install (and forget)

```
# 1. the raph CLI (the engine — the plugin's hooks call it)
npm install -g raphael-brain        # or, from GitHub: npm install -g maheshaggarwal21/raphael

# 2. the Claude Code plugin (auto-wires recall + adds the /brain commands)
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael
```

That's the whole install. **Your next Claude Code session asks you three questions
once** (may Raphael learn from your work · contribute scrubbed lessons to the
community · autopilot or manual) and runs the setup itself. Prefer the terminal?

```
raph arise --autopilot            # zero-touch: consent + seed + autopilot in one command
raph arise --pack --guard         # or the manual (curator) setup — you review everything
```

`arise --autopilot` seeds your brain with the global brain's curated lessons
(active immediately — cold-start solved) and turns on the background loop. Run
`raph doctor` any time to check health; `raph pulse` shows the last heartbeat.

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
npm test                  # 400+ tests, node:test, no frameworks
node bin/raph.js help     # the full CLI surface (41 verbs)
```

Point `RAPHAEL_HOME` at a scratch directory to sandbox any command. CI runs the test
suite plus the canary gate on Linux + Windows, Node 18/20/22.

## License

[MIT](LICENSE)
