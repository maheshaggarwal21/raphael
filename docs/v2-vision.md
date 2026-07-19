# Raphael v2 — the ritual, the luxury, the standard

Owner ask (2026-07-19, verbatim intent): make Raphael the industry standard — a
*ritual* developers reach for, not just a tool they installed once. Ground the plan
in two research inputs: (1) two Gemini deep-research links, and (2) ten fast-growing
GitHub repos, studied in depth, not skimmed, for mechanism *and* psychology — what
is each one actually doing, and why are developers so drawn to it. One constraint is
non-negotiable across every idea below: **Raphael's token usage must always be lower
than not using Raphael at all.** Luxury and ritual, not token bloat.

**Honesty note on sources.** The two Gemini share links
(`share.gemini.google/ZbcmFAU5Q9Yv`, `share.gemini.google/HDfk9e3yhTbO`) redirect to
`gemini.google.com/share/...` URLs that require an authenticated Google session — a
plain fetch only returns the page's sign-in navigation shell, not the shared
conversation. Both attempts (direct and post-redirect) confirmed this. **This
document does not include their content.** If the owner pastes the research text
directly, it should be folded in as an addendum — flagged here so nothing is
silently treated as covered when it wasn't.

The ten-repo research below **is** real: each repo's actual README was read in depth
by a dedicated research pass (not skimmed), cross-checked against raw source where a
claim looked thin, and reported with explicit honesty flags where a mechanism
couldn't be verified. One correction surfaced during research and is recorded here
rather than silently dropped: a first-pass fetch of Agent-Reach's README hallucinated
a "58k stars, v1.5.0" claim that a raw-README cross-check found nowhere in the actual
text — discarded. Star counts and growth claims throughout are otherwise treated as
*claimed*, not independently verified, per each repo's own framing.

---

## 1. What the ten repos actually teach

Full write-ups exist in this session's research; this table is the compressed,
actionable extract — mechanism, the psychological hook, and what (if anything)
transfers to Raphael. Two repos (Agent-Reach, apple/container) are marked "thin
transfer" honestly rather than forced into relevance.

| Repo | Real mechanism | The hook (why it grows) | Transfers to Raphael as… |
|---|---|---|---|
| [last30days-skill](https://github.com/mvanhorn/last30days-skill) | Cross-platform aggregator; ranks by native engagement signal (upvotes/views/trading volume), clusters convergent stories, cites evidence | FOMO + distrust of editorial framing — "people voting with attention, not editors" | Cross-project convergence as a confidence signal; inline evidence weight at injection time |
| [headroom](https://github.com/chopratejas/headroom) | Content-aware compression (JSON/code/prose), **cache-alignment** to protect provider KV-cache hits, reversible compression with on-demand retrieval | Acute, quantified pain: "I'm burning tokens and dollars, my context fills with junk" | **Cache-stable injection ordering** (§3.2) and **pointer+retrieve for marginal lessons** (§3.3) — the two highest-leverage ideas in this whole document |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | Named, bounded 1–10 tuning dials (variance/motion/density) injected as instructions — no actual slop-detector, thinner than its marketing | Status/aesthetic anxiety: "my AI-built product visibly looks cheap" | Named dial UX pattern for recall behavior (§3.4); console visual-craft pass (§4.3) |
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Agent-authored skills at runtime + a persistent per-user model ("Honcho") separate from task memory; FTS5 session index | "The agent that grows with you" — permanence, no re-explaining yourself | **Developer profile layer** distinct from episodic lessons (§4.1) — the most "premium-feeling" idea here |
| [Agent-Reach](https://github.com/Panniantong/Agent-Reach) | Routing/dispatch layer over existing scrapers/CLIs per platform, with fallback chains and a `doctor` health check | "One CLI instead of ten broken scrapers" | **Thin transfer** — validates `raph doctor`'s existing shape; the "agent installs itself from a pasted URL" pattern is the *opposite* of Raphael's deliberate bounded-fetch stance — noted as a philosophical divergence, not adopted |
| [career-ops](https://github.com/santifer/career-ops) | `AGENTS.md` canonical file + thin per-CLI wrapper files (works identically across 7 agent CLIs); composite A–F scoring with a named "legitimacy" sub-check; never auto-sends | "My job search is unpaid labor — automate the grind, I keep the send button" | **AGENTS.md canonical + thin wrappers for multi-CLI support** (§5.1) — the single highest-leverage idea for "industry standard"; in-product trust disclaimers (§4.4); a named adversarial sub-flag on confidence (§4.4) |
| [markitdown](https://github.com/microsoft/markitdown) | Uniform `.convert()` over per-format converters (pdfminer/mammoth/olefile), vision-LLM as just another converter, explicit narrowest-privilege API guidance | The boring-but-essential utility every LLM pipeline needs once and nobody wants to own | Vendor/shell out to it for `adopt`'s PDF/DOCX/PPTX legs instead of maintaining bespoke parsing (§5.3) |
| [open-notebook](https://github.com/lfnovo/open-notebook) | Self-hosted NotebookLM clone; SurrealDB as one unified doc+graph+vector store; per-task model assignment (chat vs. embed vs. TTS); explicit per-conversation source scoping | "My own private NotebookLM, not Google's, not locked to Gemini" — privacy + provider-lock-in resentment + self-hosting culture | Validates `policy.js`'s task-typed model assignment as a *marketable* feature, not just plumbing (§4.5); "in scope" transparency as a console affordance (§4.6); validates Atlas's no-embeddings bet by showing what the *alternative* costs (§6) |
| [apple/container](https://github.com/apple/container) | One lightweight VM per container (not one shared VM), isolation boundary pushed to the hypervisor level | Docker Desktop fatigue + native-first-party trust | **Thin transfer** — reinforces Raphael's existing per-unit isolation choices (zero-tool model containment); mostly a rhetorical lesson (native > resented third-party) for positioning, not architecture |
| [pm-skills](https://github.com/phuryn/pm-skills) | 68 skills + 42 commands across 9 plugins; **progressive disclosure** (only lean frontmatter resident by default, full body loads on-demand); commands chain multiple skills; CI-enforced name/manifest integrity | Completionism + shareable numbers ("100+ skills!") + category-specific status signaling | Frontmatter-description lint for Skill Factory drafts (§5.4); theme bundle packs beyond security (§5.5); validates progressive disclosure is *already* Raphael's model for injection budgets |

**One honest pattern across all ten:** the repos with the thinnest technical
substance (taste-skill, Agent-Reach) grow on *pure emotional hook* — status anxiety,
convenience — while the ones with real engineering depth (headroom, markitdown,
open-notebook) *also* lead their README with a sharp, quantified, personal pain
statement before anything technical. Mechanism alone doesn't grow a repo. The pain
statement does the recruiting; the mechanism earns the retention. Raphael has the
mechanism (chokepoint, curator, Atlas — genuinely more sophisticated than most of
what's above). What it's under-leveraging is the *pain statement* and the *ritual*.

---

## 2. The psychology, synthesized

Six distinct pulls recur across the ten repos. Naming them precisely matters because
each maps to a different lever in Raphael, not a single generic "make it nicer":

1. **Acute, quantified pain relief** (headroom, career-ops). Abstract pitches
   ("context management," "job search assistant") don't move people. Concrete
   before/after numbers do (`65,694 → 5,118 tokens`). Raphael already has this data
   (`raph eval`, `raph atlas bench` — 147.9× measured) but under-surfaces it as a
   *felt, personal* number rather than a one-time proof.
2. **Permanence / personalization** (hermes-agent's Honcho, open-notebook's
   provider-freedom). The anxiety is "I have to re-explain myself every session."
   The promise is an agent that already knows you. Raphael's lessons are episodic
   (this mistake, this fix) — there's no standing sense of "it knows *me*."
3. **Status / aesthetic signaling** (taste-skill, pm-skills' "100+" number, Apple's
   native-tool halo). People screenshot and share things that make them look good —
   a sharp UI, an impressive number, a "my setup" flex. Raphael's numbers (60
   lessons, 415 tests, 147.9× fewer tokens) are real and are currently buried in CLI
   output, not designed to be looked at, let alone shared.
4. **Trust through visible, explicit boundaries** (career-ops's "never sends, never
   submits" repeated at the point of action, not just in a README). Raphael has
   real boundaries (quarantine floor, deploy/spend boundary) — they live in
   CLAUDE.md and ARCHITECTURE.md, not in the moment a user would want reassurance.
5. **Self-hosting / data-ownership culture** (open-notebook, container). "My own
   local X, my data never leaves unless I say so." Raphael's two-brain model
   already *structurally* matches this pull (invariant #6) — it's a marketing gap,
   not an architecture gap.
6. **Low-friction, install-and-forget** (Agent-Reach, Apple's native tooling). One
   command, then invisible. Raphael's autopilot already nails this operationally —
   what's missing is a *ritual moment* that makes the invisible loop visible and
   satisfying on a cadence, instead of only a plain 150-token digest.

The through-line for "luxury": luxury isn't more features, it's the *feeling* of
being known, of effortlessness, and of a boundary you can trust without checking.
Pulls 2, 3, and 4 are the luxury levers. Pulls 1 and 6 are the ritual levers. Pull 5
is a positioning gap, not a build gap.

---

## 3. Token-economics ideas — strengthen the one constraint that can never break

These come straight from headroom and directly serve the owner's hard rule. Ranked
by leverage; all are net-zero-or-negative on token spend by construction, not by
promise.

### 3.1 Why this section comes first
Every other idea in this document is judged against these mechanics. A feature that
can't clear "still net-lower than no-Raphael, honestly measured" doesn't ship,
regardless of how good the story is.

### 3.2 Cache-stable injection ordering (highest leverage, cheapest to build)
`match.js`/`inject.js` re-score and re-rank lessons on every session start. If that
re-ranking reorders the injected block even when the *underlying lesson set* hasn't
changed, the provider's prompt cache gets invalidated on every session — meaning the
*real* cost (latency + the provider's own cache-miss pricing) can be worse than the
raw token count under budget suggests. Fix: within a session (and ideally across a
day), pin the order of unchanged lessons and only append new/changed ones at the
tail. This is a correctness fix disguised as a feature — it makes the existing "≤1,200
tokens/session" budget claim honest under real provider cache economics, not just
honest under a naive token count.

### 3.3 Pointer + retrieve for marginal-confidence lessons
Right now a lesson either clears the injection threshold and pays its full token
cost, or it doesn't fire at all. headroom's reversible-compression pattern suggests
a third state: for lessons just below the injection bar, inject a one-line pointer
(id + one-sentence gist, ~15–20 tokens) instead of the full body, and let the agent
pull the full lesson via a cheap `raph show <id>` call *only if* it turns out
relevant to the task at hand. Net effect: more of the brain's knowledge is
*reachable* per session without raising the guaranteed floor spend — a direct,
mechanical strengthening of "always net-lower."

### 3.4 A named recall-assertiveness dial
Distinct from the existing auto-approve dial (which governs *activation*, not
*recall*). `raph recall quiet|normal|eager` — a single, legible knob a user sets
once, versus indirectly tuning match thresholds. `quiet` biases toward the pointer
pattern above; `eager` spends more of the budget on full bodies. This is the
taste-skill "named bounded dial" pattern applied to the one place Raphael doesn't
yet expose user control over token spend directly.

### 3.5 Effort-routing on lesson-match confidence
`policy.js` already routes model/effort by *task kind*. The refinement: when a
high-confidence lesson already answers the step the agent is about to take, that
step is a good candidate for a cheaper/lower-effort pass — a second, orthogonal axis
to task kind. This is a token-reduction idea aimed at the *agent's own* model calls
during Academy/driver work, not just at recall.

### 3.6 Holdout-measured savings, not just budget-cap savings
`raph eval` already does ON/OFF lift measurement. headroom's framing worth
borrowing: report a *measured*, counterfactual savings number (a real holdout
comparison) in `raph stats`/`raph report weekly`, not just "we stayed under the
1,200-token cap." A cap proves discipline; a measured holdout proves the actual
claim the README makes.

---

## 4. Luxury — the agent that feels like it knows you

### 4.1 A developer profile layer (the single most "premium" idea here)
Lessons are episodic — "this mistake, this fix." Nothing in Raphael today builds a
slow, standing model of *the developer* — naming conventions, risk tolerance,
preferred libraries, verbosity preference. hermes-agent's "Honcho" does this, but
notably with **no described governance** — no scrubbing, no chokepoint, no review;
corrections land as free text in `CLAUDE.local.md`. That gap is Raphael's opening,
not a reason to skip the idea: build the same "it knows me" feeling, but through the
exact same door as everything else.

Concretely: a new lesson `category: preference` (schema addition, not a new
pipeline), populated only from *repeatedly confirmed* patterns (the existing
confidence/breadth machinery already measures this), through `validateLesson()`
like every other lesson — no exception, per invariant #1. Injected as a small,
separately-labeled, stable-ordered header block (ties into §3.2) so it reads as "the
agent recognizes me" rather than another lesson in the pile.

### 4.2 Weekly digest becomes a ritual, not a status line
The ≤150-token weekly digest is functional and honest but not something anyone
looks forward to. Reframe it around §2's pull #1 and #3: lead with a *felt* number
("saved you ~4,200 tokens this week, caught 1 secret before commit"), not a generic
activity count. Zero additional token cost — it's the same pure aggregation over
`state/events.jsonl` the digest already does, just written to land emotionally
instead of just informationally.

### 4.3 A visual-craft pass on `raph web`
The console is functionally complete (8 tabs, one-engine-three-faces, live-verified)
but was never given a dedicated design pass. taste-skill's entire premise — AI-built
UIs look generically alike — is worth turning inward: audit the console against the
same "AI slop" patterns it warns about, once, by hand or via the `raphael-design`
agent already in the roster. This is pure craft, zero architecture change, zero
token cost (nothing here touches model calls).

### 4.4 Trust made visible at the point of action
career-ops repeats "never sends, never submits" *in the tool, at the moment it
matters*, not once in a README. Raphael's real equivalent floors (quarantine never
machine-activates; deploy/spend/sign-in always the owner's action) currently live in
CLAUDE.md/ARCHITECTURE.md. Two concrete moves: (a) when a candidate is quarantined,
the CLI/console output should say — right there, not just in docs — "this will never
auto-activate, in any mode"; (b) split the adversarial/injection-shaped check out of
the folded confidence score into its own named, visible flag in `raph why`/console
(career-ops's "Block G legitimacy check" pattern), so the security floor is
something a user *sees working*, not just something they're told exists.

### 4.5 Market `policy.js`'s task-typed model routing as a feature, not plumbing
open-notebook's "different models for chat vs. embeddings vs. TTS" is exactly what
`policy.js`'s 14 task-kind routing table already does internally. It's currently
invisible to the user. Surfacing it ("distill runs on your cheap default; security
review escalates automatically") is a zero-build, pure-positioning win — the
capability already exists and is already tested.

### 4.6 "What was considered" transparency
open-notebook visibly shows which sources are in scope before answering. Raphael's
analog: `raph why` shows what *fired*; nothing shows what was *considered but didn't
clear the bar*. A console affordance (not a new token-spending feature — purely
reading already-logged match scores) that shows the near-misses would make the
recall engine legible in the same way, and doubles as a debugging tool when a lesson
"should have" fired and didn't.

---

## 5. Reach — becoming the standard, not just a good plugin

### 5.1 AGENTS.md canonical + thin per-CLI wrappers (highest leverage for "industry standard")
This is the one idea in this document that most directly serves "industry standard."
Today Raphael's automatic injection is wired specifically to Claude Code's hook
system (`plugin/hooks/hooks.json`, SessionStart/UserPromptSubmit/PreToolUse). A
developer on Codex, OpenCode, Gemini's CLI, or Cursor gets none of it automatically.
career-ops solves the identical fragmentation problem (which agent CLI does the
user have?) with one canonical file (`AGENTS.md`) plus thin, CLI-specific wrapper
files that just import it. Raphael's `raph inject` already emits host-agnostic text
— the missing piece is packaging that output behind a canonical entry point with
thin wrappers per host CLI's own hook/convention format, instead of a single
Claude-Code-only plugin. This is a distribution/reach project, not a core-engine
change — the chokepoint, curator, and Atlas stay exactly as they are; only the
*delivery* surface widens.

### 5.2 Open skill-format compatibility for the Skills Factory
Both hermes-agent and pm-skills target the same open `agentskills.io`-style
`SKILL.md` convention. Raphael's Skill Factory already drafts `SKILL.md` files —
checking (and where needed, aligning) drafts against that open format means a
drafted skill is portable outside Raphael entirely, which is a real distribution
lever: every skill draft becomes a small piece of marketing that works even where
Raphael itself isn't installed.

### 5.3 Vendor markitdown-style extraction for `adopt`'s document legs
`adopt`'s PDF/DOCX/PPTX handling is bespoke, hand-maintained parsing logic that sits
*upstream* of the chokepoint (it's format transcoding, not lesson-writing — no
security boundary is weakened by outsourcing it). markitdown is a battle-tested,
Microsoft-maintained normalizer built exactly for this. Shelling out to (or vendoring
a slimmed subset of) it lowers Raphael's own maintenance surface for a part of the
pipeline that doesn't differentiate Raphael from anyone else — freeing effort for
the parts that do (curation, scoring, retirement).

### 5.4 Frontmatter-quality lint for Skill Factory drafts
pm-skills' entire "100+ skills without overwhelming context" answer is disciplined
frontmatter: a tight, specific trigger `description`, full detail pushed to the body.
A cheap, concrete addition to `raph lint`: flag Skill Factory drafts whose
`description` is too generic (would fire on everything) or too narrow (would never
fire) — the same failure mode pm-skills' own CLI (`validate_plugins.py`) is built to
catch, applied to Raphael's own drafts before they're ever staged.

### 5.5 Theme bundle packs beyond security
`raph pack add security` already validates the "curated theme bundle" pattern (26
lessons, one command, cold-start solved). pm-skills' 9-plugin split (install only
the domain you need) suggests doing the same for other clusters as the global brain
grows — a `testing` pack, a `performance` pack — each independently installable,
each through the same chokepoint, none forced on a user who only wants security.

---

## 6. What NOT to build (recorded, not just implied)

Two of the ten repos exist specifically because their authors *didn't* have
Raphael's structural choices available, and their existence is evidence *for*
Raphael's current bets, not a reason to copy them:

- **No embeddings/vector DB.** open-notebook needs SurrealDB (doc+graph+vector
  unified) because semantic retrieval over unstructured documents genuinely
  requires it. Raphael's Atlas — a deterministic, zero-model-token graph — exists
  precisely because coding-agent context (files, symbols, error codes, imports) is
  *structured*, and structure beats embeddings when it's available. This was
  already validated once against gstack's `gbrain` (session 10 audit); open-notebook
  is a second, independent confirmation from a completely different product
  category. Do not add a vector store to chase this trend.
- **No agent-driven, unbounded external fetch.** Agent-Reach's core value is letting
  an agent reach out and pull live content autonomously. Raphael already made the
  opposite, deliberate choice (bounded, user-initiated `adopt` fetches only,
  invariant #5). That divergence is intentional, not a gap — restated here so a
  future session doesn't "discover" this idea again and second-guess it without the
  context of why it was rejected.

---

## 7. Proposed build order (Phase 18 — draft, awaiting owner go)

Not started. Grouped by leverage-to-effort, matching how Phases 16/17 were staged.
Every milestone must ship with a token-accounting note proving the net-lower claim
still holds — that check is not optional per-milestone.

| # | Milestone | Core idea(s) | New network/token surface? |
|---|---|---|---|
| 18.1 | Cache-stable injection ordering + pointer/retrieve marginal lessons | §3.2, §3.3 | None — pure ordering/format change over existing budget |
| 18.2 | Developer profile layer (`category: preference`) | §4.1 | None — same chokepoint, same mining source |
| 18.3 | Ritual digest rewrite + `raph recall` dial | §4.2, §3.4 | None — pure presentation + existing dial pattern |
| 18.4 | Trust-at-point-of-action + named adversarial flag | §4.4 | None — surfacing existing computed data |
| 18.5 | Console visual-craft pass | §4.3 | None — no new backend calls |
| 18.6 | AGENTS.md canonical + thin CLI wrappers | §5.1 | None — repackages existing `raph inject` output |
| 18.7 | Skill Factory: open-format alignment + frontmatter lint | §5.2, §5.4 | None |
| 18.8 | `adopt` document parsing via markitdown-style extraction | §5.3 | None — same bounded-fetch surface, just a better parser downstream of it |
| 18.9 | Theme bundle packs (testing/performance/…) | §5.5 | None — same pack.js pattern |
| 18.10 | Effort-routing on lesson-match confidence + holdout-measured savings | §3.5, §3.6 | None — reuses existing policy/eval machinery |

18.6 is the one milestone that changes Raphael's *distribution* shape (multi-CLI,
not Claude-Code-only) rather than deepening the existing single-CLI experience — it
is also the one most directly aimed at "industry standard" as stated, so it may
deserve to move earlier in sequence than its position here if the owner weighs reach
over polish. That's a real trade-off, not a formatting choice, and is flagged for
the owner's call rather than decided here.

**Awaiting owner go before any code changes.** This document is the brainstorm the
owner asked for; nothing above has been built.
