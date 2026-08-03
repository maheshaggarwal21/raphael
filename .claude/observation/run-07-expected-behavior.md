# Run 07 — the correct answers, written BEFORE reading their implementation

Discipline note: this file is written while `architect` is still running, so
the expected values below are derived from the brief alone. If I wrote it
afterwards I would be checking their code against itself, which proves nothing.

SPEC.md commits to this contract:

```
(routine, elapsedMs) -> { intervalIndex, cycleIndex, remainingMs, totalRemainingMs, finished }
```

Routine shape (per SPEC): an ordered list of intervals `{label, seconds, kind}`
plus a `cycles` count (default 1).

## The six brief-mandated edge cases, and what each MUST return

Let `R1 = { intervals: [{label:'Work', seconds:30, kind:'work'}], cycles: 1 }`

### 1. Empty routine — `{ intervals: [], cycles: 1 }`, elapsed 0
There is nothing to run. The only defensible answers:
- `finished: true` (a routine with no work is trivially complete), and
- `totalRemainingMs: 0`, and
- `intervalIndex` must NOT point at a nonexistent element — `null`/`-1`, never `0`.

The failure mode to catch: returning `intervalIndex: 0` and then the UI reading
`intervals[0].label` of an empty array → `undefined` label or a crash.

### 2. Single interval — `R1`, elapsed 0
`intervalIndex: 0`, `cycleIndex: 0`, `remainingMs: 30000`,
`totalRemainingMs: 30000`, `finished: false`.

### 3. Elapsed exactly on a boundary — `R1`, elapsed exactly 30000
This is the one most likely to be off-by-one. At exactly the boundary the
first interval is **over**, and since it is the only interval in a 1-cycle
routine, the routine is **finished**. Correct: `finished: true`,
`totalRemainingMs: 0`.

The wrong answer to catch: `remainingMs: 0` with `finished: false` and
`intervalIndex` still 0 — a timer that sits forever on a finished interval
showing 0:00, which is exactly the "blank/zero countdown" state the brief
explicitly says must not be how finishing is presented.

For a two-interval routine `[30s, 10s]` at elapsed exactly 30000: the SECOND
interval is now current — `intervalIndex: 1`, `remainingMs: 10000`. Not index 0.

### 4. Elapsed past the end — `R1`, elapsed 999999
`finished: true`, `totalRemainingMs: 0`, `remainingMs: 0`. Must not return a
negative remaining, and must not throw.

### 5. Multi-cycle — `{ intervals: [30s work, 10s rest], cycles: 3 }`
Total routine length = (30+10) * 3 = 120000ms.
- elapsed 0 → `cycleIndex: 0`, `intervalIndex: 0`, `totalRemainingMs: 120000`
- elapsed 45000 → into cycle 2 (0-indexed `cycleIndex: 1`), 5s into the 30s
  work interval → `intervalIndex: 0`, `remainingMs: 25000`,
  `totalRemainingMs: 75000`
- elapsed 120000 → `finished: true`, `totalRemainingMs: 0`

This is the case the brief calls out specifically ("total-time-left must account
for remaining cycles, not just the current pass"). The failure mode to catch:
`totalRemainingMs` computed only over the current cycle, so it reads 75000 as
35000.

### 6. Zero-duration interval — `{ intervals: [0s, 30s], cycles: 1 }`, elapsed 0
A 0s interval must be skipped, not dwelt on. Correct: `intervalIndex: 1`
(the 30s one is current), `remainingMs: 30000`.

The failure mode to catch: an infinite loop, or landing on index 0 with
`remainingMs: 0` and never advancing — a timer that hangs forever on a
zero-length step. A routine of ALL zero-duration intervals must terminate,
not spin.

## Additional properties I will check that the brief implies but does not enumerate

- **Purity**: calling the function twice with identical arguments returns
  identical results, and it does not read `Date.now()` internally (otherwise it
  is not testable, which the brief explicitly requires).
- **No negative values** for any of the three time fields at any elapsed value.
- **Monotonic**: `totalRemainingMs` never increases as elapsed increases.
