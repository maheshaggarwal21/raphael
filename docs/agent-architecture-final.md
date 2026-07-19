# Raphael agent architecture — FINAL

Owner directive (2026-07-20): the *complete* agent set should be flagship, each agent
genuinely specialized in its craft, drawing on the Claude skills and the gstack findings
already studied. Then **finalize the architecture, and for every decision go with the
recommendation that is best and most convenient for users.**

This is that finalized design. Unlike the earlier docs (which left decisions open awaiting
the owner), **every decision here is made.** It supersedes the agent-roster proposals in
docs/agent-roster-v2-plan.md (Phase 19) and the agent half of docs/frontend-design-flagship-
plan.md (Phase 20), folding both into one coherent, decided roster. Grounded in:
docs/gstack-agents-audit.md, docs/frontend-design-skills-audit.md, and the current code
(`src/lib/agents.js`, read in full).

Nothing is built yet — this is the finalized *design*, ready to build. The build order is
§7. But there are no more open options: this is the roster Raphael ships.

> **BUILD UPDATE 2026-07-20:** the owner requested a **Red Team** agent (an authorized,
> attacker's-eye penetration tester) plus reliable auto-invocation, and both are now
> **BUILT** ahead of the rest of the roster (src/lib/agents.js + regenerated plugin
> files + a `pentest` recipe + tests). This makes the finalized roster **12 agents** (the
> 11 below + `redteam`). Every agent now carries a `whenToUse` trigger rendered into its
> plugin `description` with a "use proactively when…" nudge — what Claude Code matches
> against to auto-delegate.
>
> **BUILD COMPLETE 2026-07-20 (A1–A8):** on the owner's "build according to plan, stop
> after dev + testing," the whole A1–A8 order below is now **SHIPPED** (441 tests green,
> `raph doctor` healthy):
> - **A1/A3** — flagship tier retired (→ EVAL_COVERAGE roadmap); 6th spine rule; every
>   mission specialized to its §4 methodology (calibration, Iron Law, Error & Rescue Map,
>   etc.). **A2** — `raphael-frontend` builder added (roster → 12; debugger given edit
>   tools too); `plan` + `frontend-build` recipes. **A4/A5** — `design` lesson category +
>   14-lesson curated design pack seeded to the global brain (now 40 lessons); taste-decay
>   resolved (curated tier already resists age-decay). **A6** — three checkable design-
>   floor eval scenarios (tokens/focus/reduced-motion). **A7** — `raph guard scan --skills`
>   (skill supply-chain) + `--design` (hardcoded-hex lint). **A8** — cross-model outside
>   voice for critique on security-audit + pre-deploy, **safe form** (recipe/mission text,
>   host-agent behavior, no new Raphael network surface).
> - **Deferred for owner sign-off (only remaining piece):** A8's *deeper* form — Raphael's
>   own `provider.js` shelling out to a second vendor (which would add a new outbound
>   network path and require an explicit **invariant #5e** amendment). Amending a "NEVER
>   violate" security invariant + adding network egress to a different vendor is an
>   owner-level decision, not an autonomous one. **A9** (per-agent outcome mining) stays a
>   separate later track by design, as §7 says. Everything else is done.

---

## 1. The central decision: retire the two-tier "flagship" flag

**Today:** `src/lib/agents.js` marks 4 of 10 agents `flagship: true` (planner, architect,
reviewer, debugger), defined as "deepest polish, covered by eval scenarios." The other 6
are implicitly second-class.

**The owner's ask ("the complete set should be flagship") exposes the real problem:** a
two-tier badge is the wrong model. If everything is flagship, the badge means nothing; if
only some are, the rest read as afterthoughts — and a user reasonably asks "why is the
security agent not flagship?" There's no good answer.

**DECISION (my recommendation, chosen): retire the binary `flagship` flag entirely.**
Replace it with a single, uniform quality bar that *every* agent meets, expressed as three
concrete per-agent properties instead of a badge:

1. **A named methodology** — each agent follows a real, specific working method (§4), not a
   vague "do good work" mission. This is what "specialized" actually means.
2. **Calibrated output** — every finding/recommendation carries a confidence signal and,
   where it's a finding, is gated by "quote the evidence or suppress it" (from gstack's
   review gate). No agent emits unqualified claims.
3. **Eval coverage on a roadmap** — eval scenarios expand to cover the whole roster over
   time (§6), rather than being a permanent badge for four.

For users this is simpler and stronger: **"every Raphael agent is a specialist with a real
methodology"** beats "4 of 11 are flagship." The word "flagship" survives only as
*marketing language for the whole roster*, never as a per-agent flag in the schema.

**Model tiers are unaffected** — retiring the quality badge does not mean everything runs
on the same model. Cost discipline stays: the router runs cheap, deep-reasoning specialists
escalate (§3). "Flagship-quality" is about methodology and calibration, not model spend.

---

## 2. The final roster: 11 agents (was 10; +1 frontend builder)

One addition to the current 10: a dedicated **frontend builder**, because the audit
confirmed the single biggest gap — `raphael-design` can only *review* (tools Read/Grep/
Glob) and the generic `developer` builds with no design judgment, so nothing actually
*builds* distinctive UI (docs/frontend-design-skills-audit.md §4). Decision: keep
`developer` as the general/backend implementer and add `raphael-frontend` as the
specialized UI builder — a clean split matching how the review/build separation already
works, rather than overloading `developer` or splitting it.

| # | Agent | Specialty (one line) | Model | Can edit? |
|---|---|---|---|---|
| 1 | **manager** | routes a request to the right specialists and merges their output | haiku | no |
| 2 | **planner** | turns a fuzzy idea into a sharp, buildable spec | sonnet | no |
| 3 | **architect** | designs a production-grade, minimal-but-scalable architecture | sonnet | no |
| 4 | **developer** | implements general/backend code in small verified diffs | inherit | **yes** |
| 5 | **frontend** ✦NEW | builds distinctive, non-generic UI (knowledge + judgment) | sonnet | **yes** |
| 6 | **reviewer** | reviews a diff like a sharp senior engineer, calibrated | sonnet | no |
| 7 | **security** | audits for the mistakes that actually get people breached | sonnet | no |
| 8 | **debugger** | finds root cause before touching code | sonnet | **yes** |
| 9 | **design** | critiques UI/UX with real taste + the accessibility floor | sonnet | no |
| 10 | **deployer** | pre-ship checklist; produces the plan, never ships | sonnet | no |
| 11 | **critique** | adversarial pass over any agent's output before you see it | sonnet | no |

"Can edit?" is deliberate: only the three agents that *produce* code (developer, frontend,
debugger) get Edit/Write/Bash. Every reviewer/critic/planner stays read-only so it can't
accidentally mutate the codebase — a real safety property, not an oversight.

---

## 3. Model policy (decided, cost-disciplined)

Unchanged in spirit from `policy.js`'s existing routing, stated explicitly for the final
roster: **manager on haiku** (routing is cheap and high-volume); **everything else on
sonnet as the first pass, with opus reserved for escalation only** (never first-pass — the
existing `policy.js` rule, kept). `developer` stays `inherit` (matches the session's model
so it fits whatever the human is already paying for). The cheap→strong spine rule (sweep
broadly cheap, escalate only survivors) means even the sonnet agents spend most of their
tokens at the cheap tier. This keeps the whole roster inside the "always net-lower than
no-Raphael" constraint by construction.

---

## 4. Each agent's finalized specialization (the methodology that makes it a specialist)

Every mission below is grounded in a specific, studied source. This is the content that
replaces today's thinner missions in `src/lib/agents.js`. The shared SPINE (brain-first,
free-checks-first, map-not-repo, cheap→strong, write-back) still prefixes all of them, plus
**one new sixth spine rule** applied to all: *one decision, one question — state your
recommendation and why, give real pros/cons, ask about exactly one thing at a time, never
batch* (gstack's AskUserQuestion discipline, docs/gstack-agents-audit.md §2).

1. **manager** — Routing + merge. Decides which specialists a request needs, runs them in
   pipeline order (planner → architect → developer/frontend → reviewer/security/debugger →
   deployer → critique), passes each only the slice it needs, merges into one answer,
   sends conflicts to critique. *Source: gstack's router shape.*

2. **planner** — Iterative-inquiry spec. One sharp question at a time (users, core job,
   success criteria, explicit non-goals, constraints) until the spec is unambiguous;
   brain-first on past scope mistakes. Produces a spec, never code. Must emit an explicit
   **"NOT in scope"** section. *Source: gstack plan-ceo-review's scope discipline +
   mandatory NOT-in-scope output.*

3. **architect** — ADR-style design with failure-mapping. From the spec, design the
   minimal-but-scalable architecture; for every new codepath, name one realistic
   production failure and whether the design handles it (gstack's **Error & Rescue Map**);
   emit **"NOT in scope"** and **"what already exists"** sections (does the design reuse or
   needlessly rebuild). *Source: gstack plan-eng-review §3.2 of the audit.*

4. **developer** — Small verified diffs. Implement against the architect's plan in small
   diffs, each verified by the project's own checks before "done"; honor the brain's
   stack lessons to avoid the write→fail→rewrite loop; **any regression test must be shown
   failing without the fix and passing with it.** *Source: gstack investigate's regression
   discipline + the owner's testing standard (CLAUDE.md).*

5. **frontend** ✦NEW — Two-layer distinctive build. (a) *Knowledge:* brain-first on the
   design pack (§5) + the project's recorded design decisions (§5). (b) *Judgment:* ground
   the design in the subject, establish a compact token system (4-6 named hex, 2+ type
   roles, one signature element), **critique the plan against the generic default before
   writing code** (the named AI-slop clusters), spend boldness in one place, hit the
   quality floor (responsive, keyboard focus, reduced motion) without announcing it, treat
   copy as design material. *Source: Anthropic frontend-design + ui-ux-pro-max, audit §3.*

6. **reviewer** — Calibrated senior review. Free checks first (linter, secret scan, git
   diff, type-check), cheap-model sweep, escalate top findings; **every finding carries a
   confidence 1-10 with a display band** (9-10 shown, 5-6 caveated, 3-4 appendix-only) and
   **must quote the exact motivating line or be suppressed**; anchor to the brain's past
   failures. Reports problems, never rewrites behavior. *Source: gstack review + its
   specialists + the pre-emit verification gate, audit §3.1.*

7. **security** — Breach-first audit. The things that actually get people breached:
   committed secrets, injection (SQL/command/**prompt** — an explicit LLM/AI-security check
   as its own category), broken authz, unvalidated "internal" input, PII in logs. Free
   scanners first; brain's security pack → a targeted checklist for THIS stack. **Never
   auto-apply a security change — always advisory to a human.** *Source: gstack cso's
   14-phase audit incl. its dedicated LLM/AI-security phase, audit §3.3.*

8. **debugger** — Root cause before code. **Iron Law: no fix without root-cause
   investigation first.** Reproduce, then isolate; brain's past root causes narrow the
   search before reading files; **3-strike rule** — after three failed hypotheses, STOP and
   surface the decision (new hypothesis / escalate / add logging) rather than guessing;
   the fix ships with a regression test shown failing-then-passing. *Source: gstack
   investigate's Iron Law + 3-strike rule, audit §5.*

9. **design** — Taste critic + accessibility floor. Critique UI/UX against the project's
   stored design decisions and the design pack; detect the named AI-slop tells; check the
   checkable floor (contrast, focus, reduced motion, touch targets, alt text) and the
   copy discipline (active-voice controls, consistent action labels, error/empty-state
   quality). Flags concrete fixes, not vibes. *Source: Anthropic frontend-design +
   design-critique/accessibility-review methodologies, audit §3.1.*

10. **deployer** — Checklist, never ship. Lead with a deterministic checklist from the
    brain's deploy lessons; cover CI/CD, env/secrets, migration safety (expand→migrate→
    contract), monitoring, rollback, downtime risk. **Produces the plan for a human to
    execute — never performs the deploy or spends money** (the deploy/spend/sign-in
    boundary). *Source: gstack ship's structure, bounded by Raphael's invariant.*

11. **critique** — Adversarial pass. Read ONLY another agent's output + its cited evidence;
    kill unsupported claims, sharpen real ones, default to skepticism, surface what was
    missed. *Source: gstack red-team + Outside Voice, audit §3.4.* Optionally backed by a
    genuine **cross-model** second opinion for the highest-stakes outputs (§6 below).

---

## 5. Cross-cutting decisions (all made)

- **The design knowledge pack + `design` category** (from Phase 20.1) is IN — it's what
  makes the frontend/design agents actual specialists rather than eloquent guessers.
  Decision: ship it as `src/lib/design-pack.js` through the chokepoint, seeded to the
  global brain, same proven pattern as the security pack.
- **Design decisions via the existing decision ledger** (Phase 20.4) is IN — the
  frontend/design agents record and read per-project design decisions (palette, type
  scale, signature) so output stays consistent across sessions. Zero new store — the
  `raph decide` ledger already does this.
- **The taste-convention decay question is DEFERRED to build time, not left ambiguous:**
  design and `preference` (18.2) lessons are taste-conventions, not recurring bugs, so
  the confidence/decay model needs a small adjustment. Decision: resolve it once, at the
  start of the first pack build, and apply the same policy to both categories. It does not
  block the roster design — it blocks *authoring the pack*, which is a later milestone.
- **Cross-model "outside voice"** (Phase 19.5) is IN but SCOPED: only `critique` (as an
  optional backing) and only for the two highest-stakes recipes (security-audit,
  pre-deploy), never auto-applied, and requiring its own explicit invariant #5e amendment
  before build (per architecture-audit-v2.md §2.3). Decision: keep it narrow; it's a
  differentiator for users on other AI ecosystems, not a default.
- **Per-agent outcome mining** (Phase 19.6) stays a SEPARATE later track, not part of the
  finalized roster — it's a measurement capability that needs its own design pass (the
  deferred-vs-wrong problem, architecture-audit-v2.md §2.4), and the roster is complete
  and shippable without it.
- **Recipes:** the final set is 6 — `plan` (planner→architect, NEW), `frontend-build`
  (NEW), `review`, `debug`, `pre-deploy`, `security-audit`. The two new ones round out the
  pipeline so every common workflow has a named playbook.

---

## 6. What "flagship-quality for the whole set" means concretely (the eval roadmap)

Retiring the badge (§1) creates an obligation: eval coverage must actually grow to the
whole roster, or "every agent is flagship-quality" is just a claim. Decision:

- **Today's eval scenarios** (S08 float-money, S20 IDOR, etc.) already exercise the
  review/security/developer path with pure file-inspecting checkers. Keep them.
- **Add checkable scenarios per agent family**, prioritizing the ones with objective
  proxies: security (the existing IDOR/secrets/headers family), reviewer (does it catch a
  planted bug with a quoted line), debugger (does it reproduce before fixing), frontend/
  design (the checkable design floor — tokens-not-raw-hex, contrast/focus/reduced-motion,
  named-slop tells — with the explicit boundary that taste beyond the floor stays
  human-judged, Phase 20.5).
- **Be honest about the un-checkable:** planner/architect/critique quality is genuinely
  hard to score with a deterministic checker. Decision: for those, the eval measures
  process compliance (did the planner emit a NOT-in-scope section; did the architect emit
  a failure map) rather than faking a quality score. Process-compliance is checkable;
  taste isn't, and the docs will say so plainly rather than overstate.

The flagship-quality claim ships to marketing/docs **only after** the eval roadmap's first
wave lands — not before (architecture-audit-v2.md §1.2's discipline: don't claim more
certainty than the evidence supports).

---

## 7. Finalized build order (Phase 19 + 20-agent, consolidated — ready to build)

This replaces Phase 19's and Phase 20's separate agent items with one sequence. Each
milestone ships with the owner's testing standard (success + failure + edge cases;
regression tests shown failing-then-passing).

| # | Milestone | Touches | Why here |
|---|---|---|---|
| A1 | Retire `flagship` flag → uniform specialization; add the 6th spine rule (one-decision-one-question); rewrite all 11 missions to their §4 methodology | `src/lib/agents.js` + `scripts/build-agents.mjs` + schema/tests for the removed flag | Pure data/prose; the foundation everything else labels itself against; cheapest + highest-clarity |
| A2 | Add `raphael-frontend` builder agent (tools incl. Edit/Write/Bash) + the `plan` and `frontend-build` recipes | `src/lib/agents.js` | The one real roster addition; depends on A1's mission conventions |
| A3 | Confidence-banding + quote-the-line gate in reviewer/security/debugger output | `src/lib/agents.js` (mission/output text) | Calibration is a §1 pillar; prose over already-tested rendering |
| A4 | `design` lesson category + curated design pack + global-brain seed (resolve the taste-decay policy first) | `src/schemas/lesson.schema.json`, `src/lib/design-pack.js`, `src/commands/pack.js`, `global-brain/` | The knowledge layer that makes design/frontend agents real specialists |
| A5 | Point the decision ledger at design (record/read design decisions) | `src/lib/agents.js` mission text, optional filtered view in `src/commands/decide.js` | Near-zero code; consistency across sessions |
| A6 | Eval scenarios: the checkable floor per agent family + process-compliance for the un-checkable | `src/eval/scenarios.js`, `src/eval/harness.js` | Gates the "flagship-quality whole roster" claim honestly |
| A7 | `raph guard scan --skills` (skill supply-chain) + `--design` (hardcoded-hex/token) | `src/lib/guard.js` | Deterministic upkeep; reuses guard's pattern-scan; least essential, last |
| A8 | Cross-model outside voice for critique on security-audit + pre-deploy (write invariant #5e first) | `src/lib/provider.js`, `src/lib/agents.js` recipes | Narrow differentiator; needs the invariant amendment before build |

A9 (per-agent outcome mining, Phase 19.6) is intentionally **not** in this sequence — it's
the separate measurement track that needs its own design pass and doesn't gate the roster.

---

## 8. What is now DECIDED (so nothing is left open)

1. Two-tier flagship flag → **retired**; whole roster held to one specialization bar. (§1)
2. Roster → **11 agents**, +1 frontend builder, developer kept as general/backend. (§2)
3. Only developer/frontend/debugger can edit; the rest are read-only. (§2)
4. Model tiers → manager haiku, rest sonnet-first, opus escalation-only. (§3)
5. Every mission → a **named methodology** from a studied source. (§4)
6. 6th spine rule (one-decision-one-question) → **added to all**. (§4)
7. Design pack + `design` category + ledger-for-design → **IN**. (§5)
8. Cross-model outside voice → **IN but narrow** (critique, 2 recipes, never auto-apply). (§5)
9. Per-agent outcome mining → **separate later track**, not part of the roster. (§5)
10. Recipes → **6** (add `plan`, `frontend-build`). (§5)
11. "Flagship-quality" claim → shipped **only after** the eval roadmap's first wave. (§6)
12. Taste-convention decay policy → resolved once at pack-build start, applied to design +
    preference together. (§5)

The design is final. The build order (§7) is ready to execute on the owner's word — the
one genuine pre-build task inside it is the taste-decay policy decision (A4) and the
invariant #5e amendment (A8), both flagged, neither blocking the roster's shape.
