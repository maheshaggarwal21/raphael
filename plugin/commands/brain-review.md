---
description: Review candidate lessons — approve, reject, or edit the queue
allowed-tools: Bash(raph:*)
---

Walk the developer through the review queue. This is the **human gate** — nothing enters the
brain without it.

1. Run `raph queue` and present the numbered candidates compactly: number, title, category, severity.
2. Ask the developer to mark them with a compact grammar, e.g. `1y 2n 3e 4?`:
   - `Ny` — approve candidate N
   - `Nn` — reject candidate N
   - `Ne` — edit N first (run `raph show N` to read the full body, then discuss)
   - `N?` — explain N (run `raph show N`)
   Before approving anything security-related, always show its full body with `raph show N`.
3. Apply their marks:
   - approve: `raph approve <n>` — but **security or quarantined** candidates must be approved
     one at a time with `raph approve <n> --confirmed`, after reading the full body (the code enforces this).
   - reject: `raph reject <n> --reason "<their reason>"` (similar candidates auto-suppress for 180 days).
4. Re-run `raph status` and confirm the new active-lesson count.

Show, don't rubber-stamp. These are the developer's own hard-won lessons; a bad one that activates
will be injected into future sessions.
