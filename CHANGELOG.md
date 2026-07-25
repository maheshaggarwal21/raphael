# Changelog

## 0.3.0 — 2026-07-20

The agent release. The roster grew, every agent became a real specialist, frontend design
became a first-class subsystem, and duplicate lessons can no longer reach the brain.

### Agents — 10 → 12, and every one of them rebuilt

- **New: `raphael-redteam`** — an authorized, attacker's-eye penetration tester. It probes a
  system you own or are explicitly authorized to test and proves what is actually
  exploitable (auth bypass, IDOR, injection, SSRF, business-logic abuse) with a minimal
  proof of concept. Authorization is confirmed first, always. It never mass-scans, never
  runs denial-of-service, never plants persistence, never exfiltrates real data, and has no
  edit tools — it reports, it does not weaponize. Ships with a `pentest` recipe.
- **New: `raphael-frontend`** — a builder that can actually build UI, which the roster
  previously lacked (the design agent could only review). Two-layer mission: pull the design
  knowledge from the brain first, then apply judgment — ground the design in the subject,
  establish a token system and one signature element, critique the plan against the generic
  "AI slop" defaults *before* coding, and meet the accessibility floor.
- **Agents now invoke themselves.** Every agent carries a `whenToUse` trigger rendered into
  its plugin description, so Claude Code delegates to the right specialist automatically —
  the debugger on an error, the reviewer before a merge — with no need to name it.
- **The two-tier "flagship" flag is retired.** A badge on everything is meaningless; on a
  subset it makes the rest look second-class. Every agent is now held to one bar: a named
  methodology, calibrated output, and a growing eval-coverage roadmap.
- **Every mission specialized to a real methodology** — the planner emits a mandatory
  "NOT in scope" section, the architect an Error & Rescue Map, the debugger works under an
  Iron Law plus a three-strike rule, the reviewer bands its confidence and must quote the
  line that motivates a finding or suppress it, and the security agent treats LLM/AI
  security as its own category.
- **New spine rule:** one decision, one question — no batching unrelated decisions.
- Recipes 4 → 7: added `plan`, `frontend-build`, and `pentest`.

### Frontend design as a first-class subsystem

- **New `design` lesson category** and a curated **14-lesson design pack**
  (`raph pack add design`), seeded into the global brain so a fresh install starts
  design-literate. Covers the named AI-slop tells, the accessibility floor (contrast,
  visible focus, reduced motion, touch targets), token discipline, and copy as design
  material.
- **Three new eval scenarios** for the checkable design floor. Deliberate boundary: these
  measure what a deterministic checker *can* judge; taste beyond that stays human-judged.

### Guard

- **`raph guard scan --skills`** — scans installed skills for the supply-chain threat class:
  prompt injection, credential access, and network exfiltration. Advisory by design; hard
  blocks only on prompt injection, the unambiguous tell.
- **`raph guard scan --design`** — flags hardcoded hex colors where a design token belongs.

### The brain

- **Near-duplicate lessons are now held at activation.** Previously only an identical *slug*
  was caught, so the same rule re-worded under a different slug could reach the active brain
  — and the unattended autopilot path had no duplicate check at all. Both paths now compare
  a candidate against the active brain and hold anything that looks like a restatement, with
  `raph approve --dup-ok` to override once you've read both. Held candidates stay in the
  queue for a decision; nothing is silently dropped.
- The gate is a recall-tuned shortlist for human judgment, not a classifier — a deliberate
  choice, documented in the code, based on measuring real lesson pairs.

### Notes

- No new dependencies. No new network surface. All six security invariants unchanged.
- Raphael's own code remains single-vendor by explicit decision: it will not call a second
  AI vendor directly.
- 452 tests green.

## 0.2.x

Earlier releases are recorded in the GitHub release notes.
