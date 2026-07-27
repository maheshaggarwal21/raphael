Build "Gatepost": a self-hosted feature-flag and runtime-config service that a small
team can run on one box, with no external dependencies.

Why it exists: feature-flag services are either SaaS (send your traffic to a vendor)
or heavyweight (Redis, Postgres, a control plane). A team that wants a kill switch
for a risky feature should be able to run one file and get one.

Core requirements:
- A flag store: named flags, each either on/off or a percentage rollout, plus
  optional per-environment values (dev/staging/prod). Reads must be fast and must
  never fail closed in a way that takes the caller's app down.
- An HTTP API: read flags (public to the caller's app, authenticated by a
  project-scoped read key) and write flags (authenticated by a separate admin key).
  Reading must never expose another project's flags.
- A CLI to create projects, mint and rotate keys, set flags, and inspect state.
- A small web console page to view and toggle flags.
- An audit trail: every write recorded with who, what, when, and the previous value,
  so a bad flag flip can be explained and reverted.

Constraints:
- Node.js ESM, Node >= 18. ZERO runtime dependencies — the standard library only.
- Windows-first: no POSIX assumptions, no flock, atomic writes via temp-file+rename.
- Persistence is local files. No database.
- Automated tests with node:test. The suite must be green and must cover success,
  failure, and edge cases for every function.
- Secrets (keys) must never be written to logs or committed to the repo.

Out of scope: deploying it, publishing it, any hosted component, any sign-up flow.
