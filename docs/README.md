# 📚 The Raphael documentation map

Everything written about Raphael, organized by what you're trying to do.
If you only read one thing, read **[the manual](manual.md)**. If you read two,
add **[ARCHITECTURE.md](../ARCHITECTURE.md)**.

## Start here

| Doc | What it gives you | Read it when… |
|---|---|---|
| [**README**](../README.md) | The full tour — every feature, the command atlas, the security model | you're deciding whether to install |
| [**The Manual**](manual.md) | Every command: how, when, and why to use it, in workflow order | you've installed and want to drive |
| [**ARCHITECTURE.md**](../ARCHITECTURE.md) | The complete design: invariants, threat model, data shapes, every subsystem | you want to know *why* it's built this way — or you're auditing it |

## Using Raphael

| Doc | What it covers |
|---|---|
| [manual.md](manual.md) | The reference: autopilot (§0), getting started, the learning loop, recall, knowledge from outside, project intelligence, proof & self-measurement, guard rails |
| [hooks.md](hooks.md) | Wiring the injection hooks — the plugin does this automatically; this is the manual fallback for custom setups |
| [model-provider.md](model-provider.md) | How distillation picks its model: Claude Code subscription first (fixed price, no API key), metered API key only as fallback — and how to force either |
| [prompt-library.md](prompt-library.md) | A curated set of senior-engineer role prompts, kept as a reference corpus for adopt/distill experiments |

## Design records — how the big features came to be

These are the honest working documents behind the major subsystems: the vision, the
alternatives weighed, and what actually shipped. They read like engineering
notebooks, because they are.

| Doc | The story of… |
|---|---|
| [autopilot-vision.md](autopilot-vision.md) | Zero-touch Raphael: the eight-milestone plan that turned a manual curator into a self-running loop — **status: BUILT** (v0.2.0) |
| [web-console-vision.md](web-console-vision.md) | The `raph web` console and adopt-pipeline v2 brainstorm, reality-checked against the security invariants before a line was written |
| [atlas-upgrade-plan.md](atlas-upgrade-plan.md) | The project knowledge graph: the "awareness problem," the research sweep behind it, and the no-inflated-claims rule (own bench numbers only) |
| [company-vision.md](company-vision.md) | Raphael as a company: the Academy, the portfolio, the weekly board report — the owner's expanded vision, organized |
| [audit-2026-07-18.md](audit-2026-07-18.md) | The end-to-end foreign-user audit: the exact npm tarball, a clean machine profile, and the full stranger's journey, verified |

## The Academy

| Doc | What it covers |
|---|---|
| [academy/backlog.md](academy/backlog.md) | The build backlog: the product ideas, expanded, with an honest read on build order — including the ones that were rejected and why |
| [academy/onedesk-plan.md](academy/onedesk-plan.md) | The full build plan for One Desk (the money engine) — a worked example of how the Academy plans a product |

## The owner's shelf

| Doc | What it covers |
|---|---|
| [owner/raphael-handbook.md](owner/raphael-handbook.md) | The handbook: the pitch, the features, the user journey, interview prep, and launch marketing — in one place |

## Reading paths

- **"I want to use it, now."** → [README § Install](../README.md#-install-and-forget) →
  run `raph arise --autopilot` → skim [manual.md §0](manual.md) so you know what the
  autopilot does on your behalf.
- **"I review tools before I trust them."** → [README § Security model](../README.md#-the-security-model--seven-load-bearing-walls) →
  [ARCHITECTURE.md](../ARCHITECTURE.md) (invariants + threat model) →
  [audit-2026-07-18.md](audit-2026-07-18.md) → then run the free proof yourself:
  `raph eval run --dry-run`.
- **"I want to extend it."** → [ARCHITECTURE.md](../ARCHITECTURE.md) →
  the design records above for the subsystem you're touching → `npm test` →
  `raph selfcheck` before you merge (yes, the tool gates changes to itself).
- **"I'm curious what an AI building products looks like."** →
  [company-vision.md](company-vision.md) → [academy/backlog.md](academy/backlog.md) →
  `raph portfolio` and `raph report weekly` on a live install.
