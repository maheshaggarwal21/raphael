# Autopilot — zero-touch Raphael (vision + architecture + change plan)

Date: 2026-07-18 (session 13). Owner directive: "install one-time, grant permissions
once, then everything runs on its own — mining, distilling, approving (security lessons
included), atlas, all of it. The user should only notice the RESULT: fewer tokens,
better and safer code."

This document is the brainstorm the owner asked for, resolved into a buildable plan.

---

## 1. The problem, stated plainly

Raphael today is a great ENGINE with a terrible DEFAULT. Everything works, but almost
every step needs a human to type a command or click a button:

| Step                    | Today                                        | Manual? |
|-------------------------|----------------------------------------------|---------|
| Install                 | npm i -g + plugin add + `raph arise`         | 3 steps |
| Consent                 | per-project registration                     | yes     |
| Mining transcripts      | `raph mine`                                  | yes     |
| Distilling lessons      | `raph distill --yes` + cost prompt           | yes     |
| Approving lessons       | `raph approve` / console clicks, per lesson  | yes     |
| Security lessons        | one-at-a-time `--confirmed`                  | very    |
| Building the atlas      | `raph atlas` per project, refresh manual     | yes     |
| Refreshing the atlas    | `raph atlas --refresh`                       | yes     |
| Seeing the value        | `raph stats` / `raph report weekly`          | yes     |
| Injection (recall)      | hooks — automatic                            | NO ✓    |
| Guard (secret scan)     | automatic once installed                     | NO ✓    |

A developer who installs a "learning brain" expects it to LEARN, not to hand them
homework. Every manual step is a place users fall off. The two automatic rows are the
only ones users would actually keep. That is the flaw.

## 2. The target experience (the whole spec in four lines)

1. Install once. ONE consent screen with THREE questions (see §2.2). Answer. Done
   forever.
2. The user codes normally. Raphael mines, distills, screens, approves, indexes, and
   injects — silently, in the background, on the user's existing subscription.
3. Once a week, one small line appears: "Raphael: 12 lessons learned, ~34k recall
   tokens saved. `raph web` to look inside." That's the ONLY thing Raphael ever says.
4. Anything Raphael did can be seen and undone in one click. Visibility replaces
   approval; undo replaces permission.

Principle: **ask once, act always, show weekly, undo anytime.**

### 2.1 The two-brain model (owner spec, 2026-07-18 round 2)

There are TWO brains, not one:

- **GLOBAL BRAIN** — lives on GitHub, owned and curated by the owner. It is the
  distilled, reviewed, public lesson set (today's ancestor: the 26-lesson security
  pack + the adopted packs). The owner upgrades it over time. Every lesson in it is
  tier=curated and has passed human review — it is the trusted seed.
- **LOCAL BRAIN** — on each user's machine (~/.raphael). At install it starts as a
  COPY of the global brain. From then on it learns locally from that user's real
  work. It is private by default (invariant #6).

Flows between the two:

```
            seed at install + occasional updates (down-sync)
   GLOBAL  ──────────────────────────────────────────────────▶  LOCAL
   BRAIN   ◀──────────────────────────────────────────────────  BRAIN
            optional contribution bundles (up-sync, permission #2 only)
```

- **Down-sync**: the local brain occasionally pulls new global lessons. Delivery is
  version-stamped; every incoming lesson STILL passes the chokepoint + machine-
  curator dedupe against local lessons (a global lesson never overwrites or dupes a
  local one). Mechanism: (a) npm package updates carry the current global snapshot
  (npm integrity covers it), and (b) pulse may check the pinned global-brain
  manifest on GitHub (bounded HTTPS GET, hash-verified) so users who never run
  `npm update` still stay current. (b) is a NEW background fetch → invariant #5c
  amendment, scoped to exactly one pinned owner-controlled URL, covered by the
  install consent.
- **Up-sync (contribution)**: ONLY if the user granted permission #2. New locally-
  learned lessons are occasionally batched into a BUNDLE — each lesson goes through
  the existing contribute pipeline first (strip project/paths/evidence refs,
  re-scrub every text field, re-validate through the chokepoint; refuse on any
  failure) — and sent to the global brain's intake. Nothing arrives in the global
  brain unreviewed: bundles land as SUBMISSIONS the owner curates before merging.
  If permission #2 is denied, local lessons never leave the device. Send mechanism,
  in order of preference: (1) a tiny owner-deployed ingest endpoint (one pinned
  HTTPS POST; free serverless worker holding the owner's repo token, so users need
  ZERO auth) → opens a submission PR on the global-brain repo; (2) v0 fallback
  until the endpoint exists: bundles stage locally and the weekly digest offers a
  one-click `raph contribute send`.

This is the flywheel at product scale: every consenting user's real mistakes make
the global brain smarter, and every user inherits the whole community's lessons.

### 2.2 The three install-time permissions

1. **Learn from my work** (record lessons from my projects) — COMPULSORY; without
   it Raphael is pointless. Includes keeping the local brain updated from the
   global brain (down-sync).
2. **Contribute to the global brain** (send my scrubbed, anonymized lessons up in
   occasional bundles) — OPTIONAL. Denied = everything stays on-device forever.
3. **Mode: autopilot / manual** — autopilot is the DEFAULT and the recommendation
   shown on the screen; manual (curator) remains for users who want the queue.

### 2.3 The two usage surfaces (same brain, same feeding)

- **Surface 1 — normal chat**: the user just talks to Claude Code as always. The
  plugin hooks feed the right thing at the right time: relevant lessons at session
  start and per prompt, the atlas digest when the project has one, decisions,
  the weekly digest line. The user does nothing.
- **Surface 2 — Raphael's agents**: the user runs our shipped agents (the 10-agent
  roster + recipes). Same feeding, but sharper because agent intent is known:
  e.g. the moment an agent is about to Grep the repo, the PreToolUse hook fires
  and the brain hands it the atlas instead ("query the graph, don't scan") —
  already live as 16.3. The driver feeds stage-scoped context the same way.

Both surfaces serve the single goal: FEWER TOKENS (atlas answers instead of file
scans, ≤1,200-token recall budget), BETTER CODE, PRODUCTION-GRADE SECURITY (the
global brain's security lessons are in every local brain from minute one).

## 3. The key design move: a MACHINE CURATOR, not a missing curator

The review queue exists because raw model output can be wrong, stale, duplicated, or
poisoned. Deleting the queue without replacing it would make the brain worse than no
brain. So autopilot does not remove curation — it AUTOMATES it. Every layer below
already exists in some form; autopilot wires them into one unattended path:

```
session ends
  └─ mine (deterministic, zero tokens)                        [exists: mine]
       └─ distill w/ gates: ephemera / rubric / dedupe /
          rejection-memory (zero-tool contained model)         [exists: distill]
            └─ REVIEWER SCREEN: a second contained model call
               judges each candidate — true? general? advisory?
               safe? Malformed verdict = fail-closed            [exists in adopt;
                                                                 extend to distill]
                 └─ CANARY GATE: compile with the new batch,
                    run the dry-run canaries (zero spend);
                    any failure = roll the whole batch back     [exists: eval --dry-run]
                      └─ ACTIVATE on PROBATION: computed
                         confidence starts low for auto
                         lessons; the optimizer sweep
                         auto-retires never-firing / low-
                         confidence lessons                     [exists: 16.8 + lint]
                           └─ auto-commit brain repo (full
                              git history = full audit trail)   [exists: commitBrain]
```

The human clicking "approve" is replaced by five machine checks plus a self-cleaning
loop. A bad lesson that somehow survives all five is still only ADVISORY DATA (schema
has no executable fields, no URLs, injected inside a data envelope — invariant #3),
still visible in the activity feed, and still one click from retirement.

## 4. Architecture: the four new pieces

### 4.1 `raph pulse` — the heartbeat (the only new verb)

One verb that runs the whole background loop. Triggered by a **SessionEnd hook**
(plugin/hooks/hooks.json), so it fires exactly when the user stops working — never
competing with them for the session limit.

- Hook calls `raph pulse --async`: spawns a detached child and returns in <50ms so
  session close is instant (Windows-safe: spawn detached + unref).
- The child (`pulse --run`) takes a lock file (one pulse at a time), then:
  1. consent check — no autopilot consent, exit silently.
  2. mine new transcripts since the last watermark (zero tokens).
  3. budget check — daily model-call cap (config `autopilot.daily_calls`, default
     ~20 small calls) AND no active E-LIMIT. Over budget → stop after mining; the
     backlog waits for tomorrow's pulse. E-LIMIT → record reset time, exit clean.
  4. distill the mined episodes (subscription provider, zero-tool, same as today).
  5. machine-curate (reviewer screen → canary gate → activate on probation).
  6. atlas: build if missing, refresh if the repo changed (zero tokens, seconds).
  7. compile the index; append one `pulse` event (feeds stats + the weekly digest).
- EVERY step fails open: any error = log the event, touch nothing, exit 0. A broken
  pulse can never corrupt the brain or bother the user.

### 4.2 Global consent + `mode: autopilot`

- Config gains `mode: autopilot | curator` (existing behavior = curator).
- Consent becomes grantable globally: `consent: all` + an optional ignore list, so
  NEW projects are covered automatically (today each project needs registering).
- The auto-approve dial (Phase 15) gains a top setting: **FULL** = everything the
  machine curator passes activates, security included. The dial's existing
  OFF/STANDARD/WIDE remain for curator-mode users.

### 4.3 One-time onboarding, inside the chat

The "interface that asks for permissions" is the agent itself:

- First SessionStart after install, the hook detects an unconfigured brain and
  injects a tiny one-time onboarding envelope telling the agent to ask the user,
  in plain words, the THREE permissions of §2.2 (learn from my work — required;
  contribute bundles to the global brain — optional; autopilot or manual —
  autopilot recommended) plus one optional extra (install the commit guard?).
  The agent then runs `raph arise --autopilot [--contribute] [--guard]`, which
  also SEEDS the local brain from the global-brain snapshot shipped in the
  package (every seed lesson still enters through the chokepoint).
- After that the onboarding envelope never appears again. Zero further questions,
  ever. (Claude Code itself asks once to allow the plugin's hooks — that OS-level
  prompt is the real permission grant and is out of our hands, which is correct.)
- Existing users flip with one command: `raph auto full` (alias `raph autopilot`).

### 4.4 Passive visibility (the "magic reveal")

The user must NOTICE the value without asking for it:

- **Weekly digest**: at most once every 7 days, the SessionStart injection carries
  one extra ≤150-token block: lessons learned, tokens saved (from the events ledger,
  honest numbers only), security lessons highlighted, "raph web to inspect". If
  nothing happened, nothing is shown.
- **Console = the window, not the workbench**: `raph web` stays exactly as built,
  but in autopilot it's read-mostly — activity feed ("what Raphael did"), one-click
  retire/revoke (undo), and the dial if the user ever wants to step down to curator.
- The brain's git history remains the complete audit trail (every auto-approval is
  a commit with the machine-curation verdicts in the message).

## 5. Security lessons in autopilot — the owner's call, engineered honestly

Owner decision (2026-07-18): security lessons are INCLUDED in auto-approval. This
REVERSES §11.11 (security floor = human-always, decided 2026-07-16). Recorded as a
decided product call; ARCHITECTURE §11 gets the superseding entry and invariant #4
becomes mode-conditional ("security lessons never machine-activate in curator mode;
in autopilot they activate only through the full machine-curation path").

What replaces the human for security lessons, concretely:
1. Structural (strongest): a lesson CANNOT contain commands, URLs, or executable
   anything — the schema forbids it and the chokepoint enforces it. A poisoned
   security lesson can only ever be bad ADVICE, never an action.
2. The reviewer screen runs a STRICTER rubric for category=security: must be
   defensive, advisory, and generic (no project-specific attack detail).
3. The canary gate: the 3 command-shaped chokepoint canaries exist precisely to
   catch injected content that tries to steer an agent — they run on every batch.
4. Digest highlighting: security lessons are always called out in the weekly line,
   so they get eyes-on within days, post-hoc.
5. One remaining floor — QUARANTINED content (text the scrubber/reviewer flags as
   attempted prompt-injection) still never machine-activates. Machine-approving
   content whose defining property is "it tried to manipulate the machine" is
   circular; no screen can clear it. It doesn't nag either: it sits silently in the
   queue, appears in the digest as a count, and auto-expires (tombstone) after 30
   days unreviewed. This is expected to be rare (2 items in the brain's lifetime so
   far) and is the single exception to "zero approvals".

Residual risk, stated plainly: a subtly wrong security lesson could auto-activate
and give an agent bad advice until probation/lint retires it. That risk is real but
bounded (advisory-only + audit trail + undo). The owner accepts it for the UX win.

## 6. What stays manual (on purpose)

- `raph adopt <url>` — inherently user-initiated (invariant #5b: fetch fires only on
  the user's action). Stays a command / console button.
- `raph contribute` — sharing is opt-in per lesson (invariant #6). Stays manual.
- Guard install into a repo's git hooks — modifies the user's repo; asked once at
  onboarding, then automatic forever.
- Academy / driver — the owner's own build tool, not an end-user surface.
- Curator mode — fully preserved for users who WANT the queue. Autopilot is the
  default for NEW installs; existing brains keep their mode until told.

## 7. Change plan — Phase 17 "Autopilot" (dependency order)

- **17.1 Consent + mode substrate** (small): `mode` in config, global consent
  (`consent: all` + ignore list), dial FULL, `raph auto full`. Invariant #4/#5
  wording amendments + §11.13 decision in ARCHITECTURE. Tests: config + dial.
- **17.2 Machine curator** (the safety-critical core, medium): reviewer screen over
  distilled candidates (reuse adopt's reviewer, fail-closed), canary-gated batch
  activation with rollback, probation confidence for auto lessons, quarantine
  30-day tombstone. All in lib (review engine + distill), console-visible. Tests:
  verdict shapes, rollback, security rubric, quarantine floor.
- **17.3 `raph pulse` + hooks** (medium): pulse lib (lock, watermark, budget,
  E-LIMIT handling, fail-open), `--async` detached spawn, SessionEnd hook in the
  plugin, pulse events. Live-verify on this repo's real transcripts. Tests: lock,
  watermark, budget stop, fail-open.
- **17.4 Atlas-in-pulse** (small): auto-build/refresh w/ staleness check (mtime +
  git HEAD), per-project. Zero tokens. Tests: staleness trigger.
- **17.5 Onboarding + digest** (small): first-run envelope + `arise --autopilot`,
  weekly digest block (≤150 tokens, honest numbers, 7-day throttle). Tests:
  one-time-ness, throttle, empty-week silence.
- **17.6 Global brain: repo + seed + down-sync** (medium): promote the global brain
  to a first-class artifact — a `global-brain/` lesson set in the raphael repo
  (starting from the security pack + curated adopted lessons), version-stamped
  manifest with per-lesson hashes; `arise` seeds the local brain from the shipped
  snapshot (all through the chokepoint); pulse down-syncs from the pinned GitHub
  manifest (bounded fetch, hash-verified, dedupe vs local). Invariant #5c
  amendment. Tests: seed idempotence, hash mismatch = reject, dedupe.
- **17.7 Contribution bundles (up-sync)** (medium): permission #2 in config;
  bundle builder over the EXISTING contribute pipeline (strip → re-scrub →
  re-validate, refuse on failure); v0 = staged bundle + one-click
  `raph contribute send` offered in the digest; v1 = owner's serverless ingest
  endpoint (single pinned HTTPS POST, zero user auth) that opens submission PRs
  the owner curates. Nothing enters the global brain without the owner's review.
  Invariant #6 amendment: opt-in moves from per-lesson to the install-time grant
  (per-lesson exclusion still possible in the console). Tests: denied-permission
  = nothing leaves, scrub refusal blocks the bundle, bundle format.
- **17.8 Flip + docs + end-to-end** (small): autopilot = default for fresh installs,
  README/manual rewritten around "install and forget", full live loop verified
  (real session → pulse → new active lesson → next-session injection → digest;
  seed → local learn → bundle staged), version 0.2.0.

Rough total: ~8 working sessions. 17.2 before 17.3 so the unattended loop never
exists without its safety layer; 17.6/17.7 can follow the flip if needed, but the
seed half of 17.6 should land before 17.8 so new installs start from the global
brain, not empty.

## 8. What this is NOT

- Not a daemon/service: pulse is event-driven (session end), no resident process,
  no scheduler to install. Nothing runs when the user isn't using Claude Code.
- Not new network surface: pulse spends only subscription model calls (invariant #5
  unchanged); atlas/mining/compile are zero-token.
- Not removed safety: every existing gate still runs; one gate (human approve) is
  replaced by five machine gates plus undo.
