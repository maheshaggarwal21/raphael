# Phase 23 — Graph engineering: making "what runs next" inspectable

**Status:** FINAL design (2026-07-28, session 17). Supersedes the 2026-07-28 draft.
**Source:** `Graph-Engineering.md` (owner-supplied) — three articles on the harness / loop /
graph layering, the strongest being the arXiv-derived "three commitments" framework.
**Review:** the draft was put through a 7-lens adversarial critique (91 findings, 42
critical/high). Every critical and high finding is resolved below; §12 is the disposition
table. Every load-bearing claim in this document was re-verified against the real code
before being written down — quoted evidence, not inference.

**The honest framing the source itself insists on:** the three-commitments framework is an
*unimplemented design* by its own author's disclaimer, analysed against 70 systems but not
validated at scale. So this plan treats it as a hypothesis to test. §10 (measurement) is a
build milestone, not an afterthought. If Raphael's escalation rate does not improve, that is
a finding worth publishing, not a failure to hide.

---

## 1. Why this — stated honestly, after the critique

The draft claimed the graph fixes F4, F10, F11, F12, F14, the verifier gap and the
sticky-token bug. **That claim was retrospective and the critique was right to kill it.** The
facts, re-verified:

- All seven are ticked in `.claude/TASKS.md` Phase 22 and the fixes are in `driver.js` today.
- Both real post-fix driver runs on disk completed **clean**: `~/.raphael/academy/gatepost`
  (7/7 done, one auto-resumed timeout, zero escalations) and `microcache` (4/4 done,
  `verify: "node --test"` green).

So this phase is **not** repairing observed breakage. Its justification has to be narrower
and it is:

**1. The driver structurally cannot express a loop.** Stage records are keyed by kind
(`d.stages[kind]`), so a pipeline containing the same kind twice silently overwrites the
first record, and `renderPlan` marks both visits done from one entry. The owner's requested
build — *frontend builds, design reviews, send back, repeat until it passes* — is not
expressible at all. This is the one genuinely earned item and it lands first.

**2. Run 05 is the observed failure, and it is a different failure.** The manager-orchestrated
roster path ran the loop as *prose in a prompt*. It converged by luck; nothing bounded it, and
when it stopped there was no cursor. That is the "loop wearing a graph's vocabulary" the
source names.

**3. The remaining value is prophylactic and should be sized as such.** Making "what runs
next" declarable is worth doing *before* the loop-bearing runs happen, not after they fail —
but that is a bet, and §10 measures it rather than assuming it.

**Consequence for the build order (§11):** the earned part (per-visit records, one bounded
loop, `frontend` reachable, `escalated` + exit 3) is milestones 23.1–23.4 and can ship and
prove itself alone. The general graph machinery follows. Nothing speculative ships before
something earned has run live.

---

## 2. What already exists (do not rebuild)

| Capability | Where it lives today | Verdict |
|---|---|---|
| Durable checkpoint + resume | `academy.js` state.json, `--resume <sessionId>` | **Keep as-is.** The harness layer works. |
| Bounded stage resumes | `driver.js` `MAX_STAGE_RESUMES = 3` | Keep; folds into the recovery ladder. |
| Model/effort per task kind | `policy.js` `POLICY` | Keep; extend (§4 D14/D15). |
| Deliverable shape gate | `gateDeliverable()` / `parseDecisions()` | Keep; becomes **one declared check kind**, not the implicit gate. |
| Claim gate (owner verifier) | `runVerify()` + `--verify` | Keep; **additive-only** per node (D6). |
| Boundary in code | no `deploy` kind; `recordBoundary()` | Keep, **and stop overstating it** (D13). |
| Deterministic project map | `atlas.js` `workspaceAtlasDigest()` | Keep. |
| Append-only decision ledger | `decisions.js`, per-stage `decisions[]` | Keep. |

**Nothing here replaces the harness.** The source's layering puts graph *inside* harness and
*around* loops. Raphael's harness is the part that already works.

### 2b. Verified gaps (each re-checked against the code this session)

1. **The driver cannot run two of the twelve agents.** Cross-referencing `POLICY[].agent`
   against `AGENTS[].slug` leaves **`frontend` and `redteam` with no policy kind**. The
   governed path cannot invoke the Frontend agent at all — today it builds UI with the
   general `developer` agent. This is a capability hole, not a topology enabler.

2. **A driver stage never receives the SPINE.** `driver.js` imports `AGENTS` and never
   `SPINE`. Verified by grep: `SPINE` appears only in `agents.js` (definition, and its use in
   `renderAgent`). So driver stages run with no brain-first rule, no free-checks-first, no
   write-back.

3. **The driver computes the right lessons and throws them away.** `lessonMatchesFor(kind,
   input)` at `driver.js:555` ranks matching lessons — and its only consumer is an
   effort-recommendation log line (`driver.js:550-559`). **Raphael's autopilot runs its most
   expensive builds with lesson injection computed and discarded.**

4. **Every read-only agent becomes a writer inside the driver.** `buildStageArgs`
   (`driver.js:409-420`) emits `--permission-mode acceptEdits` and **no `--tools`**. So
   `design`, `critique` and `planner` — read-only in the roster (`Read,Grep,Glob`) — get
   Edit/Write/Bash in the driver. A design agent that can edit the code it is reviewing makes
   the `design ⇄ frontend` loop incoherent.

5. **Dead kinds in two live sets.** `VERIFIED_KINDS = {develop, test, debug, implement,
   refactor}` and `CODE_BEARING_KINDS` also lists `qa`. `implement`, `refactor`, `qa` are
   **not POLICY kinds**, so they can never appear in a run. Three dead entries.

6. **No lock on a build.** Two concurrent `raph academy drive` runs interleave writes to one
   state.json. `pulse.js` already ships the pattern to reuse.

7. **`retryStage` guards on `d.status !== 'failed'`** (`driver.js:327`) — so any new terminal
   status has no route back (D19).

8. **The two outside readers.** `src/lib/academy.js:201` iterates `state.driver?.stages ?? {}`
   to build the DECIDED block — the **only** place the F4 decisions fix is visible to a human,
   and it fails **open** (`?? {}`), so moving records silently empties it. And
   `src/commands/academy.js:248` reads `final.driver?.pipeline?.[final.driver.stage]` for the
   F11 failure message. Both must change (D20).

---

## 3. The three commitments, mapped to Raphael

### Commitment 1 — Immutable plan

- `initDriver` resolves a graph **once**, deep-freezes it into `state.driver.graph`, stores
  `graph_hash` (sha256 of canonical JSON) and `graph_name`.
- The state stores the **full graph, not a template name.** `raph update` replaces shipped
  templates daily (pulse step 8); a run resuming against a silently-changed template would
  violate commitment 1 invisibly. On resume the locked copy always wins; a divergence from
  the named template's current hash is **logged, never applied**.
- **`graph_name` is `custom` for anything lifted or `--graph-file`-supplied**, so the
  divergence check does not cry wolf on every resume of a migrated run.
- **The model never authors topology.** Graphs come from a shipped template or the owner's
  `--graph-file`. Never from stage output. Same rule as `--verify`, same spirit as invariant
  #3.
- Any transition along an edge not in the locked graph throws `E-GRAPH` and escalates. There
  is no "adapt" path.
- **On resume, three things are checked, not one:** (a) the locked graph re-validates;
  (b) `graph_hash` is recomputed and compared to the stored one (a hand-edited state.json is
  caught); (c) **state-vs-graph binding** — every `cursor`, `visits` key and `edge_visits` key
  must name a node/edge that exists in the locked graph. (c) is the one that can actually
  drift and the draft never checked it.

**The tradeoff, stated:** an immutable plan handles a genuinely novel situation *worse* than a
free-running loop. For unattended, expensive autopilot work, auditability wins. For
interactive work the loop stays (§9).

### Commitment 2 — Separated layers

| Layer | Today | After |
|---|---|---|
| Planning | the `pipeline` array | `validateGraph()` — pure, spawns nothing, spends nothing |
| Execution | `makeStageRunner` | unchanged in spirit; return type **frozen to raw facts only** |
| Recovery | one `else if` in `applyStageResult` | `RECOVERY` table + `classifyFailure()` + `route()` — all pure |

**The critique killed the draft's own separation test as vacuous, and it was right.** The
draft froze the runner's keys to a set that *included* `failureClass` — but `failureClass` IS
the routing decision (the RECOVERY table is keyed by it, 1:1 to an action). A runner emitting
`failureClass:'timeout'` has already chosen `resume`.

**Resolution (D12):** `failureClass` is **banned** from the runner's return value. The runner
emits only raw facts it already emits today: `{ok, timedOut, gateFailed, verifyFailed,
elapsedMs, tokens, tokensCaptured, output, error, decisions, verdict, sessionId}`. A pure
`classifyFailure(result) → 'timeout'|'gate'|'verify'|'verdict'|'model'|'infra'` lives in the
recovery module and is the **only** producer of a class.

The separation test is then non-vacuous in three ways:
1. **Set equality**, not subset — a new key fails the test.
2. No key names a node id, and `failureClass`/`next`/`action` are explicitly absent.
3. `classifyFailure` is unit-tested with success + failure + ambiguity per class, and a test
   asserts the runner module does not import the RECOVERY table at all.

### Commitment 3 — Strict escalation

```js
export const RECOVERY = {
  timeout: { max: 3, per: 'visit', action: 'resume',   why: 'work is on disk and the session is live' },
  gate:    { max: 1, per: 'visit', action: 'restate',  why: 'deliverable shaped wrong — restate the contract' },
  verify:  { max: 2, per: 'visit', action: 'repair',   why: 'the claim was false — hand back verifier output' },
  verdict: { max: 1, per: 'visit', action: 'restate',  why: 'verdict unparseable — restate the verdict contract' },
  model:   { max: 1, per: 'visit', action: 'escalate', why: 'one stronger pass — only if the node is escalatable' },
  infra:   { max: 1, per: 'visit', action: 'retry',    why: 'spawn/envelope failure is environmental' }
};
export const MAX_NODE_ATTEMPTS = 5;   // total spawns per node VISIT, all classes combined
```

Three fixes the critique forced, all critical:

**(a) Scope is declared (`per: 'visit'`).** The draft said `max` without saying max *per
what*. Counters live in `nodes[id].visits[n].attempts[]`. **This also fixes a real existing
bug:** `applyStageResult` sets `retry_escalated = true` permanently on the record, so under
loops a node that escalated on visit 1 could never escalate on visit 2 — its genuine failure
would fall straight through to `failed`. Escalation is per-visit.

**(b) `MAX_NODE_ATTEMPTS` closes the class seam.** Six independent counters with no
composition rule let one node burn 3+1+2+1+1 = 8 spawns while every individual bound is
respected — the exact token-blowout commitment 3 exists to stop, reintroduced between the
classes. `MAX_NODE_ATTEMPTS` is checked **before** class dispatch and is a mandatory,
validated, printed field.

**(c) Escalatability is resolved at validate time, not failure time.** Only `develop` and
`debug` carry `escalate: 'opus'` — 2 of 14 kinds. A table saying `model: {max: 1}` is right
for 2 kinds and wrong for 12, which fails the source's own bar ("a human reading the table in
advance can predict exactly what happens"). So `validateGraph` freezes `escalatable:
true|false` per node from POLICY, and `raph academy graph` prints each node's **concrete**
budget:

```
develop   timeout×3  gate×1  verify×2  model×1  infra×1   → cap 5 attempts/visit
review    timeout×3  gate×1  verify×0  model×0  infra×1   → cap 5 attempts/visit
```

**Four declared bounds, any one of which escalates:**
1. per-failure-class attempts per visit (table)
2. `MAX_NODE_ATTEMPTS` per visit (total spawns)
3. per-edge cycle traversals (`maxTraversals`, mandatory on every cycle edge — §4)
4. per-run budgets (`maxNodes`, `maxWallClockMs`; tokens are advisory — D21)

**The escalated state is a real, visible event.** New driver status `escalated` (distinct from
`failed`), carrying node, per-attempt class + scrubbed evidence, graph hash, and the bound
that tripped. Exit **3** (2 = failed, 4 = limit) so a scheduler can tell "retry later" from
"a human must look".

---

## 4. The graph model

### D1 — ONE control relation

The draft defined topology twice (`inputs` "the real edges" *and* `{from,to,when}` edge
objects) with no rule that they agree. The critique proved the flagship graph could not pass
its own validator either way. **Resolved:**

- **`edges` are the only control relation.** They decide what runs next.
- **`inputs` is a pure data selector** — which prior nodes' outputs get rendered into this
  node's prompt — validated as a subset of the node's graph ancestors. It has no effect on
  ordering.

There is no fan-out construct in v1. Execution is a single cursor walking edges. A node that
needs three predecessors' outputs names them in `inputs`; that is string assembly, not
topology. This removes the frontier problem, makes reachability/dead-end/cycle rules
well-defined over one relation, and deletes the self-contradictory "topological order" language
(a cyclic digraph has no topological order).

Concurrency stays deferred, and now for a stated reason: every node spawns a real `claude -p`
on the subscription, and this session's own evidence is that parallel spawning hits the usage
limit fast.

### Node

```js
{
  id: 'design-review',            // unique; the address in every edge and record
  kind: 'design',                 // must exist in POLICY
  title: 'Design reviews the UI',
  inputs: ['frontend', 'plan'],   // DATA only — validated as ancestors
  emit: 'deliverable' | 'verdict',
  criteria: 'Every screen ... checked against the floor.',  // human prose, data-enveloped, NOT the gate
  check: { requires_section: '## DECISIONS' },              // REQUIRED — the declared pass predicate
  verify: true                                             // ADDITIVE only (D6)
}
```

### D8 — `check` is required; `criteria` is prose

The sharpest critical finding: the draft made *topology* explicit and left the *predicate that
selects an edge* exactly as it is today — `criteria` was validated for length and type and
consumed by nothing, so `when:'pass'` still meant "the text has a `## DECISIONS` heading". A
graph whose edges are selected by a self-assessed shape check is the named failure.

Every node declares a `check`, type-checked at validate time. Allowed forms:

| form | meaning |
|---|---|
| `{ requires_section: '## DECISIONS' }` | the deliverable contains that heading (today's gate, now **declared**) |
| `{ file_exists: 'src/app.js' }` | path exists in the workspace after the node runs |
| `{ file_matches: { path, pattern } }` | file exists and matches the regex |
| `{ all: [ ...checks ] }` | conjunction |

**`check.command` is deliberately NOT allowed.** A shell command in a graph would be a new
execution channel reachable from a shipped template (npm-updatable) or an adopted file. The
only shell command in the system stays the owner's `--verify`, typed on the CLI. This holds
the existing trust line exactly.

`criteria` remains free prose rendered into the prompt inside a data envelope, and §4 says
plainly: **criteria is guidance for the agent; `check` and `verify` are the gate.**

### D6 — `verify` is additive-only

Two lenses independently flagged this as high. The draft's per-node `verify: false` let graph
*data* switch off the owner's verifier — inverting the trust direction on the one gate built
because a `test` stage lied about 135 passing tests. And `microcache` on disk carries
`verify: "node --test"`, so a migration that dropped it is a live regression, not a
hypothetical.

**Rule:** `effectiveVerify(node) = VERIFIED_KINDS.has(node.kind) || node.verify === true`.

A graph may **extend** verification to a node the code would not check. It may never
**subtract** one. `verify: false` on a node whose kind is in `VERIFIED_KINDS` is `E-GRAPH`
("a graph cannot switch off the owner's verifier"). `verify` must be a strict boolean when
present. `pipelineToGraph` seeds `verify` from `VERIFIED_KINDS`, asserted by a regression test
that **derives from the set** rather than listing node names.

Also: prune `implement`, `refactor` from `VERIFIED_KINDS` and `qa`, `implement`, `refactor`
from `CODE_BEARING_KINDS` — they are not POLICY kinds and can never fire. A test asserts every
member of both sets is a real POLICY kind, so they cannot drift apart again.

### Edge

```js
{ from: 'design-review', to: 'frontend',  when: 'changes', maxTraversals: 3 }
{ from: 'design-review', to: 'developer', when: 'pass' }
{ from: 'plan',          to: 'architect', when: 'always' }
```

`when` ∈ `pass` | `changes` | `always`. **`fail` is not an edge condition** — a failing node
enters the recovery protocol; letting failure route would collapse the recovery layer back
into the graph, commitment 2's exact failure mode.

**D5 — `when` exclusivity.** A node has **either** exactly one `always` edge **or** exactly
one `pass` edge plus exactly one `changes` edge. Never both kinds, never duplicates. The draft
permitted `pass` + `changes` + `always` on one node, where an APPROVED verdict matched two
edges with no declared precedence — an ambiguity whose test would document whichever branch
the implementation happened to hit first.

**D7 — `onExhausted` is dropped.** The draft allowed `escalate | continue` and never defined
`continue`. On the canonical `design-review → frontend` loop, `continue` could only mean "take
the `pass` edge" — i.e. the driver deciding unattended that a reviewer which said CHANGES
REQUESTED three times shall be treated as having approved. That is the silent-drift class §1
exists to eliminate, as a one-word enum. In v1 exhausting a traversal bound **always**
escalates. Re-openable only with evidence, and never for a verdict node.

### Reserved terminal targets

- `@done` — the run completed; existing boundary logic records the owner ask.
- `@owner` — terminate and escalate, carrying an edge-declared `reason`.

Neither may be a node id.

### D2 — `entry` is required, not inferred

```js
{ entry: 'plan', nodes: [...], edges: [...] }
```

The draft inferred the entry as "the node with no inbound edge", which makes the shipped `fix`
graph (`debug ⇄ test → review`) invalid — every node has an inbound edge — and breaks on any
self-loop or loop-back to the first node. It also makes tests order-dependent in ambiguous
graphs. `entry` is now an explicit required field, and the inference is deleted.

### Verdict nodes and the review loop

A `design` or `reviewer` node *succeeds at its own job* while saying "changes needed" — a
**verdict**, not a failure. `emit: 'verdict'` nodes carry a second contract alongside
`## DECISIONS`:

```
## VERDICT
APPROVED
```

**D16 — `parseVerdict` is hardened against echo.** The draft specified "last heading wins",
mirroring `parseDecisions`. For a verdict that is the wrong default: a reviewer's prompt
*contains the reviewed node's output*, so any trailing `## VERDICT / APPROVED` echoed from the
input — planted or innocent — becomes the routing decision. Rules:

1. **Exactly one** `## VERDICT` section in the deliverable. Two or more → `null`.
2. It must be the **final** section (nothing but whitespace after the token).
3. Exactly one of the two tokens, case-insensitive. Anything else → `null`.
4. `null` is **fail-closed** — a `verdict`-class failure entering recovery, never an implicit
   approval. (Precedent: `adopt.js` treats a malformed reviewer verdict as a block.)

**Every node input is wrapped** in `<raphael-stage-input from="<node-id>">…</raphael-stage-input>`
with the `inject.js` framing sentence verbatim, and the verdict contract states that a VERDICT
inside an input block is data and must not be reproduced.

**D17 — evidence outranks confidence.** The source is explicit: *loop on evidence, not on
confidence.* So: where a node has a `check` or effective-verify, **that is authoritative** — a
`pass` verdict cannot override a failed check. The parsed verdict routes only the taste-shaped
loop (design review), where no deterministic signal exists. This is stated as **the one place
the system loops on a cross-agent assertion**, with `maxTraversals` as the safety net and
`raph guard scan --design` wired as the design node's `check` so even that loop has a
deterministic floor.

### Loop-back data

When `design-review → frontend` fires on `changes`, the frontend node's next visit receives
**both** its own previous output and the review, labelled. Loop-back is the only reason a
node's own prior output is re-injected. **Per-visit outputs are retained** (`visits[n].output`)
— the draft's single `output` slot would have had a loop-back overwrite the very evidence the
loop exists to generate.

### D3/D4 — validation (`validateGraph()`, the whole planning layer)

Rejects, each with a distinct `E-GRAPH` message:

1. no nodes; duplicate node id; empty/non-string id; id colliding with `@done`/`@owner`
2. an edge referencing an unknown node (either end)
3. **`entry` missing, or not naming an existing node**; any node with no inbound edge that is
   not the entry
4. a node unreachable from `entry` (forward BFS)
5. **co-reachability** (replaces the draft's self-contradictory rule 5): at least one terminal
   must exist, and **every node must reach a terminal** (reverse BFS from the terminal set).
   This is what kills `developer ⇄ test` with no exit — a graph that validates, spins, and
   escalates 100% of runs having spent real tokens
6. **SCC form** (replaces cycle enumeration, which is exponential): every edge whose endpoints
   lie in the same **Tarjan SCC of size > 1**, plus every self-loop, must carry a positive
   integer `maxTraversals`. O(V+E). This is the structural guarantee that **an unbounded retry
   cycle cannot exist in a valid graph**
7. `when` exclusivity per D5
8. a `changes` edge leaving a non-verdict node; a verdict node missing either its `pass` or
   its `changes` edge
9. `inputs` naming an unknown node or a non-ancestor
10. a `kind` absent from POLICY (`E-POLICY`); **plus `DRIVER_FORBIDDEN_KINDS`** (D14)
11. `check` missing, or not one of the allowed forms, or containing `command`
12. `criteria` non-string or over cap; `title` non-string or over cap
13. `verify` present and not a strict boolean; or `verify:false` on a `VERIFIED_KINDS` node
14. `maxTraversals` present and not a positive integer
15. **boundary deny-scan** (D13) over every `criteria`, `title` and the brief
16. `emit` not one of `deliverable` | `verdict`

Validation is pure, spawns nothing, spends nothing, and runs at `init` **and** on every resume
against the locked copy.

### D13 — the deploy boundary, stated honestly

The draft claimed rule 10 made the boundary structural: "there is no `deploy` kind, so no valid
graph can contain one." **That is a claim about node labels, not capabilities.** Verified: every
node spawns with `--permission-mode acceptEdits`, tools on, cwd = the real workspace. What
actually stops a deploy today is `BOUNDARY_RULES` prose. And the graph *adds* free-text
`criteria` rendered into that same prompt — so
`{ id:'ship', kind:'develop', criteria:'Publish the package to npm and confirm the release is live.' }`
would pass validation in full.

Three changes:
1. **Restate the claim honestly:** kind-absence prevents a *policy resolution* for a
   deploy-labelled node. It is not a capability guarantee.
2. **Add a deterministic deny-scan** (`scanBoundaryVerbs`, zero tokens, reusing the `guard.js`
   pattern shape) over every `criteria`, `title` and the brief at init — rejecting boundary
   verbs (deploy, publish, `npm publish`, push, sign in, purchase, spend) with `E-GRAPH`
   **before anything spawns**.
3. **Render `criteria` inside a data envelope**, so it reads as data, never as instruction
   outranking `BOUNDARY_RULES`.

### D14 — `redteam` does not become drivable

The draft's 23.2 added both `frontend` and `redteam` to POLICY. Two lenses caught this, one as
critical, and the reasoning holds: **POLICY membership is exactly what the existing
`--pipeline` flag validates against.** The moment `redteam` lands in POLICY,
`raph academy drive p --pipeline "redteam"` is a valid, ungated invocation of an offensive
agent — which the driver would run with Edit/Write (tools the roster withheld on purpose) at
`acceptEdits`, while `BOUNDARY_RULES` ("There is NO HUMAN in this loop") directly overrides the
redteam mission's first rule ("AUTHORIZATION IS THE FIRST STEP, ALWAYS... confirm explicitly
before each active step") because it is appended last in the same prompt.

**Only `frontend` is added to POLICY.** `redteam` stays reachable exactly where a human is:
the manager path, the `pentest` recipe, `raph policy`. Belt and braces:
`DRIVER_FORBIDDEN_KINDS = new Set(['redteam'])`, checked by `validateGraph` with its own
message, so a future POLICY addition cannot silently make it drivable.

### D15 — a driver stage never exceeds its agent's reviewed tool set

POLICY gains a `tools` field sourced from the roster; `buildStageArgs` emits
`--tools <list>`. The read-only agents (`design`, `critique`, `planner`) stay read-only in the
driver, which is what makes the `design ⇄ frontend` loop mean anything — the reviewer cannot
quietly fix what it is reviewing. `--tools ""` is already proven in `provider.js` (zero-tool
containment); the list form is **live-verified in 23.2 before the milestone closes**, and if
the CLI rejects a list the milestone ships the fallback (tool restriction stated in the prompt
plus a post-run `git status` assertion for read-only nodes) rather than silently dropping the
guarantee.

### Shipped graphs

| name | shape | for |
|---|---|---|
| `linear` | today's `DEFAULT_PIPELINE`, lifted verbatim | back-compat; **stays the default** |
| `fix` | `debug ⇄ test → review → @done` | a bug-fix run |
| `full-build` | below | the "every agent, in order, with loops" build — **experimental until 23.9** |

`full-build`:

```
entry: plan

plan ──always──▶ architect ──always──▶ critique
                    ▲                     │
                    └────changes(≤2)──────┤
                                          │pass
                                          ▼
                                       frontend ──always──▶ design-review
                                          ▲                     │
                                          └────changes(≤3)──────┤
                                                                │pass
                                                                ▼
                                                            developer
                                                                │always
                                                                ▼
                                                              test
                                                                │always
                                                                ▼
                                                             review
                                                          │pass    │changes(≤3)
                                                          ▼        ▼
                                                      security   debug ──always──▶ test
                                                    │pass  │changes
                                                    ▼      ▼
                                              deploy-prep  @owner  "security findings are advisory"
                                                    │always            (invariant #4)
                                                    ▼
                                                  @done
```

Every SCC is bounded: `critique⇄architect` (≤2), `design-review⇄frontend` (≤3),
`review→debug→test→review` (≤3). `security` never routes into an auto-fix — that falls
straight out of invariant #4 and the Security agent's own shipped mission ("Security findings
are ADVISORY to a human — never auto-apply a security change"). The graph is the first place
Raphael can **enforce** that structurally instead of hoping a prompt holds.

**Where is the Manager?** In the governed path there isn't one — **the graph is the router.**
The manager exists to decide what runs next, and that is exactly the decision this design moves
out of a model's head into a declared structure. The Manager keeps its job on the interactive
path (§9).

---

## 5. State, migration and resume

```js
state.schema = 'raphael/academy-state/v2'   // bumped: an older raph must fail loudly, not re-run work

state.driver = {
  graph, graph_hash, graph_name,
  cursor: 'frontend' | null,          // null = terminal reached (a legal, documented value)
  nodes: {
    <id>: {
      status: 'pending'|'running'|'done'|'failed'|'escalated',
      session_id, escalatable,
      visits: [ { n, startedAt, output, verdict, decisions, tokens, tokensCaptured,
                  elapsedMs, escalated, attempts: [ { class, action, at, evidence, migrated? } ] } ]
    }
  },
  visits:      { 'frontend': 2 },
  edge_visits: { 'design-review->frontend': 2 },
  history: [ { at, from, to, when, why, visit } ],     // append-only audit trail
  budgets: { maxNodes, maxWallClockMs },               // tokens advisory — see D21
  spent:   { nodes, wallClockMs, tokens: { value, complete } },
  runLimit,                                            // --max-stages: a clean pause, not an escalation
  status: 'running'|'limit'|'paused'|'failed'|'escalated'|'done',
  escalation: { node, visit, attempts, bound, graph_hash, at } | null,
  verify, brief, started_at, updated_at
}
```

**One engine, not two.** A linear pipeline *is* a linear graph, so `ensureGraph(state)` lifts
pre-graph state on read. No fallback path — a dual path would be the "loop wearing a graph's
vocabulary" the source warns against. `pipeline` survives as a derived display field.

### D18 — the migration table (the draft had one sentence; there are eight shapes)

Verified against the owner's real `~/.raphael/academy`: five projects — three with **no
`driver` key at all** (assay, onedesk, repo-keeper), two with `driver.status: 'done'` and
`stage === pipeline.length` (gatepost 7/7, microcache 4/4).

| # | on-disk shape | `ensureGraph` produces |
|---|---|---|
| 1 | no `state.json` | never reached; `drive` throws `E-DRIVER` |
| 2 | state with **no `driver` key** (3 real projects) | **returns state untouched** — must NOT synthesise an empty graph, because `nextAction` distinguishes `{type:'no-driver'}` and `renderStatus` fails open |
| 3 | mid-flight, prior stages `done` | cursor = node for `pipeline[stage]`; those nodes `done` with one migrated visit |
| 4 | current stage `running` + `session_id` | node `running`, `session_id` preserved — **resume, do not restart** |
| 5 | current stage **`retry`** | status `running`, **`session_id` = null** (never resume a failed session), `attempts` seeded with one consumed `model`-class entry |
| 6 | `stage >= pipeline.length` **or** `status: 'done'` (both real runs) | **`cursor: null`**, status `done`, every node `done` |
| 7 | stage with `timeouts: n` (gatepost `test` has 1) | `n` entries of class `timeout`, each `migrated: true` |
| 8 | stage with `retry_escalated: true` | one entry of class `model`, `migrated: true`; `escalated: true` on that visit |

Three of these were silent bugs in the draft:

- **Shape 6** — `pipeline[stage]` is `undefined` one past the end. "Map `stage: 3` to the
  cursor" produces `cursor: undefined` for **every completed run**, which is both real runs on
  disk. `cursor: null` is now legal and documented.
- **Shape 5** — `'retry'` means "the session failed, start fresh at the escalated model", the
  opposite of `'running'`. The obvious lift (both are in-flight → `running`) would hand a
  failed session id to `--resume`, which the code explicitly forbids.
- **Shapes 7/8** — dropping the scalars resets every retry budget. A stage already at
  `timeouts: 2` would get three **more** spawns, and `develop` carries `timeoutMs: 1500000`
  (25 min) — up to ~75 minutes of unbudgeted subscription spend on exactly the failure mode
  (F10) this phase cites.

**Fixtures are byte-copies of the real gatepost and microcache state.json files** — the only
two authentic pre-graph driver states in existence, and both are edge cases (shape 6, one with
shape 7, one with `verify` set).

**Duplicate kinds.** `--pipeline "develop,test,develop"` is legal today; node ids must be
unique, so `pipelineToGraph` generates `develop`, `develop-2` and preserves each visit's
history. `graph_name` for any lifted custom pipeline is `custom`.

### D19 — the status × command matrix

| driver status | `academy retry` | re-running `drive` | `initDriver` |
|---|---|---|---|
| `running` | refuses (nothing failed) | resumes at cursor | idempotent — keeps existing graph |
| `limit` | refuses | resumes at cursor | idempotent |
| `paused` (`--max-stages` reached) | refuses | resumes at cursor | idempotent |
| `failed` | clears node, status → `running` | resumes | idempotent |
| **`escalated`** | **clears node, status → `running`** | resumes | idempotent |
| `done` | refuses | starts fresh **only with an explicit `--graph`/`--brief`** | re-inits |

`retryStage` must accept `escalated` — otherwise the human it just handed control to is told
"nothing to retry" while `status` still shows a NEXT action, which is **verbatim the F14
symptom**. A single `clearNode(state, id, {resetLoops})` mutates `nodes[id]`, `visits[id]` and
every `edge_visits` key touching that node **together**, so the three maps cannot drift.
Per open question 2, `retry` preserves loop counters by default; `--reset-loops` clears them.
`initDriver`'s idempotence guard **warns loudly** when `--graph` is passed to a state that
already has one, rather than silently ignoring it.

### D20 — the two outside readers

- `src/lib/academy.js:201` — the DECIDED loop iterates `nodes` (all visits), with a fallback to
  `stages` for migrated-but-unwritten states. **A test asserts a graph-shaped state still
  prints a DECIDED line**; the `?? {}` fail-open means no existing test would catch its loss.
- `src/commands/academy.js:248` — the F11 failure message reads the cursor node id, not
  `pipeline[stage]`, so it can never degrade to `stage "undefined" failed`.

### D21 — budgets that are honest, and testable

- **Tokens are advisory, not binding.** A killed child never delivers a usage envelope: the
  runner returns `tokens: 0, tokensCaptured: false`, and the driver keeps a sticky-false marker
  *because the number is a lie*. The measured case is in the code's own comment — a `develop`
  stage cut off twice recorded "failed, 0 tokens" while 423,523 billable tokens were spent. So
  `spent.tokens` undercounts hardest on exactly the nodes a token budget should bound. It is
  recorded as `{ value, complete }`, surfaced in reports, and **never used as a hard bound**.
- **Wall clock is the binding cost signal**, defined explicitly as **summed spawn duration**,
  not elapsed since `started_at` — a run that hits a subscription limit resumes hours later,
  and an elapsed-since-start budget would escalate a healthy run on its first post-reset node.
- `now = Date.now` is injected into `drive()` (the repo already does this for `computeWeekly`,
  `verifyFn` and `atlasDigestFn`), so budget tests are deterministic, not `sleep`-flaky.
- **`--max-stages` is a clean pause, not a bound.** It maps to `runLimit`, checked first,
  ending the run `paused` with exit 0 — an owner-requested partial run is not an escalation.

### Resume, locks, caps

- **D-resume:** "resume the current node" is an explicit **first branch** of the next-action
  function, ahead of `route()`. A resume is **not a traversal**: it increments
  `visits[n].attempts` under class `timeout` and **never touches `visits[id]` or
  `edge_visits`**. Otherwise three limit interruptions inside a `maxTraversals: 3` loop would
  exhaust the edge and escalate a run that never actually looped. `RECOVERY.timeout.max`
  **replaces** `MAX_STAGE_RESUMES` rather than stacking with it.
- **Lock:** a lock file with stale-steal + pid-checked release (the `pulse.js` pattern) guards
  a run. Two concurrent drives on one project would corrupt the cursor.
- **Input caps:** each `inputs` source is capped independently with an explicit truncation
  marker, so a 200 KB deliverable — or three of them joined — cannot silently blow the prompt.

---

## 6. The five moves, made literal

| move | Raphael |
|---|---|
| Plan | `validateGraph()` + `initDriver()` — locks, hashes, spawns nothing |
| Execute | `makeStageRunner()` — raw facts only, no classification, no routing |
| Recover | `classifyFailure()` + `RECOVERY` + `MAX_NODE_ATTEMPTS` — pure, declared, numbered |
| Escalate | status `escalated` + full per-visit history + exit 3 |
| Repeat | `route()` advancing the cursor along a validated edge, counted |

---

## 7. The brain in the loop (the gap this phase must not ship past)

§2b.2 and §2b.3 are the sharpest finding in the whole review: **the pipeline built to
demonstrate the brain does not consult it.** Driver stages get no SPINE, and
`lessonMatchesFor` computes the top matching lessons and throws them away.

So milestone 23.7 renders the already-computed matches into `renderStagePrompt` as a
`<raphael-lessons>` data envelope (the same framing discipline as the atlas digest block at
`driver.js:375-382`), plus SPINE rules 2–4 verbatim.

**Rules 1 and 5 need a decision, not silence.** They instruct every agent to run `raph search`
and `raph note` — and four of twelve agents (manager, planner, design, critique) have **no
Bash** and structurally cannot. Those instructions fail silently today, in the shipped plugin,
for every user. Fix at the source: `renderAgent` emits rules 1 and 5 only for agents whose tool
list contains Bash. An instruction an agent cannot follow is the same class of defect as a test
that cannot fail.

Driver write-back (a stage writing lesson candidates) stays **out of scope** — it is a
chokepoint question and deserves its own decision, not a side effect of this phase.

---

## 8. Content plans vs control flow — §7 of the draft is DEFERRED

The draft's `## STEPS` (a plan node emitting a frozen numbered work list) is **cut from v1**.
It was immutable in name only: locked, rendered into prompts, and never read back, so a
downstream node could skip step 4, still satisfy the gate, still take its `pass` edge, and the
trace would no longer match the locked plan. The source names that exact failure ("Treating the
plan as immutable in name only... the worst of both worlds").

Shipping it in that form is **worse than omitting it**, because it lets the design claim
commitment 1 over work content while enforcing nothing. If it returns, it returns with a
`## STEPS STATUS` section parsed fail-closed, and any skipped or missing step id becomes a
`plan-deviation` class whose only action is `escalate`.

---

## 9. The interactive path — corrected on verified fact

The draft asserted the Agent-tool path "cannot be checkpointed by Raphael, because Raphael does
not own that runtime." **That premise is false, and I verified the refutation this session.**

Raphael already injects into that runtime at four lifecycle points (`plugin/hooks/hooks.json`:
SessionStart, UserPromptSubmit, PreToolUse matched on `Grep|Glob`, SessionEnd). A hook fires
from the harness, not from the model's goodwill — precisely the property the draft said was
unavailable. And the installed Claude Code binary contains the strings **`SubagentStart` (28
occurrences) and `SubagentStop` (74)** alongside the four events Raphael already uses.

**Honest limit:** that confirms the events *exist*. It does not confirm the payload carries the
subagent's identity or result. So the correct statement is "unchecked assumption", not
"architectural impossibility", and 23.10 is a **spike**: wire a `SubagentStop` hook that
appends to a cursor file, run one manager build, and read what the payload actually contains.

Two outcomes, both honest:
- payload carries subagent identity → a deterministic, model-independent cursor for the
  interactive path is buildable, and it becomes a real milestone.
- it does not → §9 states "we checked `SubagentStop` and its payload lacks X, therefore no
  guarantee", with the event named.

One thing already settled: **the manager cannot call `raph` at all** — its tools are
`Read, Grep, Glob, Task`, no Bash. A CLI-recorded cursor would first require granting shell to
the cheapest model in the roster, the one that also holds `Task`. That is a real privilege
expansion and it is rejected: the hook is the right mechanism precisely because it needs no
model cooperation.

Until the spike resolves: **Driver = the governed path** (all graph machinery, checkpointed,
auditable). **Manager = the convenience path**, which gets the graph rendered as a bounded
procedure via `raph academy graph <name>` and is documented as *best-effort prompt steering
with no checkpoint guarantee*. Anything else would misstate what the guarantee covers.

---

## 10. Measuring it (non-optional)

The source closes by saying the most valuable thing is to measure whether the framework reduces
the failure modes it targets. So:

- every run logs `graph-run` (graph name + hash, nodes executed, visits, wall clock, terminal
  state)
- every escalation logs `graph-escalation` (node, visit, failure class, attempt number, which
  bound tripped, graph hash)
- `raph stats` and `raph report weekly` surface **escalation rate broken down by which recovery
  attempt failed** — the source's named diagnostic, which a flat loop cannot give.

A graph escalating repeatedly at the same recovery step means that step's protocol is
miscalibrated, not that the task is hard.

**Honest caveat the critique earned:** at the current run volume (two recorded driver runs
ever), this metric cannot pay off yet. It is built now because retrofitting instrumentation
after the fact loses the baseline — not because a dashboard will be meaningful in week one.

---

## 11. Build order

Reordered per the critique: **tests ship with each milestone**, not two milestones later. The
draft landed the engine swap ("one path, no fallback") before its coverage, which makes the
repo's own red-without/green-with rule unsatisfiable — you cannot show a test red for a bug you
introduced and hand-fixed in the same milestone.

**Earned first (ships and proves itself alone):**

| # | milestone |
|---|---|
| 23.1 | `src/lib/graph.js` — model, `validateGraph()` (16 rules, Tarjan SCC, co-reachability), `pipelineToGraph()`, `renderGraph()`. Pure, zero spawns. Full success/failure/edge coverage per rule. |
| 23.2 | POLICY gains `frontend` + `tools` per kind; `buildStageArgs` emits `--tools`; `DRIVER_FORBIDDEN_KINDS`; prune the three dead kinds. **Live-verify `--tools <list>` before closing.** |
| 23.3 | `ensureGraph` + the 8-shape migration table + fixtures byte-copied from the real gatepost/microcache states. Four named regression tests, each shown red-without: verifier default, legacy `retry_escalated`, renderStatus DECIDED, duplicate-kind pipeline. |
| 23.4 | Driver on the graph: `route()`, `classifyFailure()`, `RECOVERY`, `MAX_NODE_ATTEMPTS`, per-visit records, verdict contract, `escalated` + exit 3, `retryStage` matrix, lock, input caps, budgets with injected `now`. One path, no fallback. |

**Then the general machinery:**

| # | milestone |
|---|---|
| 23.5 | CLI: `--graph <name>` / `--graph-file`, `raph academy graph [--mermaid]` printing each node's concrete attempt budget, status rendering, both outside readers (D20). |
| 23.6 | The three commitment stress-tests (§13) — cross-cutting, genuinely belong after the engine exists. |
| 23.7 | **The brain in the loop** (§7): render `lessonMatchesFor` + SPINE 2–4 into stage prompts; fix rules 1/5 for Bash-less agents. |
| 23.8 | `graph-run` / `graph-escalation` events → `raph stats` + weekly report. |
| 23.9 | Live run: `full-build` over a real brief, observed. `full-build` stays **experimental** until this passes. |
| 23.10 | `SubagentStop` payload spike (§9) → §9 rewritten either way. |

Docs: ARCHITECTURE.md gains §15 (the graph layer); §11 gains the decided calls
(model-never-authors-topology; no `check.command`; verify additive-only; sequential v1;
escalate-always; redteam not drivable).

---

## 12. Open questions — all four resolved

| # | question | resolution |
|---|---|---|
| 1 | Is `onExhausted: 'continue'` justified? | **No — dropped entirely (D7).** Undefined in the draft, and on the canonical loop it can only mean "treat CHANGES REQUESTED as approved". Re-openable with evidence; never for a verdict node. |
| 2 | Should `retryStage` reset cycle counters? | **No by default** — preserve the audit trail; `--reset-loops` opts in. But `retryStage` **must accept `escalated`** (D19), which the draft missed entirely. |
| 3 | Is a `null` verdict a `verdict`-class failure or an immediate escalate? | **One restate, then escalate** — plus the draft's parser was echo-vulnerable, now hardened (D16). |
| 4 | Should `full-build` be the default? | **No — `linear` stays default**, and `full-build` is marked experimental until 23.9 produces evidence. The source's own warning against premature formalization applies. |

---

## 13. The three commitment stress-tests (23.6)

The source specifies exactly how to test each commitment, and each has a way of quietly failing
if implemented sloppily.

1. **Immutable plan.** Construct a mid-run scenario where the "obviously correct" next step
   deviates from the locked graph; assert the run **escalates** rather than adapting. Plus:
   hand-edit `state.driver.graph` and assert the hash check catches it; point `graph_name` at a
   template whose current hash differs and assert the **locked copy** runs and the divergence is
   logged.
2. **Separated layers.** Assert **set equality** of the runner's return keys (not subset), that
   no key names a node, that `failureClass` is absent, and that the runner module does not
   import `RECOVERY`.
3. **Strict escalation.** A fake runner returning a **different failure class on every call**
   must escalate at `MAX_NODE_ATTEMPTS` — asserting the runner was invoked exactly that many
   times and `escalation.bound === 'max-node-attempts'`. This is the test the draft could not
   have written, because it had no single defined limit to assert against.

Plus the anti-vacuity rules this repo learned the hard way (three prior incidents: the
byte-identical injection test, the `\b`-in-template-literal lint, the gate test that passed
with the gate deleted):

- Every gate test runs **end to end through the runner**, not just the pure function.
- The null-verdict test asserts **what did not happen** (no edge traversed, `edge_visits`
  unchanged), not merely that the parse returned null.
- No test asserts the contents of the `RECOVERY` table — reading a constant back proves nothing.
- Exit-code 3 needs a test seam: the runner is currently constructed inside the command, so
  23.4 injects it.
