# One Desk — Academy project #2 (plan + build spec)

Decision date: 2026-07-14 (session 03). Chosen by Claude on the owner's instruction
"for 3. decide yourself." This is the next autonomous Academy build after Repo Keeper.

## The decision: One Desk, not the photo grouper (and why, bluntly)

The owner gave two remaining ideas: (A) One Desk — a web business + personal ops +
finance + advisor app; (B) an offline photo grouper that sorts by faces.

**I picked One Desk. The photo grouper is the wrong FIRST autonomous build, for one hard
reason:** its entire value is on-device face recognition. That needs a bundled ML model
(face detection + face embeddings) and a GUI to browse the clusters. I cannot honestly
build and *verify* either one head-lessly: I can't reliably download/bundle/validate a
face model with no display to test against, and a photo-browsing UI can't be proven by a
test suite. I would end up shipping something I can't prove works. That is exactly the
"vague/imaginary" trap the owner told me to avoid. Parked, not dropped — it becomes
viable once there's a way to test a real model. (Backlog keeps it.)

**One Desk is buildable AND verifiable.** Stripped to its spine it is a money engine:
deterministic pure functions over transactions. No ML, no GUI, no network, no deploy
needed to prove the core. Same shape as Repo Keeper, which is why that build succeeded.

## The sharp wedge (not "a finance app" — a specific pain)

Solo founders, freelancers, and very small businesses run personal and business money
through overlapping accounts. They chronically cannot answer three concrete questions:

1. **How much of the money in my account is actually mine to spend** — vs owed to tax,
   to real business costs, and to the float the business needs to keep running?
2. **How much can I safely pay myself this month** — after tax set-aside, upcoming
   bills, and a runway buffer?
3. **How long is my runway** — months of survival at current burn?

Mint-style personal apps do not separate business from personal, and never answer #2.
QuickBooks-style tools are built for bookkeepers, not for the "what's really mine"
question. That gap is the wedge. It is a real, painful, recurring problem with clear
willingness to pay — which satisfies the owner's bar: solve a real problem, be sellable.

## Scope discipline (I am NOT building all four things at once)

The owner's phrasing bundled four products (business mgmt + assistant + business finance
+ personal finance). Building all four in one go is how you get vaporware. I am
sequencing. The spine — the money engine + advisor — ships first and stands alone. The
"assistant/advisor" is rules over that engine, not a chatbot. Business-management
features layer on later, only after the spine is proven.

## Milestones (M1 is fully head-lessly verifiable)

- **M1 — money core + advisor (library + tiny CLI).** The transaction model; personal
  vs business split; a rules engine; and the advisor that answers the three questions
  above (safe-to-pay-yourself, tax set-aside owed to date, runway). Pure functions,
  `node:test`, plus an `onedesk` CLI that ingests a sample transactions file (JSON/CSV)
  and prints the advisor report. Zero runtime deps, runs offline. THIS is where value is
  proven.
- **M2 — categorization + recurring detection.** Deterministic category rules, recurring
  charge detection (subscriptions, salary, rent), and anomaly flags ("dining up 60% vs
  3-month average"; "this looks like a business expense sitting in a personal account").
- **M3 — advisor narrative + reports.** Turn the numbers into plain-language guidance and
  a monthly report (the "personal assistant/advisor" the owner asked for), still text /
  file output — no UI yet.
- **M4 — import adapters + persistence.** CSV import from common bank exports; a local,
  file-based store (atomic writes, same discipline as raphael). Still local-first.
- **M5 — thin UI (DEFERRED behind the autonomy boundary).** A minimal local dashboard.
  UI hosting / deploy / any spend stays the OWNER's action until green-lit — same
  boundary Repo Keeper honored.

## How Raphael feeds this build (the flywheel, now live)

The brain now has 29 active lessons (26 security + 3 tooling), approved this session.
One Desk handles financial data, so many of them apply directly and will inject while
building: recompute-on-server / server-is-authority-on-price, keep-PII-and-secrets-out-
of-logs, give-users-a-data-deletion-path, validate-required-env-at-startup,
never-send-stack-traces-to-clients. The tooling lessons (concatenate fake secrets in
tests, downgrade fixture findings, engines floor) carry over verbatim. This is the first
build that starts with a non-empty brain — the point of the whole project.

## Autonomy boundary (unchanged, enforced)

Build local, commit local, and — per the updated working ritual — publish the product
repo once a milestone is coherent and green (as done for Repo Keeper). STOP before any
deploy, hosted UI, sign-in to a third party, or spend. Those remain the owner's actions.

## Workspace

`C:\Users\Mahesh\Desktop\Projects\onedesk` — its own git, local-first. Node ESM, node:test,
zero-runtime-dep core, same conventions as repo-keeper.
