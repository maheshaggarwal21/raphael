# Raphael — independent fresh-eyes codebase audit

> **STATUS (2026-07-26, same day): REMEDIATED.** Every P0 item and the P1/P2
> items worth doing were fixed in Phase 21 — see `.claude/TASKS.md`. Tests went
> 499 → 603, each regression proven red-then-green, and the hook path was
> re-measured at ~137ms (from ~390ms). Four items were deliberately left, with
> reasons, at the end of the Phase 21 section. The report below is unchanged
> from the audit so the findings and the fixes can be read against each other.

**Date:** 2026-07-26 · **Target:** v0.4.0 at commit `069c5e1` (clean tree, 499 tests green) · **Scope:** the entire codebase — ~24.5k LOC across 107 source files (58 lib modules, 43 command files, 4 eval modules, cli/bin), 61 test files, the plugin, and the packaging.

---

## 0. How this audit was run (read this first)

The owner's requirement was an audit **with no preconceived notions — as if seeing Raphael for the first time**. That requirement was met structurally, not rhetorically:

- **Nine independent auditors**, each assigned a disjoint subsystem, each starting with zero knowledge of this project's history or sessions. Each was explicitly instructed: *"project docs (CLAUDE.md, README, ARCHITECTURE.md) make many claims about this code. Treat every claim as unverified marketing until you confirm it in the source."*
- **An evidence rule:** no finding was allowed without a file, a line number, and a verbatim quote of the code that proves it. Several auditors went further and ran empirical probes (executing `scrubSecrets` against crafted inputs, running eval checkers against untouched fixtures, timing module imports, checking bytes with `od`).
- **An adversarial verification pass:** every high- and medium-severity finding was handed to a *separate* verifier whose job was to **refute** it against the current code — confirmed only with a fresh verbatim quote, refuted by default.
- Total effort: 17 agents, ~2.58M tokens of reading, 537 tool calls, ~18 minutes wall clock.

**Results of verification:** 61 high/medium findings verified → **59 CONFIRMED, 2 PARTIAL (correction noted), 0 REFUTED.** Zero refutations means the evidence rule worked — nothing below is speculation. The 47 low-severity findings and the architecture area's macro analysis were not adversarially verified (by design) and are labeled as such in the appendix.

Several defects were found **independently by two auditors who could not see each other's work** (the curator E-LIMIT hole, the missing dedupe gate on the plain dial, the NUL bytes in match.js, the unbounded events log). Independent convergence is the strongest confidence signal an audit can produce.

**Headline counts:** 115 findings — **12 high, 56 medium, 47 low** (11 distinct high-severity root causes after merging one cross-area duplicate).

---

## 1. Executive summary

**The architecture survives a hostile read. The proof layer does not.**

The claims that make Raphael *Raphael* were verified true in the code by auditors told to distrust them:

- `validateLesson()` really is the only path into the brain — every write path was traced (distill, adopt, note, packs, approve, curator, dial, global-brain, eval seeds, compile-time rebuild); the only bypass is an explicitly test-only helper.
- Model containment is structural, not prompt-based: args-array spawn with no shell, adversarial prompt on stdin, API keys stripped from the child env, forced structured output.
- "One engine, three faces" is literally true for the manual review path — the console calls `approveRefs`/`rejectRefs` unchanged.
- The bounded network surface is real: one general fetcher, verified by grepping every network primitive in `src/` — with **one genuine hole in that fetcher** (SSRF, below).
- The cache-stable byte-identical injection ordering is real and non-vacuously tested.

The serious problems cluster in **four systemic themes**, not scattered randomly:

| # | Theme | What it means |
|---|-------|----------------|
| **T1** | **E-LIMIT handling is the weakest joint in the product** | The limit detector is a regex run over the model's *own successful output* in three places. A lesson that merely says "rate limit" poison-pills the distill queue forever; a security stage that recommends rate-limiting halts the autopilot; and a real limit mid-batch **bypasses the canary gate**, leaving machine-activated lessons with no audit trail and the wrong exit code. |
| **T2** | **Recall invariants are enforced by arithmetic where they should be structural** | "A headline is never repeated in one session" is actually a −10 score penalty that a 3-keyword lesson outscores. "Nothing fires without a trigger hit" fails at the 4.0 boundary (stack 3.0 + prior 1.0 = 4.0 passes). Both were proven violable with concrete probes, and the tests pin them only at lucky fixture values. |
| **T3** | **The measurement layer is the least rigorous code in the repo** — and it is the proof story | 7 of 9 eval scenario checkers report `task_complete: true` for an agent that writes *nothing* (the fixture's own TODO comments satisfy the regexes). S08 credits the word "integer" in a comment as a catch — the exact vocabulary the ON-arm injection supplies, biasing the headline lift in the product's favor by construction. Wilson CIs are computed and then never printed. Three of six canaries never execute anywhere. |
| **T4** | **Hot paths were built for a small brain and do not have a growth story** | Every prompt pays ~340ms of avoidable ajv compile at import, plus a full re-hash of every lesson file. `events.jsonl` grows forever and is fully parsed at session start. A real 64.5MB atlas file on the dev machine is JSON-parsed on *every Grep/Glob call* because the cheap once-per-session check is ordered after the expensive parse. Every one of these costs grows with exactly the adoption the product is chasing. |

Plus two standalone items that deserve headline status: **fetch.js has no SSRF defense** (a redirect to `http://127.0.0.1:9200/` or `https://169.254.169.254/` is followed — the exact class its own header claims to have bounded), and **a corrupt academy state.json is silently replaced with a blank one**, destroying the checkpoint the entire resume design exists to protect.

None of this requires an architecture change. Every high-severity fix is a small diff. That is itself evidence the architecture is right — the failures are at the joints, not the bones.

---

## 2. What is genuinely good (verified, not marketing)

An audit that only lists faults is dishonest. These held up under deliberate attack:

1. **The chokepoint invariant is real.** Traced across every writer; the compiled index re-validates every lesson at rebuild and is content-hash-verified (not mtime). A hand-tampered lesson file drops out rather than injecting.
2. **Provenance is structurally unfabricatable.** The model can only propose advisory text; ids, status, tier, and evidence records are pipeline-built. Confirmed on every path.
3. **Fail-closed reviewer verdicts are genuinely fail-closed** — transport error, malformed verdict, and no-model-available all block, and all three branches are tested.
4. **Crash-safe idempotency by construction** in the mining loop: write-last ledgers keyed by content hash; every crash path is a harmless re-run.
5. **Curator event ordering is subtle and correct** — activation events log only after the canary gate passes, so a rollback leaves no phantom audit entries. There is a test proving it.
6. **The console's security gate ordering is right** (Host → Origin → token, before any routing, fail-closed on garbage), negatively tested at unit and e2e level, with no server-side interpolation of untrusted data. The auditor checked **every render site in all eight tabs** and found no missed escape.
7. **The driver's design** — pure state machine + injected runner, state written *before* every spawn, boundary enforced by the *absence* of a deploy kind (structural, not a forgettable `if`).
8. **The test suite is largely honest**: real failure paths, regression tests with provenance (several encode real live-run bugs), an explicit anti-vacuous guard in the byte-identical test, fixture realism (six genuinely distinct curator topics with a comment explaining why).
9. **ulid.js, files.js, config.js, provenance.js are quietly correct** — no modulo bias, same-volume tmp+rename, fail-closed config parsing, torn-line-tolerant append-only ledgers.
10. **Windows-first discipline is visible everywhere** — and the suite's sandbox pattern (RAPHAEL_HOME swap per process) actually works because paths resolve lazily.

---

## 3. The eleven findings that matter most

Deduplicated, ordered by how much they undermine what the product promises. Every one is CONFIRMED with quoted evidence unless marked otherwise.

### 3.1 The E-LIMIT family — one defect, three sites *(T1)*

**(a) `provider.js:136` — a lesson about rate limiting permanently stalls the distill queue.** `parseCliResult` runs `isLimitMessage()` over stdout+stderr *before* parsing the JSON envelope. A successful extraction whose payload mentions "rate limit" — one of the most canonical mineable lessons — throws E-LIMIT, distill `break`s, the episode stays unledgered, and every future run re-hits the same poison pill. The queue never advances again; pulse records `limited: true` forever.
*Fix:* parse the envelope first; only run the limit regex on unparseable output and error envelopes (line 148 already re-checks there — the pre-parse check is the only wrong one).

**(b) `curator.js:82/156` — a real limit mid-batch bypasses the canary gate.** Found independently by two auditors. `reviewLesson` rethrows E-LIMIT and `curateStaged` has no try/catch: candidates already activated in that batch stand **without the canary gate, without `machine-curated` events, without the brain commit** — a direct violation of the module's own header contract (§11.13), and the throw propagates to exit 2 (crash) instead of the documented limit code 4 that resume logic keys on.
*Fix:* catch E-LIMIT in the loop; run the existing gate/rollback block over the partial batch; return `limited: true`; translate to exit 4 in distill/adopt.

**(c) `driver.js:226` + `eval/runner.js:72` — phantom limits from the model's own answer.** The same regex runs over the model's deliverable. A security stage that says "rate-limit the auth endpoints" — which **Raphael's own security pack instructs agents to say** — halts the pipeline as `blocked-limit`. The S21 hardening scenario's canonical answer (helmet + rate limiting) would abort an eval run.
*Fix:* detect limits from exit status and structured envelope fields, never from `envelope.result` prose.

### 3.2 `match.js:12` / `inject.js` — the "never repeated in one session" guarantee is false *(T2)*

Session dedupe is a soft −10.0 penalty, not a filter. Probe: 3 keyword hits (12.0) + stack (3.0) + prior (1.0) − 10 = 6.0 ≥ the 4.0 threshold — the same headline re-fires on every prompt of a debugging loop, and if high/critical it also bypasses the 1,200-token session cap forever. The companion invariant — "nothing fires without a trigger hit" — fails at the boundary: stack 3.0 + saturated prior 1.0 = exactly 4.0, and `<` passes equality. On the eager dial a bare stack match qualifies, silently breaking the "typical prompt = zero injected tokens" economics claim. The existing tests pin both invariants 0.2 points from their holes.
*Fix:* hard-filter injected ids before ranking; require a `keyword:`/`path:` reason on the user-prompt path (the session-start path already does exactly this — the pattern exists in the same file).

### 3.3 `scenarios.js` — the eval checkers can be gamed by doing nothing *(T3)*

Empirically probed: run each scenario's `setup()` then `check()` with **no agent in between** — S08, S15, S20, S21, S22, S30, S31 all report `task_complete: true`, and S15 reports `caught: true`, because the fixture's own `// TODO: implement logRequest(req)` satisfies the regexes. Separately, S08's catch signal (`/cents|…|integer/i`) keys on the injected lesson's own vocabulary — a wrong float implementation with the comment "TODO one day store cents as an integer" scores as caught. And two checkers bias the *other* direction: S15 marks the textbook-correct redaction pattern as a leak (it computes a `redacts` signal and then ignores it), S31 fails the modern `:focus-visible` idiom. The headline ON/OFF lift number is noisy in both directions and inflated toward the product by construction.
*Fix:* snapshot fixtures in `setup()` and judge the **diff**; strip comments before matching; better, make the JS checkers behavioral (call the produced function with adversarial inputs and assert on results). Add the one meta-test that would have caught all seven: no agent ⇒ `task_complete === false && caught === false`.

### 3.4 `harness.js:146` — the honest statistics are computed and then hidden *(T3)*

Wilson intervals are calculated for every rate and never printed. At the default 3 trials, "100% ON vs 0% OFF (+100%)" is really [44–100%] vs [0–56%] — overlapping enough that one flaky trial flips the story. The report prints the marketing number and discards the honesty the code already paid for. Three of the six canaries (the declarative-voice arm the source calls "the only real defense") are never executed by any code path. The cross-model guard is a no-op whenever a model id fails to parse — the same path every other failure takes.
*Fix:* print the intervals; pool across scenarios for the headline (n=27 supports a real interval); wire the declarative canaries through the existing scenario mechanism or delete the claim.

### 3.5 `fetch.js:53` — no SSRF defense in the one network chokepoint

`checkUrl` permits any https host — including `https://169.254.169.254` and private ranges — and re-applies the same permissive policy on every redirect hop, so a benign public page can 302 an adopt fetch into `http://127.0.0.1:9200/` (the http-loopback carve-out applies to redirect targets too). The module header claims "no downgrade via redirect"; the class it actually misses is redirect-to-internal. Content is scrubbed and reviewed as data, but the *request* reaches internal services. The fetch tests never cover this — they test the downgrade case that is handled.
*Fix:* block loopback/link-local/RFC-1918 literals and resolutions by default; restrict the loopback carve-out to the user's original URL, never a redirect target.

### 3.6 `atlas.js:350` — atlases collide by directory basename

Two projects named `app` (or `frontend`, `api`, `server`…) read and write the **same** `~/.raphael/atlas/app.json`. Nothing stores or verifies the project root, so `raph atlas where`, the session-start digest, and freshness staleness checks silently answer from the *other* project's graph, and pulse thrash-rebuilds on every alternation. This is silent wrong-answers-into-agent-context — the exact failure mode the deterministic bet is supposed to prevent.
*Fix:* key by basename + path-hash suffix; store `root` in the doc; reject on mismatch. Same fix in `inject.atlasDigestBlock` and `freshness.atlasFileLabels`, which duplicate the keying.

### 3.7 `inject.js:348` — a 64MB JSON parse on every Grep/Glob call *(T4)*

`runPreToolNudge` calls `atlasDigestBlock()` (full readFileSync + JSON.parse, no size guard) **before** the cheap `state.atlas_nudged` check. After the once-per-session nudge has fired, every subsequent Grep/Glob still pays the full parse to print nothing. Not theoretical: `~/.raphael/brain/atlas/Mahesh.json` is 64,576,298 bytes on the dev machine right now (an atlas built over the home directory).
*Fix:* reorder the two checks (one line); add a size cap; a stat-existence check suffices for the nudge's capability gate.

### 3.8 `academy.js:34` — a corrupt checkpoint is silently destroyed

`readState()` returns `null` for both "no project" and "unreadable/truncated state", and `startProject` treats null as "nothing here" and writes a fresh state over the damaged file. Probe: a state with milestones, a `tried` list, and driver records, truncated mid-byte (interrupted write, full disk), comes back as a blank project with **no warning**. This is exactly the data the resume runbook, the driver, and the Startup-folder auto-resume depend on.
*Fix:* distinguish missing from corrupt — rename to `state.json.corrupt-<ts>`, warn loudly, throw E-ACADEMY. Cheap insurance: keep `state.prev.json` before each write.

### 3.9 `validate.js:16` — ~70% of every hook's latency is avoidable ajv *(T4, measured, architect analysis)*

ajv loads and compiles the schema at module import; `inject.js → compile.js → validate.js` means **every hook fire** pays it even when `validateLesson` is never called. Measured: importing inject.js ≈ 460ms vs ≈ 120ms node baseline; ajv accounts for ~340ms — the architecture's own 150ms p95 budget is blown ~3× on every prompt before any work happens. Related: `verifyIndex` re-reads and sha256-hashes every lesson file on every prompt (linear in brain size, on Windows where small-file opens are expensive), and ARCHITECTURE.md promises a latency self-disable and `latency_ms` telemetry that **were never built** — a promised fail-safe that is absent.
*Fix:* lazy-compile the schema on first `validateLesson()` call (~10 lines, cuts hook latency ~3×); stat fast-path in verifyIndex; implement `latency_ms` or formally retract the self-disable clause. Do all this **before** ever considering a daemon.

### 3.10 The activation paths have quietly forked

Three machine-activation paths exist (plain dial, machine curator, global-brain) plus the console. The near-duplicate gate — added after a real duplicate reached the active brain — was wired into `approveRefs` and `curateStaged` but **not** `autoApproveStaged`, the path behind the arise-default "standard" dial (found independently by two auditors). Worse, **the console's adopt handler activates external material through the weak plain dial while the CLI adopt uses the full curator** — the same input gets strictly weaker governance from the console, a direct §14 violation on the highest-risk input class.
*Fix:* lift the existing ~8-line gate into `autoApproveStaged`; replace the console's `autoApproveStaged` call with the `curateStaged` call the CLI uses.

### 3.11 `curator.js:73` — no candidate with counter-indications can ever machine-activate

The schema defines `counter_indications` as a **string**; the curator calls `.join('; ')` on it. The TypeError is swallowed by the fail-closed catch and logged as "reviewer call failed" — so autopilot silently holds every lesson carrying the boundary field the extraction prompt *explicitly asks for*, and misattributes it to a transport failure. No curator fixture includes the field, so the suite can't see it. (The fail-closed catch worked as designed — and hid a functional bug for an entire class of candidates. That is the cost of fail-open/fail-closed without telemetry on *what* failed.)

---

## 4. Area-by-area verdicts

One paragraph each; full findings in the appendix.

| Area | Verdict |
|------|---------|
| **Foundation** (chokepoint, scrub, schema, files, config) | *Genuinely well-architected; the rare case where the marketing survives a hostile read.* Weaknesses are at the margins: compound secret names (`DJANGO_SECRET_KEY=…`) escape both the keyword rule and the letters-blind entropy net (empirically proven); the text gates scan only the raw serialization and are safe today partly because js-yaml *happens* to emit invisible unicode literally — an undocumented third-party behavior a core security control silently depends on; `atomicWrite` has no fsync so its "never a half-written lesson" comment overclaims; the E-BASE64 gate has **zero tests anywhere**. |
| **Learning loop** (mine → distill → curator → pulse) | *Better than its marketing in places (containment, provenance, crash-safety all hold); one systemic weak joint: E-LIMIT (§3.1).* Also: episode excerpts are truncated **before** scrubbing in four places — violating the scrub-order invariant stated in the module's own comment (a split AWS key matches neither the named rule nor the entropy net, then goes to the network); the error-fix detector accepts *any* later successful tool as the "fix" (a failed `npm test` + a successful `Read` = an episode); the pulse lock's 30-min stale window is shorter than a worst-case pulse and the steal is a TOCTOU race. |
| **Recall** (compile, match, inject) | *Honest and unusually explainable — real reason strings, real byte-stability, consistent fail-open. But both headline invariants are provably violable (§3.2), and the hot path has no input-size defenses (§3.7, T4).* Plus: `verifyIndex` never re-validates the lesson *entries* it injects — editing a headline inside compiled.json while leaving `built_files` intact passes verification and injects attacker-chosen text, which the threat-model comment misrepresents. And the core scorer file contains literal NUL bytes, so git classifies `match.js` as **binary** — no diffs, no blame, no PR review for the most safety-relevant retrieval logic in a public repo. |
| **Atlas** | *The engineering shell is genuinely good (pure, bounded, deterministic, honest confidence taxonomy). The extraction core has systematic, empirically confirmed blind spots for the most common modern idioms:* barrels/re-exports produce **nothing**, TS-NodeNext `./x.js`→`x.ts` and `.jsx` never resolve (entire import/tests layers vanish silently for React/modern-TS repos), CJS object exports are invisible, Python local imports become fake package nodes. The 0.95 "certain" call edges never check imported binding names (a locally shadowed function gets a confidently wrong edge). The bench prices the baseline as reading whole files — the 147.9× headline measures "pointer list vs reading 8 files end-to-end," not "graph vs grep," and stats republishes it without the caveat. The test suite only feeds the regexes syntax they already handle. |
| **Governance & network** | *Strong where it matters (single fetch chokepoint verified by grep, fail-closed reviewers, layered global-brain integrity) — with one real hole (SSRF §3.5) and consistency drift across the three activation paths (§3.10).* Also: the pre-commit guard silently skips staged files whose names git quotes (non-ASCII filenames evade the secret scan — fix with `-z`); the global-brain sync bumps its version even when lessons failed hash verification, permanently stranding them until the owner cuts a new manifest. |
| **Web console** | *Security architecture sound for its threat model; every render site audited, no missed escape found.* But: the CSP allows `unsafe-inline` scripts while comments claim "strict CSP" — a per-response nonce costs ~4 lines and would make any future escaping slip inert; the only XSS test exercises an exported `escapeHtml()` that **production never calls** (the real inline `esc()` is untested); the 630-line single template literal is past break-even with a documented backtick-landmine history — extracting to a static asset read at startup keeps zero deps and makes the client code lintable; no server-side lock on the spending route (two tabs = double adopt spend). |
| **Agents, driver, eval** | *The roster/driver/policy structure is right — pure state machine, policy table, boundary-by-absence, staged-never-installed. The measurement layer is the least rigorous code in the area (§3.3–3.4).* Also: nothing enforces that `plugin/agents/*.md` matches `agents.js` (in sync today by luck + discipline — verified by re-rendering all 12); the documented "one escalated retry" never happens on the default pipeline (only `debug` has an escalate row, and `debug` isn't in the pipeline) while the CLI falsely reports "failed twice"; a failed driver is unrecoverable without hand-editing state.json; **18.7's skill lint and 18.10's effort router have no production callers** — tested library code nothing can reach, despite being recorded as shipped. |
| **CLI & test suite** | *A genuinely strong suite that mostly lives up to the stated standard — 16 files sampled, real failure paths, regression provenance, honest e2e tests.* Lapses: pulse tests hit the **live network** through the one un-stubbed seam (`syncGlobalBrain` — real HTTPS GETs to github in five tests, activating the real global brain into sandboxes when online); zero tests for the CLI router or the two token-spending runners (both take injectable `spawn` precisely to be testable — the phantom-E-LIMIT bug lives exactly there); exit code 2 means both "crash" and "policy verdict"; `--max-episodes 0/typo` fails **open** (spends on everything) on the one flag whose job is bounding spend; ~12 hand-copied .md tree walkers, duplicated `readStdinJson`, four flag-parsing conventions across 19 files while `util.parseArgs` sits unused in the stdlib. |
| **Architecture (macro)** | *"An unusually coherent architecture with real discipline; its weaknesses are operational, not conceptual."* See §5. Biggest 12-month risk: the entire learning loop, autopilot, adopt, and eval sit on the **unversioned claude CLI contract** — flags trusted blindly (`--tools ""` never verified at runtime), an undocumented envelope shape (already bit once), and regex-scraped limit prose — while `raph update` keeps Raphael current, so version skew is guaranteed. Best decision: the chokepoint + index-as-write-path + pipeline-built evidence. |

---

## 5. The nine macro decisions — alternatives compared

The architect auditor evaluated each foundational choice against its real alternatives. Verdicts:

| Decision | Alternative considered | Verdict |
|----------|------------------------|---------|
| Markdown-per-lesson + compiled JSON index | SQLite / embedded DB | **KEEP.** At the design's own target (150–300 lessons), inspectability, git history, and hand-editability *are* the trust story; hash-verified rebuild-through-the-chokepoint makes the derived index tamper-safe. Revisit only if lesson count 10×'s. |
| Deterministic lexical retrieval | Embeddings / hybrid | **KEEP.** Zero tokens, `raph why` is real explainability, and the `rank()` seam is clean for a later hybrid. Substring matching misses synonyms — but the retrieval-miss metric exists to *detect* that, which is the honest way to defer the decision. |
| Fresh process per hook | Warm daemon / in-process | **KEEP THE SHAPE, fix the waste.** Fail-open + zero lifecycle + Windows-safe is right; but ~70% of current latency is avoidable ajv import (§3.9). Fix that and the stat fast-path first; a daemon is only justified if post-fix p95 still exceeds 150ms. |
| Two-dependency policy (ajv + js-yaml) | Take more deps | **KEEP THE POLICY, fix the execution.** The tiny supply chain is a marketed property. But the policy is producing hand-rolled duplication where the *stdlib* already helps: `util.parseArgs` (in core since 18.3) vs 19 hand-parsed command files; static asset files vs the backtick-forbidden mega-literal. Stdlib + small internal utils, not new deps. |
| Model via claude CLI shell-out | Anthropic SDK | **KEEP** (fixed-price subscription economics is decisive for the target user; containment-by-flags is a clever reuse) — but this is where the biggest 12-month risk lives. Add: a doctor/pulse probe asserting the load-bearing flags still exist, a runtime no-tool-artifacts assertion on envelopes, and a distinct E-CLI-DRIFT code so autopilot stops retrying and says so. |
| Single npm package (CLI + plugin + seed) | Split packages | **KEEP.** Zero-network cold start from the packaged global-brain seed is genuinely good design. One real cost: the `files` whitelist ships **396KB of internal docs** — including the owner's marketing/interview handbook and superseded planning docs — to every install. Narrow it to the four user-facing docs. |
| ~43 flat verbs | git-style grouped subcommands | **KEEP (stop adding).** Domains that warrant grouping already have it (academy/adopt/guard/pack/contribute). A regroup would churn every doc for marginal gain — but decide the convention now; injection control alone spans five top-level verbs (`on`, `off`, `recall`, `why`, `inject`), and `raph off` reads like "turn Raphael off" when it only silences injection. |
| Flat src/lib (58 modules) | Explicit layers | There **is** an implicit layering (foundation → store → domains → faces) and it is respected everywhere **except one real inversion**: `pulse.js` (lib) imports command modules, drives them with synthetic argv, and infers results by diffing ledger line counts. Extract mine/distill engines to lib (the codebase already did exactly this for review/autoapprove — its own proven pattern) before the module count passes ~70. |
| Append-only JSONL telemetry | DB / rotating logs | **KEEP the write model** (crash-safe, lock-free, auditable) — it has **no read-path story**: no rotation anywhere, hot paths parse the whole file (§T4). Month-segmented files + windowed reads, or pulse-time compaction. |

---

## 6. Test-suite verdict

**Grade: strong, with specific holes exactly where the money and the invariants are.**

What holds: sampled 16 files across the central libs — real failure-path coverage (malformed verdicts, corrupt indexes, foreign hooks, hostile origins, throttle/offline paths), regression tests with provenance, dependency-injected seams nearly everywhere, honest e2e (real HTTP server, real bin spawn with garbage stdin), realistic fixtures.

What doesn't:

1. **The suite certifies invariants at lucky interior values** — the trigger-hit test passes because the fixture has `observations: 3` (score 3.8 < 4.0); at `observations: 5` the identical setup scores 4.0 and the invariant fails. Boundary values are where invariants live; pin them there.
2. **Zero coverage of the E-LIMIT control flow** through `distillEpisodes` and `curateStaged` — the most operationally important behavior in the product, currently proven only by narrative.
3. **Zero tests for the two token-spending runners** despite both taking injectable `spawn` for exactly that purpose — the phantom-limit bug lives there.
4. **Zero tests for the CLI router** — nothing proves all 43 lazy import paths even resolve.
5. **Pulse tests touch the live network** (un-stubbed `syncGlobalBrain`).
6. **Two tests test dead code as if it were the defense**: web's `escapeHtml` (production never calls it) and inject's Bash-grep detection (the shipped matcher never sends Bash events).
7. Coverage gaps on the security primitives themselves: E-BASE64 untested anywhere, 6 of 10 secret rules unexercised, `isHighEntropyToken` untested, fetch's SSRF surface untested.

The standard in CLAUDE.md ("success + failure + edge for every function; regressions proven red-then-green") is real and mostly followed — the gaps above are where it was skimmed, and three of them (limit flow, spend runners, eval checkers) are precisely where skimming is most expensive.

---

## 7. Code quality, reuse, and optimization summary

- **Duplication (worst offenders):** the recursive ".md lesson walker" is independently implemented ~12 times (status, doctor, show, validate, compile, review ×3, freshness, globalbrain, autoapprove, web ×2); `readStdinJson` is byte-identical in two commands; 19 command files hand-parse argv with four different value-taking conventions; the atlas extension list exists in three places. One shared walker + one 30-line `lib/args.js` over `util.parseArgs` removes whole bug classes (e.g. `raph note "..." --category --severity high` currently stores `--severity` as the category).
- **Layering:** one genuine inversion (pulse→commands, §5). `distill.js` and `mine.js` are the last two commands holding engine logic; the repo's own review.js extraction is the template.
- **Dead code shipped as features:** `lintSkillDescription` (18.7) and `routeEffortWithLessons` (18.10) have no production callers — recorded as shipped, reachable only from their own tests. Wire them or pull the claim. Also: `raph map` writes an artifact nothing reads (superseded by atlas); the Bash-grep branch and its test; the `'::1'` LOOPBACK_HOSTS entry; `designer` in the schema enum (guarded by a test still titled "10-agent roster").
- **Hot-path waste, in fix order:** lazy ajv (~340ms/prompt, ~10 lines); reorder the atlas nudge check (one line); stat fast-path in verifyIndex; digest throttle to a marker file (removes readEvents from the hook path entirely); split the atlas doc (graph / extraction cache / pre-rendered digest); buildIndex reads+hashes each file 3× and loadIndex re-parses the JSON it just wrote.
- **Source hygiene:** two literal 0x00 bytes in `match.js` make git treat the core scorer as a **binary file** — no diffs, no blame, no review in a public repo. Replace with `' '` escapes (byte-identical semantics) and lint control bytes in src.

---

## 8. Prioritized punch list

**P0 — correctness/security, small diffs, before the next release:**
1. E-LIMIT family: envelope-first parsing (provider), limit-safe `curateStaged` + exit 4, structural limit detection in driver/eval runner. *(§3.1)*
2. Hard session-dedupe filter + structural trigger-hit requirement on the user-prompt path. *(§3.2)*
3. fetch.js: private-IP/link-local/loopback guard; carve-out never applies to redirect targets. *(§3.5)*
4. Atlas identity: path-hash key + stored/verified root (also in inject + freshness). *(§3.6)*
5. Reorder `atlas_nudged` before the parse + size-cap `atlasDigestBlock`. *(§3.7)*
6. `readState` corrupt ≠ missing: rename + warn + E-ACADEMY. *(§3.8)*
7. Near-dup gate into `autoApproveStaged`; console adopt → `curateStaged`. *(§3.10)*
8. `counter_indications` string fix + fixture. *(§3.11)*
9. Scrub-before-truncate at the four episode sites; kv-secret compound names + quoted values; `dec_` id exemption.
10. Guard: `-z` file lists (quoted-path evasion) + warn on unreadable staged blobs.

**P1 — the proof story and the growth story:**
11. Eval checkers: diff-based/behavioral + the no-agent meta-test; fix S15/S31 reverse bias; print Wilson CIs (pool for the headline); wire or remove the declarative canaries; per-rule chokepoint canaries + a paraphrase corpus.
12. Lazy ajv; stat fast-path verifyIndex; events.jsonl segmentation + windowed reads; digest marker file; `latency_ms` telemetry + implement-or-retract the self-disable clause.
13. Generated-agents byte-equality test (or generate at prepack); driver plain-retry vs escalate split + `--retry/--reset`; academy state → consider append-only jsonl.
14. Wire 18.7 + 18.10 into their commands, or correct the record.
15. CLI-drift hardening: doctor probe for load-bearing claude flags, envelope tool-artifact assertion, E-CLI-DRIFT code; Windows claude.cmd/PATH resolution beyond the default npm prefix.
16. Scan parsed data alongside raw content in the chokepoint gates (close the js-yaml-emission dependency); `\p{Cf}` unicode class; table-driven SECRET_RULES tests incl. E-BASE64.

**P2 — structure and hygiene:**
17. Extract mine/distill engines to lib; pulse consumes structured results.
18. Console: static-asset extraction + CSP nonce + shared/tested `esc()`; 413-before-destroy; in-flight lock on /api/adopt.
19. Shared lesson walker; `lib/args.js`; NUL-byte escapes in match.js + control-byte lint; distinct crash exit code + documented exit table; `--max-episodes` fail-closed.
20. Atlas extraction: re-export/CJS/NodeNext/.jsx/Python-dotted patterns + adversarial fixtures + truncation flag; bench baseline renamed or re-priced as real grep output.
21. Doc/number drift: README's contradictory counts (499 vs 415 tests, 44 vs 41 verbs), doctor's pre-launch install string, arise's stale pack count, narrow the npm `files` whitelist.

---

## 9. Honesty box

- The auditors ran inside this machine's environment, so CLAUDE.md was present in their context; the counterweight was the explicit treat-docs-as-unverified instruction and the quote-the-code evidence rule, plus the independent refute-by-default verification pass. 0 of 61 verified findings were refuted.
- Low-severity findings (47) and the architecture area's macro analysis (13) were **not** adversarially verified; treat those as strong hypotheses with quoted evidence, not confirmed defects.
- Two findings were corrected in verification (marked PARTIAL): the scrub-rule count (10 rules, 6 untested — slightly *worse* than claimed) and the canary gate (all three canaries are hard-rejected as well as quarantined — the coverage criticism stands, the "none is a hard reject" fragment was wrong).
- This audit reads code and probes functions; it does not replace the Phase 10 self-use run (real-world behavior over weeks) or a red-team exercise against a live install.
- Finding 18.7/18.10 dead ("shipped" with no production caller) is a defect in the *previous session's own work* recorded by this project as complete. It is reported here with the same weight as everything else.

---

## Appendix A — complete findings index (115)

Verdicts: CONFIRMED/PARTIAL = adversarially verified against current code; *analysis* = architecture-area macro assessment (unverified by design); *unverified (low)* = below the verification threshold.

| # | Sev | Verdict | Area | Kind | Finding | Where |
|---|-----|---------|------|------|---------|-------|
| 1 | high | CONFIRMED | agents-eval | flaw | Eval `task_complete` is satisfied by the fixture's own TODO comments — a do-nothing agent scores 'complete', and on S15 scores 'caught' | `src/eval/scenarios.js:115` |
| 2 | high | CONFIRMED | agents-eval | flaw | S08's 'caught' signal keys on the injected lesson's own vocabulary, systematically inflating the brain-ON arm | `src/eval/scenarios.js:77` |
| 3 | high | CONFIRMED | agents-eval | flaw | Phantom E-LIMIT: the limit detector is run over the model's own answer, so a stage that recommends rate limiting halts the pipeline | `src/lib/driver.js:226` |
| 4 | high | CONFIRMED | agents-eval | flaw | A corrupt academy state.json is silently replaced with a blank one, destroying the checkpoint the whole resume design exists to protect | `src/lib/academy.js:34` |
| 5 | high | analysis | architecture | optimization | Every hook fire pays ~340ms of avoidable ajv load+compile at module import | `src/lib/validate.js:16` |
| 6 | high | CONFIRMED | atlas | flaw | Atlas cache keyed by directory basename — cross-project collision serves wrong graphs silently | `src/lib/atlas.js:350` |
| 7 | high | CONFIRMED | cli-tests | flaw | E-LIMIT mid-curation escapes distill/adopt: wrong exit, canary gate and audit log skipped for already-activated lessons | `src/lib/curator.js:82` |
| 8 | high | CONFIRMED | governance | security | fetch.js has no SSRF defense: redirects and https private IPs reach internal/loopback services | `src/lib/fetch.js:53` |
| 9 | high | CONFIRMED | learning-loop | flaw | Limit-detection regex scans successful model output — a lesson mentioning 'rate limit' permanently stalls the distill queue | `src/lib/provider.js:136` |
| 10 | high | CONFIRMED | learning-loop | flaw | E-LIMIT mid-batch in curateStaged bypasses the canary gate and leaves unaudited active lessons | `src/lib/curator.js:156` |
| 11 | high | CONFIRMED | recall | flaw | Session dedupe is a soft -10 penalty a keyword-rich lesson outscores; the 'never repeated' invariant is false | `src/lib/match.js:12` |
| 12 | high | CONFIRMED | recall | flaw | Unbounded atlas JSON parse in the hook hot path, with the once-per-session check ordered after it | `src/lib/inject.js:348` |
| 13 | medium | CONFIRMED | agents-eval | gap | Nothing enforces that plugin/agents/*.md matches agents.js — the generated files can silently drift | `scripts/build-agents.mjs:17` |
| 14 | medium | CONFIRMED | agents-eval | flaw | The documented 'one escalated retry' never happens on the default pipeline, and the CLI reports 'failed twice' when the stage ran once | `src/lib/driver.js:33` |
| 15 | medium | CONFIRMED | agents-eval | gap | A failed driver is unrecoverable from the CLI — the only fix is hand-editing state.json | `src/lib/driver.js:53` |
| 16 | medium | CONFIRMED | agents-eval | gap | Three of the six canaries are never executed by any code path, while the source claims they run under `raph eval run` | `src/eval/canaries.js:14` |
| 17 | medium | CONFIRMED | agents-eval | wrong-decision | The eval report prints point estimates from 3 trials and throws away the confidence intervals it computed | `src/eval/harness.js:146` |
| 18 | medium | CONFIRMED | agents-eval | wrong-decision | AGENTS.md selects which lessons to inline by ULID (creation) order, not by rank — the opposite of what inject.js does | `src/lib/agentsmd.js:63` |
| 19 | medium | CONFIRMED | agents-eval | flaw | Two scenario checkers mark the textbook-correct implementation as NOT caught, and one computes a `redacts` signal it never uses | `src/eval/scenarios.js:123` |
| 20 | medium | CONFIRMED | agents-eval | gap | The cross-model comparison guard is a no-op whenever a model id is missing — which is the default path | `src/eval/harness.js:28` |
| 21 | medium | CONFIRMED | agents-eval | test-quality | Zero tests for the two token-spending runners, despite both taking an injectable `spawn` | `test/eval.test.js:8` |
| 22 | medium | PARTIAL | agents-eval | test-quality | The 100% canary gate is three phrasings of ONE chokepoint rule, and never probes a paraphrase that avoids the deny list | `src/eval/canaries.js:51` |
| 23 | medium | CONFIRMED | agents-eval | code-quality | 18.7 skill-description lint and 18.10 effort routing have no production callers — tested library code nothing can reach | `src/lib/policy.js:173` |
| 24 | medium | analysis | architecture | gap | The claude-CLI contract (flags, envelope, limit strings) is load-bearing but unversioned and unverified | `src/lib/provider.js:63` |
| 25 | medium | analysis | architecture | gap | events.jsonl is unbounded and fully parsed in hot paths — no rotation anywhere | `src/lib/events.js:17` |
| 26 | medium | analysis | architecture | wrong-decision | pulse.js inverts the layering: a lib module drives CLI command modules with synthetic argv and scrapes side effects for results | `src/lib/pulse.js:141` |
| 27 | medium | analysis | architecture | flaw | Windows claude-binary resolution only works for the default npm prefix; the 'claude' fallback cannot spawn .cmd shims | `src/lib/provider.js:39` |
| 28 | medium | analysis | architecture | code-quality | The web console is a ~630-line single template literal with a standing 'no backticks' landmine | `src/lib/web.js:366` |
| 29 | medium | analysis | architecture | doc-drift | ARCHITECTURE.md promises a latency self-disable and latency_ms telemetry that were never built | `ARCHITECTURE.md:373` |
| 30 | medium | CONFIRMED | atlas | flaw | Bench baseline strawmans grep-and-read by pricing whole-file reads; inflated ratio is republished without the caveat | `src/lib/atlas.js:590` |
| 31 | medium | CONFIRMED | atlas | flaw | 0.95 'certain' call edges never check the imported binding names — local shadowing produces confidently wrong edges | `src/lib/atlas.js:256` |
| 32 | medium | CONFIRMED | atlas | gap | resolveImport misses .jsx/.mts/index variants and TS-NodeNext '.js'→'.ts' mapping; unresolved relative imports vanish silently | `src/lib/atlas.js:178` |
| 33 | medium | CONFIRMED | atlas | gap | Export extraction is blind to ESM re-exports/barrels, CJS object exports, and TS type exports | `src/lib/atlas.js:107` |
| 34 | medium | CONFIRMED | atlas | flaw | Python local imports become fake external package nodes; Python can never get import/tests edges | `src/lib/atlas.js:174` |
| 35 | medium | CONFIRMED | atlas | flaw | Staleness lint checks every active lesson against the cwd project's atlas regardless of lesson scope — cross-project false STALE | `src/commands/lint.js:15` |
| 36 | medium | CONFIRMED | atlas | optimization | One JSON doc carries graph + full extraction cache; hot injection paths parse all of it every session | `src/lib/atlas.js:374` |
| 37 | medium | CONFIRMED | atlas | test-quality | Extraction tests only feed the regexes syntax they already handle — the blind spots are structurally untestable | `test/atlas.test.js:44` |
| 38 | medium | CONFIRMED | cli-tests | flaw | `raph distill --max-episodes` fails open: 0, a typo, or a missing value silently means ALL episodes | `src/commands/distill.js:40` |
| 39 | medium | CONFIRMED | cli-tests | test-quality | Pulse tests hit the live network: syncGlobalBrain is the one un-stubbed seam | `test/pulse.test.js:33` |
| 40 | medium | CONFIRMED | cli-tests | code-quality | eval.js duplicates the per-prompt injection policy as a hand-maintained mirror | `src/commands/eval.js:31` |
| 41 | medium | CONFIRMED | cli-tests | code-quality | lib/pulse.js drives the pipeline through command modules and infers results by diffing file/line counts | `src/lib/pulse.js:141` |
| 42 | medium | CONFIRMED | cli-tests | gap | Exit code 2 means both 'crash' and 'legitimate policy verdict' | `bin/raph.js:8` |
| 43 | medium | CONFIRMED | cli-tests | test-quality | No tests exist for the CLI router or bin exit mapping | `src/cli.js:172` |
| 44 | medium | CONFIRMED | cli-tests | reusability | Ten hand-copied recursive .md walkers and two identical readStdinJson implementations | `src/commands/status.js:9` |
| 45 | medium | CONFIRMED | console | test-quality | The only XSS-escaping test exercises dead code, not the escaper the page actually uses | `test/web.test.js:57` |
| 46 | medium | CONFIRMED | console | security | CSP allows 'unsafe-inline' scripts while comments claim 'strict CSP' — a per-response nonce is free and would neutralize any escaping slip | `src/lib/web.js:1020` |
| 47 | medium | CONFIRMED | console | wrong-decision | 630-line client application embedded in one server-side template literal — past break-even, with documented backtick near-misses | `src/lib/web.js:366` |
| 48 | medium | CONFIRMED | console | gap | No server-side serialization of mutating routes — the adopt busy-guard exists only in page JS, and /api/auto does an unlocked read-modify-write of config | `src/lib/web.js:1145` |
| 49 | medium | CONFIRMED | foundation | flaw | kv-secret rule misses compound secret env names; entropy net blind to letters-only passwords | `src/lib/scrub.js:23` |
| 50 | medium | CONFIRMED | foundation | flaw | Chokepoint text gates scan only the raw serialization; correctness depends on js-yaml emitting invisible unicode literally | `src/lib/validate.js:73` |
| 51 | medium | CONFIRMED | foundation | flaw | atomicWrite has no fsync — the 'crash can never leave a half-written lesson' claim is overstated | `src/lib/files.js:12` |
| 52 | medium | PARTIAL | foundation | test-quality | E-BASE64 gate untested anywhere; half the secret rules and isHighEntropyToken have zero tests | `test/scrub.test.js:1` |
| 53 | medium | CONFIRMED | governance | gap | The plain dial (autoApproveStaged) has no near-duplicate gate — machine-activates re-worded duplicates | `src/lib/autoapprove.js:210` |
| 54 | medium | CONFIRMED | governance | wrong-decision | Console adopt bypasses the machine curator that the CLI adopt uses | `src/lib/web.js:336` |
| 55 | medium | CONFIRMED | governance | flaw | Pre-commit guard silently skips staged files whose names git quotes (evasion) | `src/lib/guard.js:179` |
| 56 | medium | CONFIRMED | governance | flaw | Global-brain down-sync strands lessons that fail hash/partial-fetch by bumping the version anyway | `src/lib/globalbrain.js:182` |
| 57 | medium | CONFIRMED | learning-loop | flaw | Reviewer prompt calls .join() on counter_indications, which the schema defines as a string — every such candidate is held with a misleading 'reviewer call failed' | `src/lib/curator.js:73` |
| 58 | medium | CONFIRMED | learning-loop | security | Episode excerpts are truncated BEFORE scrubbing in four places, violating the module's own stated scrub-order invariant | `src/lib/episodes.js:246` |
| 59 | medium | CONFIRMED | learning-loop | gap | The plain auto-approve dial (the 'standard' default) has no near-duplicate gate — the exact bug class fixed on the other two activation paths | `src/lib/autoapprove.js:214` |
| 60 | medium | CONFIRMED | learning-loop | flaw | Pulse lock stale window (30 min) is shorter than a worst-case pulse, and the stale-steal is a non-atomic read-check-write | `src/lib/pulse.js:71` |
| 61 | medium | CONFIRMED | learning-loop | gap | Error-fix detector accepts ANY later successful tool_result as the 'fix' — unrelated tools count | `src/lib/episodes.js:231` |
| 62 | medium | CONFIRMED | learning-loop | test-quality | Untested E-LIMIT control flow: distill's break-and-preserve and the curator's mid-batch limit have zero coverage | `test/distill.test.js:189` |
| 63 | medium | CONFIRMED | recall | flaw | Prompt threshold 4.0 is reachable with zero trigger hits — 'nothing fires without a trigger hit' is false at the boundary | `src/lib/inject.js:432` |
| 64 | medium | CONFIRMED | recall | security | verifyIndex never verifies the lessons it injects — a tampered compiled.json with intact built_files injects unvalidated text | `src/lib/compile.js:97` |
| 65 | medium | CONFIRMED | recall | gap | events.jsonl grows forever and is fully read+parsed on every autopilot session start | `src/lib/inject.js:289` |
| 66 | medium | CONFIRMED | recall | optimization | Every prompt pays a fresh ~300ms node process plus a full re-hash of every lesson file | `src/lib/compile.js:106` |
| 67 | medium | CONFIRMED | recall | code-quality | Literal NUL bytes in match.js make git treat the core scorer as a binary file | `src/lib/match.js:21` |
| 68 | medium | CONFIRMED | recall | test-quality | Tests certify the two headline invariants only at lucky fixture values — both invariants are actually violable | `test/inject.test.js:93` |
| 69 | low | unverified (low) | agents-eval | code-quality | Generated roster snippet interpolates tool names into JS source unescaped, while every neighbouring field is JSON.stringify'd | `src/lib/agentmaker.js:49` |
| 70 | low | unverified (low) | architecture | doc-drift | README's own numbers contradict each other (499 vs 415 tests, 44 vs 41 verbs, 54 vs 58 modules) | `README.md:829` |
| 71 | low | unverified (low) | architecture | reusability | 19 command files each hand-parse argv while Node's built-in util.parseArgs goes unused | `src/commands/inject.js:25` |
| 72 | low | unverified (low) | architecture | code-quality | The PreToolUse Bash-grep detection path is dead in the shipped plugin | `src/lib/inject.js:337` |
| 73 | low | unverified (low) | architecture | code-quality | npm package ships 396KB of internal docs including the owner's marketing/interview handbook | `package.json:17` |
| 74 | low | unverified (low) | architecture | flaw | globToRegex corrupts trigger-path patterns containing literal spaces | `src/lib/match.js:21` |
| 75 | low | unverified (low) | architecture | optimization | verifyIndex re-hashes every lesson file on every index read, in the per-prompt hot path | `src/lib/compile.js:106` |
| 76 | low | unverified (low) | atlas | gap | `raph atlas where` serves an arbitrarily stale atlas; git freshness is keyed to HEAD so uncommitted work is invisible | `src/commands/atlas.js:38` |
| 77 | low | unverified (low) | atlas | flaw | whereQuery path matching uses unanchored endsWith — 'a.js' matches 'schema.js' and makes two conditions dead code | `src/lib/atlas.js:459` |
| 78 | low | unverified (low) | atlas | flaw | Freshness regexes false-fire: '2048' flagged as a year, '3:1' flagged as a line-number pointer | `src/lib/freshness.js:30` |
| 79 | low | unverified (low) | atlas | gap | Silent truncation at MAX_FILES=4000 and depth>8; oversized files fully read before being discarded | `src/lib/atlas.js:63` |
| 80 | low | unverified (low) | atlas | code-quality | Dead branches and duplicate conditions in freshness.js | `src/lib/freshness.js:247` |
| 81 | low | unverified (low) | atlas | doc-drift | Obsidian index note misdescribes truncation as 'largest files' when the cap keeps the first N alphabetically | `src/lib/obsidian.js:183` |
| 82 | low | unverified (low) | cli-tests | wrong-decision | `raph map` writes an artifact nothing reads; superseded by atlas but still shipped as a parallel verb | `src/commands/map.js:1` |
| 83 | low | unverified (low) | cli-tests | flaw | guard scan exit semantics are inconsistent: silent success in a non-repo, and 'advisory' --design hard-fails | `src/commands/guard.js:128` |
| 84 | low | unverified (low) | cli-tests | doc-drift | Stale user-facing strings: wrong npm package name in doctor's fix, stale pack count in arise, stale mode enum in the default config | `src/commands/doctor.js:85` |
| 85 | low | unverified (low) | cli-tests | wrong-decision | Flat 43-verb namespace with inconsistent grouping; injection control alone spans five verbs | `src/cli.js:93` |
| 86 | low | unverified (low) | cli-tests | test-quality | validate.test.js pins a stale '10-agent roster' and the schema silently keeps a deprecated 'designer' alias untested | `test/validate.test.js:86` |
| 87 | low | unverified (low) | console | flaw | Oversized request body yields a connection reset, never the promised E-WEB-BODY 400 (and the 64KB cap is untested) | `src/lib/web.js:92` |
| 88 | low | unverified (low) | console | reusability | statusSummary re-implements lesson counting — including a second auto-tier counter in the same file — contradicting the 'zero business logic' rule | `src/lib/web.js:127` |
| 89 | low | unverified (low) | console | security | Session token persists in the URL, browser history, and the Windows process command line for the console's lifetime | `src/lib/web.js:431` |
| 90 | low | unverified (low) | console | flaw | Ctrl+C can hang on Node 18: server.close() waits for the browser's idle keep-alive socket | `src/commands/web.js:61` |
| 91 | low | unverified (low) | console | code-quality | adoptionsView scrubs the serialized JSON string and re-parses it — coupling scrubber regexes to JSON syntax | `src/lib/web.js:299` |
| 92 | low | unverified (low) | console | code-quality | Dead '::1' entry in LOOPBACK_HOSTS — unreachable through both the Host and Origin paths | `src/lib/web.js:46` |
| 93 | low | unverified (low) | console | test-quality | /api/guard/hook success and 409 paths have zero route-level coverage | `test/web.test.js:349` |
| 94 | low | unverified (low) | foundation | flaw | Bearer rule false-positives on prose, and E-SECRET turns that into a hard reject of legitimate lessons | `src/lib/scrub.js:16` |
| 95 | low | unverified (low) | foundation | code-quality | RAPHAEL_ID_RE exemption list drifted: dec_ ids are scrubbed as high-entropy secrets | `src/lib/scrub.js:43` |
| 96 | low | unverified (low) | foundation | gap | counter_indications is injected into agent context but excluded from the imperative-voice quarantine | `src/lib/validate.js:89` |
| 97 | low | unverified (low) | foundation | code-quality | Dead 'designer' value in scope.agents enum, enshrined by a stale test | `src/schemas/lesson.schema.json:88` |
| 98 | low | unverified (low) | foundation | gap | UNICODE_RE misses the most common invisible bidi characters (U+200E/200F) and other format chars | `src/lib/validate.js:36` |
| 99 | low | unverified (low) | foundation | gap | commitBrain can hang indefinitely on interactive git config (GPG signing, hooks) | `src/lib/braingit.js:14` |
| 100 | low | unverified (low) | foundation | code-quality | Raw NUL bytes embedded in match.js source make the file invisible to text tooling | `src/lib/match.js:21` |
| 101 | low | unverified (low) | foundation | gap | UTF-8 BOM breaks frontmatter parsing with a misleading error | `src/lib/frontmatter.js:3` |
| 102 | low | unverified (low) | governance | reusability | Duplicated brain-tree walkers across the governance modules | `src/lib/review.js:69` |
| 103 | low | unverified (low) | governance | gap | Contribution bundles include machine/auto-tier lessons that no human ever reviewed | `src/lib/contribute.js:127` |
| 104 | low | unverified (low) | governance | security | Self-update trusts the registry version field without authenticating the response identity | `src/lib/update.js:60` |
| 105 | low | unverified (low) | governance | test-quality | fetch.js tests never cover the SSRF cases the module claims to defend | `test/fetch.test.js:107` |
| 106 | low | unverified (low) | learning-loop | gap | The API provider silently ignores per-call timeoutMs — adopt's 240s and the curator's 120s degrade to a hardcoded 90s | `src/lib/model.js:9` |
| 107 | low | unverified (low) | learning-loop | test-quality | Vacuous assertion in the buildCliArgs containment test | `test/provider.test.js:25` |
| 108 | low | unverified (low) | learning-loop | wrong-decision | Near-duplicate word threshold (0.12) sits below the project's own measured distinct-pair ceiling (0.127), calibrated from a single pair | `src/lib/similarity.js:71` |
| 109 | low | unverified (low) | learning-loop | code-quality | Chokepoint-rejected candidates leave orphaned evidence records on disk | `src/lib/distill.js:243` |
| 110 | low | unverified (low) | learning-loop | gap | Quarantine expiry is keyed to filesystem mtime, which routine file operations reset | `src/lib/curator.js:258` |
| 111 | low | unverified (low) | learning-loop | security | Episode excerpts can forge the <episode-data> closing tag to escape the data envelope | `src/lib/distill.js:111` |
| 112 | low | unverified (low) | recall | gap | PreToolUse Bash-grep detection is dead code: the shipped hook matcher only fires for Grep\|Glob | `plugin/hooks/hooks.json:19` |
| 113 | low | unverified (low) | recall | flaw | globToRegex mishandles '?': wrong semantics or a silently-dead pattern | `src/lib/match.js:20` |
| 114 | low | unverified (low) | recall | flaw | Missing session_id funnels all sessions into one immortal 'unknown' state that permanently hits the token cap | `src/lib/inject.js:80` |
| 115 | low | unverified (low) | recall | code-quality | buildIndex reads and hashes every lesson file three times; loadIndex re-parses the JSON it just wrote | `src/lib/compile.js:46` |
