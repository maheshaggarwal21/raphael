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

1. Install once. One consent screen ("Can Raphael learn from my projects and manage
   its lessons itself?"). Answer yes. Done forever.
2. The user codes normally. Raphael mines, distills, screens, approves, indexes, and
   injects — silently, in the background, on the user's existing subscription.
3. Once a week, one small line appears: "Raphael: 12 lessons learned, ~34k recall
   tokens saved. `raph web` to look inside." That's the ONLY thing Raphael ever says.
4. Anything Raphael did can be seen and undone in one click. Visibility replaces
   approval; undo replaces permission.

Principle: **ask once, act always, show weekly, undo anytime.**

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
  injects a tiny one-time onboarding envelope telling the agent to ask the user, in
  plain words, ONE question with three checkboxes: learn from my projects in the
  background? (yes) — include security lessons? (yes) — install the commit guard?
  (optional). The agent then runs `raph arise --autopilot`.
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
- **17.6 Flip + docs + end-to-end** (small): autopilot = default for fresh installs,
  README/manual rewritten around "install and forget", full live loop verified
  (real session → pulse → new active lesson → next-session injection → digest),
  version 0.2.0.

Rough total: ~6 working sessions. 17.2 before 17.3 so the unattended loop never
exists without its safety layer.

## 8. What this is NOT

- Not a daemon/service: pulse is event-driven (session end), no resident process,
  no scheduler to install. Nothing runs when the user isn't using Claude Code.
- Not new network surface: pulse spends only subscription model calls (invariant #5
  unchanged); atlas/mining/compile are zero-token.
- Not removed safety: every existing gate still runs; one gate (human approve) is
  replaced by five machine gates plus undo.
