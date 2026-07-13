# Academy backlog — the owner's three ideas, expanded

The Raphael Academy (ARCHITECTURE §12) builds real, production-grade projects to train the
brain. The owner proposed three raw ideas on 2026-07-14. Expanded below, with an honest read
on which to build first.

The autonomy boundary (locked): Raphael builds locally and commits locally. It STOPS and
hands to the owner before anything that **deploys, signs in, spends money, publishes, or
pushes to a public remote**. Everything below is scoped so a genuinely useful v1 lands
entirely on the local, reversible side of that line.

---

## Idea 1 (web) — "One Desk": business + personal ops, finance, and an advisor

**Raw idea:** a business management app + personal assistant + advisor + business finance +
personal finance, in one place.

**Expanded.** A single dashboard for a solo founder / freelancer that unifies:
- **Business ops:** clients, projects, tasks, invoices, a simple CRM.
- **Business finance:** income, expenses, category tagging, cash-flow view, tax set-aside.
- **Personal finance:** budgets, subscriptions, net-worth snapshot, savings goals.
- **Assistant/advisor:** a chat layer that answers "can I afford to hire?", "what's my
  runway?", "which client is least profitable?" grounded in the user's own numbers.

**Who it's for:** solo founders and freelancers who currently juggle a spreadsheet, an
invoicing app, and a personal budgeting app, and never see the whole picture.

**Honest read — NOT the first build.** Scope is enormous (this is an ERP + personal-finance
app + an LLM advisor). Two hard problems make it a poor *first* autonomous project: (1) real
value needs bank/accounting integrations (Plaid, Stripe) — which cross the sign-in/spend
boundary and can't be built unattended; (2) an "advisor" that answers money questions edges
toward personalized financial advice, which needs careful framing and disclaimers. Great
**third** project once the Academy is proven. If built, v1 must be manual-entry only (no bank
link) and the advisor must be explicitly "not financial advice."

## Idea 2 (app) — "Rolls": a fully offline photo organizer that groups by face

**Raw idea:** an offline photo categorizer/grouper that divides photos by faces.

**Expanded.** A desktop app that scans a local photo folder and, entirely on-device:
- detects faces, computes a face embedding per face, and **clusters** them so every person
  gets an auto-album — with zero cloud upload.
- also groups by time, place (EXIF), and simple scene tags (beach, document, screenshot).
- lets the user name a cluster once and have it applied everywhere; find "all photos with
  A and B together".

**Who it's for:** privacy-conscious people with a big local photo library who refuse to hand
it to Google/Apple Photos, and anyone offline (limited data, air-gapped).

**Honest read — strong SECOND build.** Genuinely useful, real privacy wedge, and buildable
offline. The hard part is a good on-device face-embedding + clustering pipeline (a real but
solved problem — face-recognition libraries + a clustering step). It's a desktop app
(Electron/Tauri or a Python GUI), which is harder to verify head-lessly than a CLI, so it's
a better second project once the Academy's build+verify loop is proven on a CLI-shaped one.

## Idea 3 (AI agent) — "Repo Keeper": keep your GitHub repos alive  ← **BUILD THIS FIRST**

**Raw idea:** a GitHub manager for your own repos. Old repos die — outdated packages, no
docs, not usable or deployable. Keep them up to date. Plus two more agents: the **security
auditor** and the **doc-sync** agent. Build these three agents.

**Expanded.** A CLI + agent suite that fights repo rot. Three agents over one shared repo
scanner:

1. **Keeper (freshness).** Answers "is this repo still alive?" — detects rot: outdated,
   deprecated, or vulnerable dependencies; an end-of-life runtime (old Node/Python);
   a broken or missing lockfile; missing build/start scripts; an install or build that no
   longer succeeds. Produces a **vitality report** (installable? buildable? deployable?) and
   a **safe update plan** (patch → minor first, changelog-aware, run tests after each step).
   It PROPOSES updates on a local branch; it never pushes or publishes.

2. **Doc-Sync.** Detects when the code has drifted from the docs. v1: check every command,
   script, path, and badge the README claims against what the repo actually has; flag the
   stale ones; regenerate an accurate README skeleton from the manifest + structure.

3. **Security Auditor.** Runs the five-check audit using Raphael's own 26-lesson security
   pack plus free scanners (secret scan, dependency audit), and returns a prioritized,
   **verified** findings report (low false-positive: each finding is confirmed before it's
   shown). This is the productized version of the emergent-security-prompts resource.

**Who it's for:** every developer with a graveyard of half-dead side projects and client
repos they're afraid to touch. The owner has exactly this pain.

**Why it's the first build:**
- Same stack as Raphael (Node CLI + agents) → it builds and verifies **head-lessly**, no UI,
  no device, no emulator. Perfect for an autonomous, test-driven loop.
- **Dogfoods Raphael hard:** the Security Auditor uses the security pack; all three can run
  as Raphael agents and read the project map; the build itself feeds `raph mine`/`distill`.
- Entirely local and reversible — it lives comfortably inside the autonomy boundary (it
  proposes local branches; the owner does any push/deploy).
- Solves the owner's own stated problem.

### Repo Keeper v1 — build plan (milestones)
- **M1** Project scaffold (own repo, package.json, CLI entry, node:test, README, license)
  + shared **scanner core**: stack detection, structure, manifest read, git signals.
- **M2** **Keeper**: dependency-rot + EOL-runtime + missing-scripts detector → vitality
  report + safe update plan. (Registry/`npm` calls injectable so tests stay offline.)
- **M3** **Doc-Sync**: README-drift detector + accurate-README regenerator.
- **M4** **Security Auditor**: wire the security pack + free secret scan + dependency audit
  into a verified findings report.
- **M5** Integration (`keeper report` = all three) + docs + a self-run on Repo Keeper itself.

Each milestone: tests green, checkpoint written, local commit. No push/deploy without the owner.
