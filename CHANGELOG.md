# Changelog

## 0.5.2 — 2026-07-27

The observation release. Everything here came from letting the autopilot build a
real project while watching every action, rather than from reading the code.

### Recall

- **Severity is part of the score, not just a tie-break.** `rank()` compared score
  first and consulted severity only on an exact tie, while the recency/observation
  prior awards +0.1 per mined observation. So every curated CRITICAL security
  lesson capped at 1.50 and lost every session to anything mined once at 1.60 —
  measured on a real 88-lesson brain, "inline single-call-site abstractions"
  permanently outranked "check ownership to stop IDOR" and "use parameterized
  queries". Severity now scores, gated on a real relevance signal so it can never
  drag an irrelevant lesson over a relevant one.
- **Negated text no longer matches.** A brief saying "Persistence is local files.
  No database." scored a database-hardening lesson at 5.50. Keyword hits skip
  negated occurrences, with negation bounded to its own clause.
- **A search miss says so.** `raph search` returned the highest-prior lessons,
  numbered like answers, for queries the brain knew nothing about. It now requires
  a keyword or path hit — the same rule the per-prompt gate already enforced, now
  shared from one definition.

### Autopilot

- **An interrupted stage is resumed, not discarded.** A stage that hit its time
  budget was written as "failed, 0 tokens" — while the workspace held 15 files and
  49 passing tests and 423,523 billable tokens had been spent. Timeouts now keep
  the stage resumable (bounded), and never escalate: a slower model does not fix a
  clock.
- **The deliverable is gated.** "Non-empty text" was never a completion test — it
  accepted a planner's clarifying question as a finished spec and handed it to the
  next stage as input. Every deliverable must now carry a `## DECISIONS` section.
- **The loop is told there is no human**, that deciding is its job, and that this
  never authorises a deploy or a sign-in. Decisions it makes are recorded per
  stage and shown by `raph academy status`.
- `develop` gets a measured 25-minute budget and an escalation target;
  `raph academy retry` clears a failed stage; the failure message reports what
  actually happened instead of a hardcoded "failed twice".

## 0.5.1 — 2026-07-27

Three fixes that landed after the 0.5.0 tag but were never released, found while
resuming the audit-remediation work: the version stayed at 0.5.0 in package.json while
the code moved on, so the npm package and the repo answered `0.5.0` for two different
codebases with no way to tell them apart.

- **`raph stats`'s cap line counted injections but was labeled sessions** — the number
  and its own label disagreed.
- **A `raph eval run` that never spawned an agent no longer reports a result.** A spawn
  failure, unparseable output, or a non-success envelope now throws `E-EVAL-RUN` and
  the command prints "NO MEASUREMENT TAKEN" instead of a clean-looking table of zeros.
- **Eval and doctor stop inheriting whatever model the CLI last defaulted to.**
  `raph eval run` pins `sonnet` (overridable with `--model`) instead of the interactive
  session's last pick, which had been returning HTTP 429 on a model the subscription
  doesn't cover headlessly. `raph doctor` gained a real probe — a pinned headless model
  call — so "installed" and "can actually run a model" are no longer conflated.

## 0.5.0 — 2026-07-26

The audit release. An independent fresh-eyes audit — nine auditors over disjoint
subsystems, then an adversarial pass told to *refute* every finding — produced
115 findings, 59 of them confirmed with quoted code and none refuted. This
release is the remediation: every P0, plus the P1/P2 items worth doing.
499 → 603 tests, each regression proven failing-without and passing-with.

### Correctness

- **A subscription limit is never read from the model's own answer.** The limit
  detector ran over successful output in three places, so a distilled lesson
  mentioning "rate limit" poison-pilled the distill queue permanently, and a
  security stage recommending rate-limiting — which Raphael's own security pack
  instructs — halted the autopilot. One `detectLimit()` now inspects only
  failure material.
- **A limit mid-batch no longer escapes the curator.** Lessons already activated
  in that batch used to stand having skipped the canary gate, their audit events
  and the commit, and the CLI exited 2 (crash) instead of 4 (limit).
- **Both per-prompt recall guarantees are now structural.** "Never repeated in
  one session" was a −10 score penalty any 3-keyword lesson outscored; "nothing
  fires without a trigger hit" failed at the 4.0 boundary. Both are filters now.
- **A corrupt academy checkpoint is preserved, not overwritten.** `readState`
  returned null for both "missing" and "corrupt", so a truncated state file was
  silently replaced with a blank project — destroying the milestones, log and
  dead-end list the resume design exists to protect.
- **No candidate carrying counter-indications could ever machine-activate** — a
  `.join()` on a string field, swallowed by the fail-closed catch and reported as
  a transport failure.
- Atlas extraction learned the syntax it was blind to: ESM barrels and
  re-exports, CJS object exports, TS type exports, `.jsx`/`.mts`, TS-NodeNext
  (`./x.js` → `x.ts`) and Python's dotted local imports. On this repo that is
  153 edges the old extractor could not see.

### Security

- **SSRF guard in the bounded fetcher.** "https only" is not "public": any https
  host was allowed, including private and link-local literals, and every redirect
  re-ran the same permissive check — so a public page could steer an adopt fetch
  into `169.254.169.254` or loopback. Two layers now (IP literals, and a guarded
  DNS lookup that also closes rebinding), and the localhost carve-out follows the
  origin rather than being re-granted per hop.
- **The chokepoint scans the parsed data, not just the raw file.** It was safe
  only because js-yaml happens to emit invisible characters literally; a
  hand-authored file using YAML escapes passed every gate while the decoded value
  was indexed into agent context.
- The secret scrubber caught four measured misses (compound env names like
  `DJANGO_SECRET_KEY=`, quoted multi-word values) and stopped flagging ordinary
  security prose; `SECRET_RULES` is table-driven so a new rule cannot ship
  without fixtures.
- The pre-commit guard no longer skips files whose names git quotes — a secret
  in a non-ASCII filename passed silently — and warns about anything it could
  not read instead of letting silence read as "clean".
- Episode excerpts are scrubbed **before** every truncation, closing the split-
  secret path into the model and the evidence record.
- The console got a real per-response CSP nonce (it advertised a "strict CSP"
  while allowing `unsafe-inline`), a 413 that actually reaches the client, and a
  server-side lock on the one route that spends.

### Honesty

- **The eval measures the agent, not the scaffold.** Seven of nine scenarios
  scored `task_complete` for an agent that wrote nothing, because the fixture's
  own TODO comments satisfied the checks — and one scored a *catch*. Checkers now
  judge the diff with comments stripped. Two checkers that failed the textbook-
  correct answer were fixed. Wilson intervals are printed instead of computed and
  discarded, with a Newcombe interval for the difference and a stated sample
  floor below which no significance verdict is issued.
- **The declarative canary arm now runs.** Its probes and judges existed, were
  described as the only real defense against advisory poison, and had no executor
  outside the unit tests.
- The atlas bench says what it measures: a ranked pointer list versus opening the
  candidate files, *not* "graph vs grep". The number is unchanged; the claim is
  now the one the data supports.
- README numbers agree with the router and the filesystem, and a test keeps them
  that way.

### Performance

- **The hook path went from ~390ms to ~137ms**, inside the 150ms budget
  ARCHITECTURE always claimed: ajv is compiled lazily (it was ~80% of module
  load, paid on every prompt), `verifyIndex` uses a stat fast-path, and the
  weekly digest's throttle reads a marker instead of the whole event log.
- `events.jsonl` finally has a read story — rotation plus windowed reads — so the
  cost of a hook fire no longer grows with how much the product has been used.
- `latency_ms` telemetry and the self-disable circuit breaker exist, both of
  which ARCHITECTURE had promised and neither of which had been built.

### Notes

- Atlases are re-keyed (basename + path hash) because two projects sharing a
  folder name silently served each other's graph. Existing atlases are orphaned
  and rebuild at zero token cost on the next `raph atlas` or pulse.
- Exit code 70 now means "raph itself threw"; 2 stays a deliberate policy verdict.
- The npm package no longer ships internal planning docs: 345KB, was ~800KB.
- No new dependencies. No new network surface. All six security invariants
  unchanged.

## 0.4.0 — 2026-07-25

Phase 18 complete. This release is about making the promises measurable: recall
that actually pays for itself, a memory that resists poisoning, and knowledge that
reaches beyond one CLI.

### Recall

- **Cache-stable injection ordering.** Re-ranking used to reshuffle an unchanged
  lesson set on every session, quietly invalidating the provider's prompt cache.
  Order is now pinned by lesson id — and because ids are ULIDs, which sort
  chronologically, the same set renders byte-identically while newly-learned
  lessons append at the tail instead of shuffling the block.
- **A pointer line** names lessons that ranked but did not fit, so more of the
  brain stays reachable without raising the floor spend.
- **`raph recall quiet|normal|eager`** — a recall-assertiveness dial, deliberately
  separate from `raph auto` so turning recall down can never weaken a safety gate.
- **The boundary is surfaced.** Recall now shows the mined "not when …" limit for
  lessons that carry one, so you can judge whether a lesson applies instead of
  applying it blindly. Session-start only, to keep the mid-task nudge terse.

### Trust and safety

- **`unverifiable-claim`** is now a reviewer risk kind on both the adopt and
  curator screens, closing the memory-poisoning shape where a fabricated past
  outcome is planted to be believed and reused.
- **The quarantine floor is stated in-tool**, at the moment something is
  quarantined, with each reason as its own named flag rather than one opaque
  verdict — because that is when a human decides whether to look.
- **A slopsquatting-defense lesson** ships in the security pack: AI-suggested
  package names are often invented, and attackers register them.

### Reach

- **`raph agents-md`** writes a canonical AGENTS.md, so coding CLIs that read that
  convention from the repo root get the brain with no plugin and no glue. It
  refuses to overwrite an AGENTS.md it did not write.

### Knowledge

- **Two new packs** — testing and performance — alongside security and design.
- **`preference` lessons**, with the decay policy that was blocking them: a stated
  preference does not rot with age, it dies when it is reversed.

### Craft

- **The console is token-clean.** Its colours are semantic tokens wrapped in
  `light-dark()`, and `raph guard scan --design` now passes on this repo —
  Raphael's own design lessons applied to Raphael's own UI.
- **Skill-description lint** catches the two opposite routing failures:
  descriptions too generic to mean anything, and too narrow to ever fire.
- **Effort routing** recommends a cheaper pass when a high-confidence lesson
  already covers the step — a recommendation with its reason, never a silent
  downgrade.

### Positioning

The README now names **comprehension debt** as the real cost, with fewer tokens as
the mechanism rather than the headline.

499 tests. No new dependencies, no new network surface, all six security
invariants unchanged.

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
