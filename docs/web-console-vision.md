# Raphael web console + adopt pipeline v2 — brainstorm (pre-architecture)

Date: 2026-07-16, session 06 (second owner message). Status: BRAINSTORM — the input to
the coming architecture plan, not the plan itself. Reality-checked against
ARCHITECTURE.md §0, §9, §11 and the security invariants.

## Owner decisions recorded this round

1. **CLI network fetch is ALLOWED** — invariant #5 will be amended (scope below).
2. "Copying code" clarified: **read + understand external code, then apply patches to
   Raphael itself** — idea adoption and self-improvement, not wholesale vendoring.
3. **A website** for managing Raphael. Two roles: the owner as global admin (approvals,
   details, logs, reports — everything the CLI does), and each user managing their own
   approvals/permissions. The CLI stays; the website is convenience.
4. **Auto-approve must be a user-selectable option** — for the owner and for users.
5. Adopted external info is **screened by a reviewer agent first**, then goes to human
   approval (or auto-approval if enabled).

## The one big fork the vision must resolve: hosted vs local

"Global admin sees every user's details/logs" collides head-on with the privacy hard
rule (§11.8: nothing mined leaves a user's machine automatically; invariant #6). A
central server holding every user's queues/logs would kill the project's trust story.

**Resolution — split the website in two, matching the two audiences already in §9:**

- **The local console (`raph web`)** — a localhost web app every installation gets,
  serving that user's OWN ~/.raphael. Each user is the full admin *of their own data*:
  approvals, permissions, logs, reports, settings. The owner's instance shows his
  everything — he is "global admin" of his Raphael, and the curator tooling lives here
  too. No accounts, no server, no privacy change. This is 90% of the ask.
- **The hosted hub (thin)** — only what is genuinely global: docs, the community pack
  registry, the contribution review flow (a nicer face over the §9 GitHub-PR loop),
  download stats, and OPT-IN anonymous telemetry aggregates. The owner is global admin
  HERE — over community data, never over users' local brains. v1 can be nearly
  serverless: GitHub Pages for docs/registry; PRs stay on GitHub.

What the owner can and cannot see, honestly: contributions users opt to share, pack
stats, opt-in aggregate telemetry — yes. Any user's local lessons, logs, queues — no,
by design, and this is the selling point that makes users prefer Raphael.

## Architecture principle: one engine, three faces

core lib (src/lib — exists) → CLI verbs (exist) → local web console → hosted hub.
The web layer contains ZERO business logic. Every button calls the exact same functions
the CLI calls, so every write still passes validateLesson(), every approval still hits
the same heavyweight paths, and the two faces can never drift. New rule for the plan:
**if a feature can't be done via a `raph` verb, the console may not do it either** —
build the verb first.

## Local console — page-by-page brainstorm

Journey-ordered (what makes users prefer Raphael):

1. **Onboarding wizard** — first-run: consent per project (the §11.1 ask-once),
   starter-pack selection (security pack), guard install, auto-mode choice. Goal:
   time-to-first-value under 5 minutes.
2. **Dashboard** — brain health (doctor), active/candidate counts, tokens this week,
   last injections, limit status, one-line "what Raphael saved you" (stats).
3. **Review queue** — card per candidate: lesson text, category, provenance ("came from
   repo X"), evidence, WHY it was proposed; approve/reject/edit buttons; batch ops
   (the 1y2n3e grammar becomes checkboxes); keyboard shortcuts; security-category cards
   get the heavyweight confirm modal (same code path as `--confirmed`).
4. **Adopt inbox** — THE killer page: paste a URL / drag a PDF / drop a skill file →
   pipeline runs → results appear as review cards with provenance + license verdict.
   History of every adoption. "Revoke everything from this source" button.
5. **Lessons browser** — search/filter (category, tier, scope, fire-count), per-lesson
   `why` view (when it fired, in which sessions), on/off toggle, edit (through the
   chokepoint), retirement suggestions (never-fired list from stats).
6. **Activity feed** — live tail of events.jsonl: what was injected into which session
   and why, misses, cap hits. Makes the invisible visible — trust through transparency.
7. **Projects portfolio** — academy list + per-project status/tests/tokens/lessons
   written; the weekly report rendered.
8. **Agents & skills gallery** — the roster with spines visible, per-agent on/off,
   skills list, community-pack browser with one-click install (lands via chokepoint).
9. **Settings** — consent registry, injection budgets, model policy, token budgets,
   guard allowlist editor, and the **auto-approve dial** (below).
10. **Guard page** — last scan results, allowlist with reasons, "scan now".

Console security (the part nobody thinks about until it bites):
- Bind **127.0.0.1 only**; random port; a session token in the URL on launch; check the
  `Origin` header on every request. Why: malicious websites in a normal browser tab can
  send requests to localhost servers (CSRF / DNS-rebinding — a classic real attack
  class against local dev daemons). No LAN exposure without an explicit flag + warning.
- **Everything rendered is untrusted text** — lessons come from mined transcripts and
  adopted internet content. Escape all output (the One Desk XSS lesson), strict CSP,
  fully self-contained assets (no CDN), never render adopted content as HTML.
- Raw adopted content shown in the UI passes the scrubber first (no secret echo).
- Concurrency: CLI and console both write to ~/.raphael → both already use atomic
  tmp+rename; console re-reads before write; keep single-process server.
- Tech: **zero new runtime deps** — Node's http module + vanilla static HTML/JS
  (decided; same shape as One Desk's static dashboard, proven). A framework is a
  conscious later call if the console outgrows this.

## Auto-approve — the dial, not a switch

§9 already designed this as **auto mode** with a restricted tier. The console exposes
it as a per-category dial:

| Level | What activates without a human | Blast radius control |
|---|---|---|
| OFF (curator default) | nothing | — |
| STANDARD (arise default) | non-security lessons passing EVERY gate | `auto` tier: project scope, cap 30, never shared, one-click revoke |
| WIDE | + adopted lessons after the reviewer agent passes them | + per-source revoke, daily cap, provenance tag |
| Security / self-patches | **never auto** (see below) | human always |

Poisoning defenses when auto-approve is ON (the gap the owner should care about):
- every auto item tagged `machine-approved` + its source → **bulk revoke by source**;
- daily auto-activation cap (a flood is a signal, not a convenience);
- optional quarantine delay ("activates in 7 days unless flagged");
- deterministic gates (scrub, schema, no-URL, license) can never be turned off — they
  are not judgment calls, they are chokepoints.

**The pushback (recorded honestly):** the owner asked for auto-approve on *everything*.
Recommendation: keep §11.9 / invariant #4 — security-category lessons and patches to
Raphael's own code always pass a human. Reasons: (1) the reviewer agent is a model and
models can be fooled by crafted content — that is the exact attack the human gate
exists for; (2) a poisoned security lesson or a patch to scrub.js/validate.js is
game-over, not an inconvenience; (3) the console makes the human step ONE CLICK, so the
annoyance argument mostly dissolves. If the owner still wants full auto after reading
this, that is an explicit invariant amendment only he can make — it will be recorded,
not slipped in.

## Adopt pipeline v2 (fetch allowed) — the layered gauntlet

Invariant #5 amendment (to be written into ARCHITECTURE.md in the plan):
network = (a) model access, (b) **user-initiated, read-only fetches for `raph adopt`**:
https GET only, no auth headers/cookies ever sent, size cap, timeout, content-type
checks, fetched bytes treated as data, never executed, provenance recorded. No
background crawling; a fetch happens because a user asked for that source.

The gauntlet every adopted item runs:
1. FETCH (bounded, read-only) → raw snapshot + provenance record (source, date,
   license detected, hash).
2. DETERMINISTIC PRE-GATES — secret scrub, size/type sanity, license detection.
3. **REVIEWER AGENT** (owner's design, adopted) — zero-tool contained model screens
   for: prompt-injection attempts aimed at agents, malicious install instructions,
   licensing red flags, junk/low-quality content. Verdict + reasons attached to the
   candidate. It reduces what reaches the human; it does not replace the gates.
4. DISTILL (existing contained pipeline) → typed outputs: lessons / skill drafts /
   worth-installing verdicts / **patch proposals**.
5. DETERMINISTIC POST-GATES — the chokepoint: schema, no-URL, no-executable-fields,
   dedupe, rejection memory.
6. HUMAN or AUTO per the dial (with the security/self-patch floor).

Why layers 2 and 5 exist even with layer 3: a model reviewer can be socially
engineered by the very text it reviews; regex and schema cannot. Defense in depth is
the design, not redundancy.

## Read-understand-patch (self-improvement from external code)

Pipeline: external code → understanding → a patch proposal written in Raphael's own
style (idea-level adoption). Rules:
- lands as a **branch + PR-style proposal**, never direct to main;
- full test suite + eval harness must pass before it is even presented ("no
  measurement, no mutation");
- provenance note in the proposal; near-verbatim ports of copyleft code flagged and
  blocked (ideas are free; close translation is still a derivative work);
- patches touching chokepoint files (validate.js, scrub.js, guard.js, provider.js)
  are security-critical → heavyweight confirm, never auto;
- every applied patch gets a rollback note (git revert target recorded).

## Edge cases & gaps (the ones the owner asked me to find)

1. **Phone → PC gap.** The scrolling happens on the phone; the console runs on the PC.
   v1: send yourself the link, paste into the adopt inbox (honest, zero infra).
   v2 options: PWA share-target, or a tiny hosted inbox (needs accounts — cost).
   Decided: defer to v2, revisit after console MVP.
2. **Review flood.** One big adopt can spawn 50 candidates. Needs: batch UI, per-source
   trust levels ("always send repo X straight to queue top"), a daily digest instead of
   50 pings.
3. **Undo everywhere.** Web UIs make destructive actions one accidental click. Needs:
   deactivate (not delete) as default, tombstones (exist for reject), bulk revoke,
   confirm modals only for the truly destructive.
4. **Global metrics need telemetry.** "View every detail" about the user base
   (installs, projects delivered) requires opt-in, anonymous, aggregate-only telemetry
   — off by default. Without it the honest answer is "we don't know how many users."
5. **Console lifecycle on Windows.** `raph web` runs foreground first (Ctrl+C to
   stop); tray/service later. Port collisions handled (random port, printed + opened).
6. **Auto-update of Raphael itself.** Users on old versions + signed pack updates
   already designed (§9); self-code updates via npm remain manual (`npm update -g`) in
   v1 — an auto-updater is post-v1 and needs signing thought.
7. **Model dependency.** The reviewer agent + distillation need the subscription CLI or
   an API key. The console must degrade gracefully: no model → adopt queues raw
   snapshots and says so, deterministic-only features still work.
8. **Two Raphaels, one machine / many machines.** The brain is a git repo — multi-PC
   sync via the user's own private remote is the natural v2 (console gets a "sync"
   button); never through our servers.
9. **Legal shell for the hub.** Accounts + hosted content = ToS/privacy policy +
   moderation duty for contributed packs. Static-first postpones almost all of it.
10. **Accessibility + i18n** later; keyboard-first review UX from day 1 (power users
    are the early adopters).

## Updated build tracks (supersedes company-vision.md Part 8 ordering)

- **Track A — adopt pipeline v2**: fetch (amended invariant), provenance ledger,
  reviewer agent, typed outputs incl. patch proposals. CLI-first (`raph adopt`).
- **Track B — local console MVP (`raph web`)**: dashboard, review queue, lessons
  browser, adopt inbox, settings w/ auto-approve dial. Zero-dep static app.
- **Track C — company ops** (unchanged: driver, scheduler, budgets, reports, meta-agents).
- **Track D — distribution + thin hub**: npm publish, docs site, pack registry
  (static), contribution flow face. At launch time.

Order: A → B (the console's killer page needs A's engine), C interleaved, D last.

## Decisions for the owner (the only two that are his)

1. **Security floor:** keep "security lessons + self-patches always pass a human, one
   click on the console" (recommended) — or explicitly amend invariant #4/§11.9 for
   full auto-approve everywhere.
2. **Hub scope at launch:** static-only (docs + registry on GitHub Pages, ~zero cost,
   no accounts) — recommended start — or a full hosted app with accounts/OAuth
   (recurring cost, maintenance, legal shell).

Everything else (tech choices, ordering, phone-inbox deferral) is decided above under
the standing mandate. Next step after the owner's read: fold this + company-vision.md
into ARCHITECTURE.md (new §13 web console, §14 adopt v2, invariant amendments) and a
real TASKS phase plan — then build.
