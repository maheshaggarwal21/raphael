---
description: Prove the brain helps — run the eval harness (canaries + ON/OFF lift)
allowed-tools: Bash(raph:*)
---

Run Raphael's eval harness and explain the result honestly.

1. Start with the free check: `raph eval run --dry-run`. It spends nothing — the canary gate
   (chokepoint + declarative-voice probes) plus a retrieval check. Report pass/fail.
2. If they want the full proof, run `raph eval run --quick`. This runs real agents in both arms
   (brain ON vs OFF) and costs model tokens on their subscription. Summarize the table: the safety
   canaries, the task lift, and tokens-per-task.
3. Be honest about the sample size and confidence intervals, and call out any retrieval MISS — a
   brain that does not retrieve the relevant lesson cannot help, no matter how good the lesson is.
   Do not overstate a small result.

The eval is the product's own scoreboard: it exists to catch a brain that looks smart but does not
actually change agent behavior.
