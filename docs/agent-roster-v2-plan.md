# Raphael agent roster v2 — a plan grounded in the gstack read

Companion to [docs/gstack-agents-audit.md](gstack-agents-audit.md). That document
is the raw findings; this one is the proposal — what, specifically, to change about
Raphael's 10-agent roster (`src/lib/agents.js`, read in full before writing this)
because of what the gstack read surfaced. Every item below cites the exact current
Raphael code it touches. Nothing here is built — this is a plan awaiting the
owner's go, same status as Phase 18.

---

## 1. What Raphael's roster actually is today (ground truth, not assumed)

Read directly from `src/lib/agents.js`: 10 agents (`manager`, `planner`,
`architect`, `developer`, `reviewer`, `security`, `debugger`, `design`,
`deployer`, `critique`), each a `{slug, name, flagship, model, tools, role,
mission, output}` record rendered into a Claude Code subagent file by
`renderAgent()`. Every agent gets the exact same five-rule `SPINE` verbatim
(brain-first, free-checks-before-paid, map-not-repo, cheap-then-strong,
write-back) plus its own mission and output shape. Four fixed `RECIPES` chain
agents together (`review`, `debug`, `pre-deploy`, `security-audit`). No agent has
any decision-presentation format, confidence-banding, cross-model check, or
per-agent context-scoping today — these are the gaps this plan targets.

---

## 2. New capability: a decision-discipline addition to the SPINE

**What:** Add a sixth spine rule, applied to all 10 agents identically (same
mechanism as the existing five — one shared block, not ten copies):

> **6. One decision, one question.** When you need the developer's call on
> something non-obvious, state your recommendation and why in one line, give
> concrete pros and cons (not vibes), and ask about exactly one thing at a
> time — never bundle unrelated decisions into one ask.

**Why:** gstack's AskUserQuestion protocol (audit §2) is the single most
elaborate piece of its shared framework, and its core discipline — one issue
per question, mandatory recommendation + reasoning, real pros/cons, no
batching — is genuinely absent from Raphael's agents today. None of the 10
missions currently say anything about *how* to present a choice to the
developer; they only say what to investigate and what to output. This is a
prose-only change to `SPINE` in `src/lib/agents.js` — zero new tooling, zero
token cost beyond slightly longer agent instructions (which are static, not
per-session recall spend).

**Files touched:** `src/lib/agents.js` (`SPINE` constant), then
`scripts/build-agents.mjs` regenerates `plugin/agents/*.md`.

---

## 3. New capability: confidence-banded findings, reusing existing confidence machinery

**What:** For the three finding-producing agents (`reviewer`, `security`,
`debugger`), add explicit confidence-banding to their `output` field, mirroring
gstack's review specialists' display rule (audit §3.1): a finding at 9–10
confidence is shown normally; 5–6 shown with an explicit "verify this" caveat;
3–4 is demoted to an appendix instead of the main report; 1–2 only surfaces if
severity would be critical. gstack additionally requires **quoting the exact
motivating code line(s)** before a finding is allowed a high confidence score —
worth adopting verbatim, since it's the review-time twin of the
`unverifiable-claim` reviewer-screen check already planned for the *lesson*
pipeline (Phase 18, §7.3 of `docs/v2-vision.md`). Same principle, applied at
the point an agent generates a live finding instead of the point a lesson gets
stored.

**Why this isn't a stretch for Raphael specifically:** Raphael already computes
a real, evidence-based confidence score for *lessons* (`src/lib/confidence.js`
— breadth, repetition, recency-decay, curated floors). This proposal doesn't
invent a new scoring concept; it extends the same discipline (a claim's
strength should visibly gate whether/how it's shown) to a second place Raphael
currently doesn't apply it: live findings an agent generates during a session,
which today have no confidence signal at all.

**Files touched:** `src/lib/agents.js` (mission/output text for `reviewer`,
`security`, `debugger`).

---

## 4. New capability: opt-in cross-model "outside voice"

**What:** For the highest-stakes recipes — `security-audit` and `pre-deploy` —
add an optional final step: if a second AI provider is available (Codex CLI
installed + authenticated, or `ANTHROPIC_API_KEY`/another provider configured
distinct from the one that ran the primary check), dispatch the same findings
for an independent second opinion from a prompt that explicitly says "don't
repeat the review, find what it missed." Present any disagreement as a named
tension point for the developer to resolve — **never auto-apply the second
opinion's recommendation**, matching gstack's own explicit "User Sovereignty"
rule (audit §6) and Raphael's own existing pattern (curator's canary-gate-
then-present, `selfpatch`'s present-never-merge rule, invariant #4's
human-in-the-loop for security).

**Why it's a good fit specifically for Raphael:** `src/lib/provider.js`
already supports both a subscription provider (`claude -p`) and an API-key
provider — the two-provider plumbing this needs already half-exists. This
also directly serves the "industry standard" goal from Phase 18/§5.1 of
`docs/v2-vision.md`: a user invested in a different AI ecosystem gets value
from Raphael offering a genuine cross-model check, not just a Claude-only
opinion re-stated twice.

**Files touched:** `src/lib/provider.js` (provider detection for a second,
distinct provider), `src/lib/agents.js` (`RECIPES` — an optional final step on
`security-audit` and `pre-deploy`), new small module for the tension-report
format.

**Scope discipline (learned from 18.6's own decision, §7 of `docs/v2-vision.md`
and gstack's own "Boil the Ocean" vs. Raphael's `no-gold-plating` tension,
audit §6):** ship this for exactly the two highest-stakes recipes first, not
all four — prove it's worth the complexity before generalizing to `review` and
`debug`.

---

## 5. New capability: mine per-agent outcome data — the adaptive-gating idea, Raphael-shaped

**What:** gstack's `/review` specialist panel reads historical per-specialist
hit rates (`gstack-specialist-stats`) and uses them to decide which specialists
to dispatch on a given review (audit §3.1/§3.4) — a genuinely novel idea
Raphael has no equivalent of today, applied to *agents* rather than *lessons*.
The direct port doesn't fit (Raphael doesn't dispatch a fixed panel of
specialist sub-agents per review the way gstack does) but the underlying
signal is valuable on its own: **does Raphael know whether an agent's
findings actually get acted on?** Today, no — nothing logs whether a developer
applied, ignored, or reverted a `raphael-reviewer`/`raphael-security`/
`raphael-debugger` finding.

**The Raphael-shaped version:** extend mining (`src/lib/episodes.js`, already
scans session transcripts for error-fix and user-correction episode shapes)
with a new episode detector: did an agent's suggested finding/fix get applied
in the same session, reverted shortly after, or ignored? Surface the resulting
per-agent signal in `raph stats`/`raph portfolio` (both already exist and
already surface retrieval-miss/confidence data for lessons — this is the same
report gaining a new, analogous column for agents, not a new report).

**Why this is worth doing carefully, not quickly:** this is the one proposal
in this document that's a genuinely new *measurement* capability, not a prose
or plumbing change — it needs a real design pass on what "acted on" means from
transcript evidence alone (the same rigor the existing episode detectors
already apply) before it's built. Flagged here as the most valuable *and* most
speculative item, deliberately not scoped down to a one-line change the way
§2–§4 are.

**Files touched:** `src/lib/episodes.js` (new detector), `src/lib/stats.js`,
`src/lib/portfolio.js`.

---

## 6. New capability: extend `raph guard` to scan a project's *installed* skills, not just secrets

**What:** gstack's CSO security audit has a dedicated "Skill Supply Chain"
phase (audit §3.3) that scans a repo's installed Claude Code skills for
exfiltration patterns, credential-env access, and prompt-injection phrasing —
citing a real, cited statistic ("36% of published skills have security flaws,
13.4% are outright malicious," Snyk ToxicSkills research). Raphael's `raph
guard` today (`src/lib/guard.js`) scans staged/tracked files for secrets using
the chokepoint's own `SECRET_RULES` — it has never looked at `.claude/skills/`
content specifically for this different threat class.

**Why this is a strong, on-brand addition:** Raphael already positions itself
on security discipline (invariant #1–#6, the security starter pack, the adopt
gauntlet's reviewer screen). A user who trusts Raphael to scan their commits
for secrets would reasonably also want it to flag a malicious third-party
skill sitting in `.claude/skills/` — a threat class Raphael's existing guard
doesn't cover at all today, and one gstack's own research says is common
enough to matter (translated to Raphael's own numbers: worth verifying
independently before quoting Snyk's figure in Raphael's own docs, but worth
building the check regardless of the exact percentage).

**Files touched:** `src/lib/guard.js` (new scan mode: `raph guard scan
--skills`, reusing the existing pattern-matching approach, new pattern set for
exfiltration/credential-access/injection-phrasing rather than secrets).

---

## 7. Sharpen three existing agent missions with gstack's exact language (no new mechanism, prose only)

Read `investigate/SKILL.md` and `review/specialists/*.md` in full (audit §3.1,
§5) specifically looking for language sharper than Raphael's current missions.
Three concrete, minimal prose edits to `src/lib/agents.js`:

- **`raphael-debugger`** — add gstack's explicit **3-strike rule**: after
  three tested-and-failed root-cause hypotheses, stop and surface the decision
  to the developer (continue with a new hypothesis / escalate / add logging
  and wait) rather than continuing to guess. Also add the explicit requirement
  that a regression test must **fail without the fix and pass with it** —
  Raphael's current mission says "verified by the project's own checks" but
  doesn't require the test to be shown failing first, which is the part that
  actually proves the test means anything.
- **`raphael-reviewer`** — add the pre-emit verification language from §3
  above: don't report a finding above medium confidence unless you can quote
  the exact line(s) that motivate it.
- **`raphael-security`** — add an explicit LLM/AI-security checklist item
  (prompt injection into system prompts, unsanitized LLM output rendered as
  HTML, unvalidated tool-calling, unbounded-LLM-call cost attacks) as its own
  named category, not folded into generic injection coverage. gstack's CSO
  treats this as a distinct phase specifically because it's a newer attack
  class most reviewers don't think to check — worth naming explicitly given
  how much of Raphael's own likely user base is building AI-integrated
  products themselves.

**Files touched:** `src/lib/agents.js` only. No schema, no pipeline change.

---

## 8. What NOT to add (stated plainly, matching the audit's §8)

- **No adaptive telemetry/feature-discovery/upgrade-nag preamble** on
  Raphael's agents — gstack's shared framework carries real weight (a
  ~150-line bash preamble on every invocation); Raphael's injection stays
  light by design and this doesn't change that.
- **No unvalidated self-reported-confidence agent output written straight to
  the brain** — any agent output that becomes a lesson still goes through
  `validateLesson()` exactly as today; nothing in this plan creates a second
  door in.
- **No `/ship`-style automatic push+PR creation for `raphael-deployer`** — the
  deploy/spend/sign-in boundary stays exactly where it is; `raphael-deployer`
  keeps producing a checklist for a human to execute, never executing it.
- **No blanket "Boil the Ocean" adoption** — §4's cross-model check ships
  narrow (two recipes) on purpose, per the same scope discipline already
  applied to Phase 18's 18.6 decision.

---

## 9. Proposed build order (Phase 19 — draft, awaiting owner go)

| # | Milestone | Section | Effort |
|---|---|---|---|
| 19.1 | Decision-discipline spine addition | §2 | Trivial — prose only |
| 19.2 | Sharpen debugger/reviewer/security missions | §7 | Trivial — prose only |
| 19.3 | Confidence-banded findings for reviewer/security/debugger | §3 | Small |
| 19.4 | `raph guard scan --skills` — skill supply-chain check | §6 | Small–medium |
| 19.5 | Cross-model outside voice for `security-audit` + `pre-deploy` | §4 | Medium |
| 19.6 | Per-agent outcome mining (adaptive-gating signal) | §5 | Largest — needs its own design pass first |

19.1 and 19.2 are the cheapest, highest-confidence items in this whole
document — pure prose edits to already-tested rendering code, no new surface
at all. 19.6 is deliberately last and flagged as needing real design work
before it's scoped further, not because it's low-value but because it's the
one genuinely new measurement capability here rather than a refinement of
something that already exists.

**Awaiting owner go before any code changes.**
