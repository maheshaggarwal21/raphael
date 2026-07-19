# Making frontend design/dev a Raphael flagship — the plan

Companion to [docs/frontend-design-skills-audit.md](frontend-design-skills-audit.md).
Owner directive (2026-07-20): frontend design/development is where AI lags most, so the
agents and skills concerned with it should be Raphael's flagship. This is the plan for
that — grounded in the two resources studied (ui-ux-pro-max + Anthropic's design skills)
and in Raphael's actual current code (`src/lib/agents.js` and the lesson schema, both read
before writing this). Nothing here is built; it's a proposal awaiting the owner's go, same
status as Phase 18/19.

The throughline from the audit: every gap is a mechanism Raphael **already has** and simply
hasn't pointed at design. So this is mostly *additive content + promotion*, not a new
subsystem — which is exactly why it's a realistic flagship bet rather than a rewrite.

---

## 1. The two-layer model this plan is built on

The audit's headline finding: strong frontend needs a **knowledge layer** (what a good spa
palette actually is — ui-ux-pro-max's deterministic rule DB) AND a **judgment layer** (how
to avoid producing the same templated page every time — Anthropic's `frontend-design`
system prompt). Raphael already owns the machinery for both:

- Knowledge layer → the **brain** (curated lessons, deterministic retrieval, the same bet
  ui-ux-pro-max makes with BM25-over-CSVs). Raphael just has no design *content* in it yet.
- Judgment layer → **agent missions** (the `SPINE` + per-agent mission prose). Raphael's
  `raphael-design` mission is currently thin and review-only.

The plan fills both, and promotes the result to flagship.

---

## 2. Promote + rebuild `raphael-design` into a flagship builder (not just a reviewer)

**The core problem, confirmed in `src/lib/agents.js`:** `raphael-design` today has tools
`Read, Grep, Glob` — it *cannot build or edit anything*, only review UI it's shown. And
the generic `developer` agent writes frontend with no design judgment. So no agent in the
roster actually *produces* distinctive frontend. That's the gap that makes "AI lags most at
frontend" true inside Raphael specifically.

**Proposal:**
- **Split the concern into two flagship agents** rather than overloading one:
  - **`raphael-design` (promote to flagship, keep review scope, sharpen the mission)** —
    stays `Read, Grep, Glob` (a reviewer shouldn't edit), but its mission gets rewritten
    with Anthropic `frontend-design`'s judgment language: the named AI-slop clusters to
    detect, "spend boldness in one place," the two-pass critique, copy-as-design-material,
    the quality floor (responsive, keyboard focus, reduced motion). It becomes the design
    *critic* with real taste, not a vague consistency-checker.
  - **`raphael-frontend` (NEW flagship builder)** — tools `Read, Grep, Glob, Edit, Write,
    Bash`, model sonnet. This is the agent Raphael is missing: it *builds* UI, brain-first,
    applying the design lessons (§3) and the project's recorded design decisions (§4)
    before writing a line, then self-critiques against the generic default (the two-pass
    process) before presenting. Its mission encodes the ui-ux-pro-max workflow shape
    (analyze requirements → establish a design system → build to it → validate tokens) and
    the Anthropic judgment layer (ground it in the subject, one signature element, restraint).
- **Flagship set goes 4 → 5** (planner, architect, reviewer, debugger, + the design pair —
  count as flagships per `flagship: true`, covered by eval scenarios per §6).

**Why two agents, not one mega-agent:** matches the existing roster's separation of
concerns (developer builds, reviewer critiques — they're deliberately distinct) and lets
the design critic stay tool-restricted (can't accidentally edit) while the builder gets
write access. It also mirrors ui-ux-pro-max's own split (its `design-system`/`ui-styling`
build skills vs. its rule-checking) and Anthropic's split (`web-artifacts-builder` builds,
`frontend-design` guides).

**Files touched:** `src/lib/agents.js` (mission rewrite for `design`, new `frontend`
roster entry, `flagship: true` on both), `scripts/build-agents.mjs` regenerates the
plugin agent files.

---

## 3. A `design` lesson category + a curated design pack (the knowledge layer)

**The big one.** Raphael got its security cold-start solved by a curated pack of 26
security lessons through the chokepoint (`raph pack add security`). Design needs the exact
same treatment, and ui-ux-pro-max's rule tables (§2.6 of the audit) are a ready-made
source: each row is already a declarative rule + rationale + anti-pattern, which is the
shape of a Raphael lesson.

**Proposal:**
- **Add `design` to the lesson schema category enum** (`src/schemas/lesson.schema.json` —
  today: security/correctness/performance/reliability/process/tooling/api-design/data; add
  `design`). A one-value enum addition, same as 18.2's proposed `preference` addition, same
  chokepoint, no new pipeline.
- **Author a curated design pack** (`src/lib/design-pack.js`, mirroring
  `src/lib/security-pack.js`) — a set of atomic design lessons distilled from the two
  resources: the named AI-slop clusters to avoid, the accessibility/touch/performance
  "must haves" (contrast 4.5:1, 44×44px touch targets, reserve space for CLS), the
  token-discipline rule (no raw hex in components), the "ground the design in the subject"
  principle, "spend boldness in one place," copy-as-design-material. Every lesson enters
  via `writeCandidate()` → `validateLesson()` (the ONE chokepoint), URL-free, declarative
  voice, `category: design`, tier curated, status candidate — landing as reviewable
  candidates exactly like the security pack, never machine-activating on their own.
- **Seed it into the global brain** so a fresh install starts design-literate, the same
  way the 26 security lessons already seed (`global-brain/`).

**Why this is the highest-leverage item:** it's what actually makes every frontend task
better, on every surface (the new builder agent, the plain-chat hooks, any shipped agent),
without the user doing anything. It's the design equivalent of the security pack that
already proved this pattern works.

**Files touched:** `src/schemas/lesson.schema.json`, new `src/lib/design-pack.js`,
`src/commands/pack.js` (register the pack), `scripts/build-global-brain.mjs` +
`global-brain/` (seed).

**Honest scoping caveat (learned from 18.2's audit finding, architecture-audit-v2.md
§2.1):** design lessons have the same decay/dispute question as `preference` lessons — a
design rule ("avoid purple gradients") is a *taste convention* that can shift, not a bug
that recurs. The confidence/decay model built for recurring mistakes may not fit cleanly.
This needs the same decay-policy decision 18.2 needs, before the pack is authored — flagged
here rather than glossed.

---

## 4. Per-project design decisions via the existing decision ledger (the MASTER.md pattern)

ui-ux-pro-max's MASTER.md (§2.3 of the audit) and Anthropic's brand-as-shared-context (§3.3)
are the same idea: record a project's design system *once*, apply it at every build so a
page built today and a page built next month look like the same product made them.
**Raphael already has this exact mechanism** — the decision ledger (`src/lib/decisions.js`,
`raph decide`, surfaced at session start in a `<raphael-decisions>` envelope as "settled,
do not re-litigate"). It's simply never been pointed at design.

**Proposal:** when the new `raphael-frontend` agent (or a plain-chat frontend session)
establishes a project's design system (palette, type scale, spacing, the signature
element), it records it as a decision (`raph decide "<project> uses <palette>, <type
pairing>, <spacing scale>" --why "..."`). Every subsequent frontend task inherits it from
the session-start decisions envelope — no re-explaining, no drift. This is near-zero new
code: it's a usage pattern for an existing subsystem plus one line in the design agents'
missions telling them to record and read design decisions. Optionally, a thin
`raph design-system` view that filters the decision ledger to design-tagged entries (a
convenience over existing data, not a new store).

**Files touched:** `src/lib/agents.js` (mission text for the design pair — record/read
design decisions), optionally a small filtered view in `src/commands/decide.js`.

---

## 5. A design-token guard (optional, reuses guard.js's pattern-scan)

ui-ux-pro-max's `validate-tokens.cjs` (§2.5 of the audit) deterministically flags hardcoded
hex where a token reference belongs — the same *shape* as Raphael's `guard` (`src/lib/
guard.js` deterministically flags secret patterns). A `raph guard scan --design` (or a
`raph lint`-style advisory) that flags raw hex colors in component code where a CSS
variable/token should be used is a natural, on-brand addition — deterministic, zero model
tokens, reusing the existing pattern-scan approach with a new pattern class.

**Why optional/later:** it's genuinely useful but it's the least essential of the five —
the knowledge (§3) and the builder (§2) are what make output better; the token guard is
upkeep that only matters once a project has adopted a token system. Sequenced last.

**Files touched:** `src/lib/guard.js` (new scan mode) or `src/lib/freshness.js` +
`src/commands/lint.js` (as an advisory lint check).

---

## 6. Eval scenarios so "flagship" means measured, not asserted

Flagship agents in Raphael are "covered by eval scenarios" (per `src/lib/agents.js`'s own
`FLAGSHIPS` framing). Promoting the design pair to flagship means they need eval coverage,
and design is genuinely harder to score objectively than correctness/security — which is
the honest reason AI lags here and the reason this can't be hand-waved.

**Proposal:** add eval scenarios that check *objective, checkable* proxies for good
frontend, not subjective "is it beautiful" — the same discipline the existing eval
scenarios use (S08 float-money, S20 IDOR are all pure file-inspecting checkers). Concrete
checkable design proxies: does the built output use CSS variables/tokens rather than raw
hex (deterministic scan); does it meet the accessibility floor (contrast-checkable color
pairs, presence of focus styles, `prefers-reduced-motion` handling, alt text); does it
avoid the named-slop tells (Inter font + centered + uniform border-radius + a purple
gradient, all mechanically detectable); is copy in active voice / are action labels
consistent (harder, lower-confidence, mark as a weaker probe). This is the part that needs
the most careful design — an eval that rewards "not-slop" without being able to reward
"actually good" is a real risk, and the honest move is to measure the checkable floor and
be explicit that taste beyond the floor stays human-judged.

**Files touched:** `src/eval/scenarios.js`, `src/eval/harness.js`.

---

## 7. Proposed build order (Phase 20 — draft, awaiting owner go)

| # | Milestone | Section | Effort |
|---|---|---|---|
| 20.1 | `design` category in schema + curated design-pack + global-brain seed | §3 | Medium — the knowledge layer, highest leverage |
| 20.2 | Sharpen `raphael-design` mission (judgment layer) + promote to flagship | §2 | Small — prose + a flag |
| 20.3 | New `raphael-frontend` builder agent (flagship, can actually build) | §2 | Medium |
| 20.4 | Design decisions via the existing decision ledger | §4 | Small — usage pattern + mission text |
| 20.5 | Eval scenarios for the checkable design floor | §6 | Medium — needs careful proxy design |
| 20.6 | `raph guard scan --design` — hardcoded-hex/token lint | §5 | Small, optional, last |

**Build-priority note:** 20.1 first — the knowledge layer is what makes *every* frontend
surface better immediately (new agent, plain chat, shipped agents), and it's the proven
security-pack pattern. 20.2 is nearly free (prose + a flag) and can ship alongside. 20.3
(the builder) depends on 20.1's lessons existing to be worth building. 20.5 (eval) gates
calling any of this "flagship" honestly and should land before the flagship label is
claimed in docs/marketing, not after.

**Decisions needed before building (carried from architecture-audit-v2.md's discipline):**
- §3's decay/dispute policy for taste-convention lessons (shared with 18.2's open question
  — resolve once, apply to both `preference` and `design`).
- §6's honest boundary: which design qualities are mechanically checkable (measure them)
  vs. which stay human-judged (say so, don't fake an eval for them).

**Awaiting owner go before any code changes.** Research clones live outside the repo at
`C:/Users/Mahesh/Desktop/Projects/_research/`, not committed.
