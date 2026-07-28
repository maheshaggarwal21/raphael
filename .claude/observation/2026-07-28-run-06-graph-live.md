# Run 06 — the graph layer, live (23.9)

Date: 2026-07-28, session 18. Two real driver runs against the shipped graph engine.
Everything below is read off the recorded state and independently checked, not taken from
what a stage said about itself.

---

## Run A — `fix` graph, project `slugfix` (COMPLETE, clean)

**Workspace:** `C:/Users/Mahesh/Desktop/Projects/raphael-live-23-9` — a real 2-test suite with
one genuinely failing test (`slugify('!!!')` returned `''` instead of `'untitled'`).
**Command:** `raph academy drive slugfix --graph fix --verify "node --test test/slug.test.js"`

| | |
|---|---|
| Result | 3 nodes, 9,319 tokens, 205s, terminal `done` |
| Path | `debug --always--> test --pass--> review --always--> @done` |
| Verifier | ran after `debug` and `test`, passed both |
| Brain | 5 lessons injected into every node |

**Independently verified:** I ran the suite myself afterwards — 2/2 passing, and the fix is in
`src/slug.js` (`|| 'untitled'` at the end of the chain), not in the test file. The brief said
not to change the tests and it did not.

**What this proved live:** the verdict contract (the `test` node emitted a parseable
`APPROVED`, recorded as `why=APPROVED` on the history edge), the pass branch routing, the
owner's verifier running on code-bearing nodes only, the boundary being recorded at
completion, `graph-run` telemetry, and the DECIDED block rendering from graph-shaped state.

**One observation worth keeping.** The `test` stage's own DECISIONS said: *"Traced all cases
manually rather than re-running node — sandbox restrictions blocked test execution."* It could
not run the tests. The owner's verifier ran them independently and passed. That is exactly the
split the verifier exists for: the stage's self-report was not evidence, and something outside
the stage settled it.

---

## Run B — `full-build` graph, project `tallyboard` (INCOMPLETE — stopped on a usage limit)

**Workspace:** `C:/Users/Mahesh/Desktop/Projects/raphael-live-fullbuild`
**Brief:** `.claude/observation/tallyboard-brief.md` (a real zero-dependency scoreboard, with a
UI so the frontend/design pair has genuine work).

```
plan       --always--> architect        done,  3,385 tokens
architect  (visit 1)   TIMED OUT at 10 min -> RESUMED same session -> done, 21,252 tokens
architect  --always--> critique         done,  7,874 tokens
critique   --changes-> architect        CHANGES REQUESTED
architect  (visit 2)   ... subscription limit hit mid-stage
```

Recorded state at the stop:

```
driver status : limit          cursor: architect
academy       : blocked-limit  resets 1:10am Asia/Calcutta
spent         : 4 nodes, 1395s, 32,511 tokens (complete: FALSE)
edge_visits   : plan->architect 1, architect->critique 1, critique->architect 1
architect     : 2 visits, attempts [["timeout"], []], tokensCaptured false,true
```

### What this run proved live — the thing the whole phase exists for

**The loop fired.** `critique --changes--> architect`, and `architect` now holds **two
visits**, each with its own attempt record and its own token accounting. In the pre-graph
driver this was not merely unsupported — stage records were keyed by kind, so architect's
second visit would have silently overwritten the first, and `renderPlan` would have marked
both done from one entry. This is the first time a Raphael build has expressed a real
review-and-send-back loop through the governed path.

**The timeout path worked, live and unassisted.** Architect exceeded its 10-minute budget,
was recorded as a `timeout` attempt rather than a failure, and the driver **resumed the same
session** rather than restarting — then completed with 21,252 tokens. That is F10's fix
working on a real stage, not a fixture.

**Cost honesty held.** The killed child delivered no usage envelope, so visit 1 carries
`tokensCaptured: false`, and the run-level total is `complete: false`. The 32,511 figure does
not advertise itself as the real cost, which is precisely the lie the sticky-false marker
exists to prevent.

**The limit was handled cleanly.** Driver `limit`, academy `blocked-limit`, the reset time
recorded, the cursor left on `architect`. Rerunning `raph academy drive tallyboard` after the
reset resumes from exactly there — the state is checkpointed for this.

### What it did NOT prove, stated plainly

`full-build` **did not complete**. It reached 4 of 11 nodes. So:

- **`full-build` KEEPS its EXPERIMENTAL flag.** The gate in the design is an observed run that
  finishes, and this one stopped on a usage limit. Removing the flag on a partial result would
  be exactly the kind of self-reported success this project spent the session designing
  against.
- The `frontend ⇄ design-review` loop, the `review ⇄ debug` loop, the security→@owner edge and
  `deploy-prep` were never reached, so none of them has live evidence yet.
- No escalation occurred, so the escalation path is still only proven in tests.

### Note on cost

The run consumed the session's subscription limit at 4 nodes / ~32.5k captured tokens (the
true figure is higher — one stage went unmeasured). An 11-node build over a real brief is
expensive; the `architect` timeout and one loop-back doubled its share. Worth knowing before
scheduling another full-build: it is a multi-limit-window job, not a single-session one.

---

## Verdict

The graph engine works on real work. Every mechanism that this phase newly introduced and that
the two runs actually reached — loops with per-visit records, verdict routing, bounded
traversal counters, timeout-resume, cost honesty, limit checkpointing, brain injection, the
verifier — behaved as designed under live conditions.

`full-build` stays experimental until a run of it finishes. That is the honest state, and the
run is resumable from its checkpoint whenever the owner wants to spend another limit window
on it.
