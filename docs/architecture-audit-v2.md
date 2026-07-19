# Senior-architect audit — Raphael as shipped, and the v2/agent-roster proposals

Owner ask (2026-07-19): after the v2 research (docs/v2-vision.md) and the agent-roster
plan (docs/agent-roster-v2-plan.md), stop proposing and start auditing — act as a senior
software developer and system-design architect, find the gaps and bad decisions in
**both** what's already shipped and what's newly proposed. This is that audit. It is
deliberately adversarial: the point is to find real problems, not to restate what the
existing docs already say went well. Every claim below is checked against actual code
before being written down — three are confirmed directly in this session (cited inline);
the rest reference prior sessions' already-verified findings.

---

## 1. Gaps in the shipped architecture

### 1.1 The chokepoint validates *structure*, not *provenance* — confirmed gap, not yet decided

`validateLesson()` (`src/lib/validate.js`) enforces schema conformance: required
fields, category/status/severity enums, no URLs, declarative-voice pattern checks.
Checked directly: **nothing in `validate.js` or `lesson.schema.json` ties
`status: active` to having actually passed through `approve.js`.** `compile.js`
re-validates every file on disk at build time (confirmed: `readdirSync` walks the
lessons directory, every file goes through `validateLesson()` again, invalid files
are silently excluded from the index) — this closes the obvious version of "a
Bash-capable agent writes a malicious file directly to the brain repo," because a
structurally-invalid file gets excluded regardless of how it landed on disk.

But a **structurally valid** file — well-formed frontmatter, a legitimate category,
no URL, declarative phrasing, and `status: active` set by hand — would pass
`compile.js`'s revalidation and get injected, having never been reviewed by a human
or the machine curator. The chokepoint's guarantee is "this lesson is shaped like a
real lesson," not "this lesson entered through a reviewed path." Any Claude Code
session with Bash/Write access to `~/.raphael` already carries a great deal of
ambient trust, so this may be an *acceptable* risk rather than an oversight — but
it reads today as an implicit assumption, not a stated one. Worth an explicit
decision: either document this as an accepted risk (the brain's git history +
pre-push guard are the actual detection/recovery mechanism, not prevention), or
add a provenance marker (e.g. a signature or a separate "activated_via" field only
`approve.js`/`curator.js` can write, checked at compile time) if prevention is
wanted. Right now it's neither documented nor defended — just unaddressed.

### 1.2 "Always net-lower than no-Raphael" is stated as fact in positioning, true by construction only

The README and `docs/v2-vision.md` both lean on the claim that Raphael's token
usage stays below the no-Raphael baseline. Mechanically this is true only insofar
as the injection budget (~1,200 tokens/session) is a hard cap — it's a *ceiling*,
not a *measured, ongoing proof*. `docs/v2-vision.md` §3 itself proposes 18.1
(cache-stable ordering) specifically because the current re-ranking behavior can
invalidate a provider's prompt cache every session, meaning the *real* cost under
provider cache economics may already exceed what the raw token count implies —
and that fix hasn't shipped. `raph eval`'s ON/OFF lift measurement proves task
*quality* improves; it doesn't yet produce an ongoing, measured token-economics
holdout the way headroom's counterfactual framing does (18.10 in Phase 18
proposes exactly this, also unshipped). Net: the "always net-lower" claim is the
project's own explicit *design constraint*, correctly enforced by a hard cap, but
it is currently marketed with more certainty than the underlying cache-economics
math has actually been verified to support. Not a crisis — the direction is
right — but the confidence level in the copy should match the confidence level in
the evidence until 18.1/18.10 close that gap.

### 1.3 Raphael's own surface area is now large enough to risk the exact problem it exists to solve

41 CLI verbs, an 8-step autopilot pulse loop, a global brain, a local console with
8 tabs, an Academy driver, an adopt gauntlet, a skills factory, an agent-maker —
all real, all individually well-scoped and documented. But stacked together, this
is now a genuinely large system for one person (plus Claude sessions) to hold a
correct mental model of, and Phase 18's own headline positioning idea (§7.2,
"Comprehension Debt") is explicitly about the risk of a codebase growing faster
than anyone's understanding of it. There's a real, slightly uncomfortable
irony worth naming plainly: Raphael's pitch to *users* is "stop losing track of
what your codebase actually does" — and Raphael's own `raph atlas`/`raph map`
exist to answer that for Raphael's own repo, which is good — but the growth rate
of new verbs and subsystems (12 new CLI verbs added in session 14 alone, per
CLAUDE.md's own log) is fast enough that it's worth periodically asking "would a
new contributor understand this system from the docs alone," not just "does
`raph doctor` report healthy." No specific fix proposed here — this is a standing
question to keep asking, not a bug to file.

### 1.4 Global brain governance doesn't scale past "one owner curates everything"

The two-brain model (local + global) is architecturally sound, and the *local*
half's governance (chokepoint, git history, pre-push guard) is genuinely solid.
The *global* half's governance today is "the owner personally reviews and commits
every lesson that goes into `global-brain/lessons.json`" (confirmed via
CLAUDE.md's own repeated "curated 26/29/33/43/57/58/59 active" language across
sessions — every batch was the owner approving candidates one at a time). That's
appropriate at today's scale and is actually a *feature*, not a bug, for trust —
but it is a structural single point of failure/bias/bottleneck if "industry
standard" ever means meaningful external contribution volume. §5.1/§7.7 of
`docs/v2-vision.md`'s contribution-bundle design (stage locally, human sends,
owner curates via PR) is the right shape for now, but it's worth being honest
that "the owner reviews everything forever" doesn't scale linearly with adoption,
and no design in the current docs addresses what happens when contribution volume
outpaces one person's review bandwidth. Not urgent today; worth flagging before
it becomes urgent.

### 1.5 Atlas's static-analysis blind spots are acknowledged but not bounded

Atlas's "no embeddings, deterministic graph" bet is well-evidenced (this session's
own gstack/hermes-agent/open-notebook research independently re-confirms it,
twice). But a deterministic import/call graph built from static analysis has a
real, standard blind spot: dynamic dispatch, reflection, string-built import
paths, and monkey-patching don't show up as edges. CLAUDE.md already shows
self-awareness of a related issue ("multi-exporter = AMBIGUOUS surfaced in
report"), which is good practice — but there's no stated *bound* on how much of a
typical codebase's real call graph Atlas actually captures vs. misses silently
(as opposed to captures-and-flags-as-ambiguous). The 147.9× token-efficiency
number is real and measured, but it's a measurement of tokens-to-answer for
questions Atlas *did* answer — not a recall measurement against everything a
human `grep`-and-read pass would have found. Worth a bench addition (not proposed
in this document, flagged for later) that measures Atlas's miss rate on a
codebase with known dynamic-dispatch patterns, so the efficiency claim and the
completeness claim are measured separately rather than implicitly bundled.

---

## 2. Gaps in the new proposals (Phase 18 + Phase 19)

### 2.1 18.2's `preference` lessons have no stated decay/dispute policy

The revised developer-profile proposal (§4.1 of `docs/v2-vision.md`) correctly
routes `category: preference` through the same chokepoint and the same
retire/confidence-decay lifecycle as every other lesson — but "the same lifecycle"
may not actually fit preferences well without adjustment, and the doc doesn't
address this. `confidence.js`'s decay model rewards breadth and repetition and
decays on staleness — a mechanism built for *mistakes that get re-confirmed by
recurring* (the more often a bug pattern repeats, the more confidence it earns).
A *preference* ("prefers 2-space indent," "avoids default exports") isn't
re-confirmed the same way — it's either stated once and then simply never
violated (which looks identical to "never fired" in the existing miss-detection
sense), or it's silently *changed* one day with no explicit correction event the
way a wrong lesson gets rejected. Nothing in the current 18.2 proposal specifies
how a stale or reversed preference gets caught and retired, as opposed to a wrong
technical lesson (which has an explicit `reject`/`retire` correction path with a
clear trigger: it produced a bad outcome). This needs a real design decision
before 18.2 is built, not just "reuse the existing pipeline."

### 2.2 18.11's reviewer-screen check raises the bar; it doesn't close the gap it's named for

The `unverifiable-claim` risk kind (§7.3 of `docs/v2-vision.md`) is genuinely the
best evidence-to-effort item in the document, and worth building — but it's worth
being precise about what it actually buys. The reviewer performing this check is
itself a model call, which is exactly the class of component invariant #4 already
treats with structural suspicion (fail-closed on malformed output, quarantine as
a hard floor). A sufficiently deliberate adversarial content author crafting a
MemoryGraft-style fabricated "success" record could plausibly also craft
supporting "evidence" text alongside the claim, defeating a check that's looking
for the *absence* of evidence rather than verifying the evidence is *real*. This
doesn't mean don't build it — it closes the *unsophisticated* version of the
attack (a bare unsupported claim) cheaply, which is real value — but the doc
currently reads as "closes a named attack class." More accurate: "raises the cost
of that attack class." Worth rephrasing when this ships, so the security floor's
actual strength isn't overstated the same way flagged in §1.2 above for the
token-economics claim.

### 2.3 19.5's cross-model "outside voice" needs an explicit invariant-#5 conversation, not an implicit one

Dispatching to a second AI provider (Codex CLI, or a distinct configured API
provider) for `security-audit`/`pre-deploy` is a good idea structurally (§4 of
`docs/agent-roster-v2-plan.md`), and it likely fits inside invariant #5's
existing model-call carve-out (5a) — but "likely fits" is doing real work in that
sentence. Invariant #5 as currently written enumerates specific, named network
surfaces (the Anthropic Messages API or the logged-in Claude Code CLI; adopt
fetches; global-brain down-sync; self-update check) — a second provider (Codex
CLI shelling out to a *different* company's API, under a *different* auth/billing
relationship the user must separately hold) is a materially different trust
relationship even if the mechanism (a bounded model call) rhymes with the
existing carve-out. It should get its own explicit sentence in invariant #5 (a
"§5e") the way each prior addition did, not be assumed to already fit under 5a
because it's technically also "a model call." There's also an unaddressed supply-
chain question: shelling out to an external `codex` binary means trusting that
binary's own security posture, which Raphael has no visibility into and no
control over — worth naming as a dependency Raphael would be taking on, not just
a feature being added.

### 2.4 19.6's per-agent outcome mining risks a confidently wrong signal

Mining "was an agent's finding applied, reverted, or ignored" from transcript
evidence (§5 of `docs/agent-roster-v2-plan.md`, already flagged in that doc as
the most speculative item) has a specific methodological risk worth naming
precisely: transcript evidence alone can't distinguish "the developer ignored
this finding because it was wrong" from "the developer ignored this finding
because they were mid-task and never got back to it" from "the developer applied
a *different* fix than the one suggested, which should count as the finding being
right but isn't literally the diff the agent proposed." A confidence signal built
on this data without careful design could easily end up systematically punishing
agents whose findings are correct-but-inconvenient (security findings especially
— those get deferred far more often than they get proven wrong) rather than
punishing agents whose findings are actually low-quality. The doc already flags
this item as needing its own design pass rather than being scoped further here;
this audit's job is to make the *specific* failure mode explicit so that design
pass starts from the right question ("how do we avoid conflating deferred-because-
busy with wrong") rather than a generic "add outcome tracking" brief.

### 2.5 18.6's multi-CLI reach creates ongoing maintenance surface with no test coverage plan

The AGENTS.md canonical + thin-wrapper approach (§5.1 of `docs/v2-vision.md`,
finalized with a deliberately narrow v1 scope — one wrapper, not four) is the
right scope decision, but the document doesn't address an operational
consequence: Raphael's CI matrix today (confirmed: Linux + Windows × Node
18/20/22) tests the *engine*, not any host-CLI integration surface, because
there isn't one yet. Once a real wrapper for a second host CLI ships, that host's
own convention format (hook system, plugin manifest shape, whatever it calls
"skills") becomes something Raphael depends on and that can change independently,
silently, on the other project's own schedule — with no automated signal to
Raphael's own CI when it does. This isn't a reason not to build 18.6; it's a
missing line item: 18.6's scope should explicitly include "what does 'this
wrapper still works' mean, and how does CI check it," not just the wrapper
generation logic itself.

---

## 3. What's actually solid (stated plainly, so the gaps above read as targeted, not as "everything is broken")

- The chokepoint's structural guarantees (schema, no-URL, declarative-voice,
  secret-scrubbing) are real, tested, and were independently re-validated three
  separate times this session alone (against hermes-agent's Honcho, against
  gstack's `learn`, and against the memory-poisoning literature) without finding
  a case where a competing project's approach was actually stronger.
- The fail-open discipline (every pulse step, every Honcho-style remote call
  pattern gstack also uses) is consistently applied and matches what the
  research literature holds up as correct practice.
- The deploy/spend/sign-in boundary has held across every session referenced in
  CLAUDE.md — no exception found, including in this session's own new proposals
  (19.5's outside voice and 18.6's multi-CLI wrapper both explicitly preserve it).
- The "present, never auto-apply" pattern (curator's canary gate, `selfpatch`,
  and now 19.5's cross-model tension reporting) is applied consistently enough
  across genuinely different subsystems that it reads as a real architectural
  principle, not a one-off decision — and it independently matches both
  hermes-agent's absence of exactly this discipline (a contrast, not a
  similarity) and gstack's explicit "User Sovereignty" ethos (a genuine
  convergence between two unrelated projects).

---

## 4. Summary — what needs an explicit decision before anything in §2 gets built

1. §1.1 — decide and document whether structure-without-provenance is an
   accepted risk for `status: active`, or add a provenance check.
2. §1.2 — either ship 18.1/18.10 before leaning harder on "always net-lower" in
   marketing copy, or soften the claim's phrasing until they ship.
3. §2.1 — design a decay/dispute policy for `preference` lessons before 18.2 is
   scoped for implementation, not after.
4. §2.3 — write the invariant #5e amendment (and think through the codex-binary
   supply-chain trust question) before 19.5 is scoped for implementation.
5. §2.4 — narrow 19.6's design brief to explicitly solve the deferred-vs-wrong
   confusion before any mining code is written.

Everything else in §1 and §2 is a "keep an eye on this" flag, not a blocker.
