---
description: Mine your recent sessions and distill them into candidate lessons
allowed-tools: Bash(raph:*)
---

Turn the developer's recent real work into candidate lessons for the brain.

1. Run `raph mine` to read this project's session history and extract episodes — the
   error→fix moments and user corrections worth learning from. Report how many it found.
2. Run `raph distill` to turn those episodes into gated candidate lessons. This uses the
   developer's Claude Code subscription by default (fixed price, no API key). If it reports a
   usage limit or a missing model, say so plainly and stop — do not retry in a loop.
3. Summarize what was mined and distilled, then send them to `/brain-review` to approve.

Distillation only ever produces **candidates**. Never approve lessons here — a human reviews
them in `/brain-review`. Everything mined stays local.
