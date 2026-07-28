# Observation run 05 — the actual agent roster, manager-orchestrated

**Different code path from runs 01-04.** Those drove Raphael's ACADEMY DRIVER
(`raph academy drive`) — a coded state machine that spawns each stage as a
headless `claude -p` subprocess, mapping fixed stage "kinds" to agents via
policy.js. This run instead invokes the shipped Claude Code subagent roster
directly — `raphael-brain:raphael-manager` via the Agent tool, exactly the way
a real user would type "use the manager to build X" in an interactive session.
Nothing in src/lib/driver.js runs here. This is the first test of whether the
MANAGER can actually orchestrate the other 11 agents via its own Task tool,
including two loops (frontend<->design, reviewer<->debugger) that no recipe or
mission text in agents.js describes as an iterative pattern — checked by
reading RECIPES in src/lib/agents.js first: every recipe is a single agent's
own linear steps, none choreograph agent-to-agent handoffs with a retry loop.

**Role:** observing only. I wrote the project brief and the orchestration
instructions; the manager and its subagents write 100% of the spec, design,
code, and review. I verify the result independently, the same way run 04's
"135 tests" claim was caught — never trust a stage's self-report.

**Subject:** "Notecard" — a local single-page notes app with markdown bodies
(deliberately XSS-relevant, to exercise the security agent), tag filtering,
full-text search, a zero-dependency Node API, and a crafted UI (design-agent
relevant). Brief: .claude/observation/notecard-brief.md. Workspace:
C:/Users/Mahesh/Desktop/Projects/notecard (empty at start).

**Known gap going in, from F4 (2026-07-27):** the shipped Planner mission says
"ask ONE sharp question at a time... until the spec is unambiguous" — correct
for an interactive session, but there is no driver.js-style gate in this path
to catch a stage that stops to ask instead of deciding. The orchestration
prompt explicitly transplants the "no human in the loop, decide and record"
discipline from BOUNDARY_RULES — this is PURE PROMPT STEERING with no
programmatic enforcement, unlike the driver's gateDeliverable(). Whether that
holds without a hard gate is one of the things this run tests.

---

## Pre-flight

- Manager definition confirmed: `tools: ['Read','Grep','Glob','Task']`, model
  per its own agents.js entry (not overridden here) — mission text says "run
  them in the pipeline order... merge their outputs," no explicit retry-loop
  language.
- design agent is read-only (Read/Grep/Glob, no Edit/Write) — cannot make UI
  changes itself. Its output must reach frontend for the loop to mean anything.
- No recipe encodes cross-agent iteration. If a frontend<->design loop happens,
  it's the manager improvising from the ordering instruction, not following a
  written pattern.

## What to watch for

1. Does the manager actually call Task on each named agent, or answer directly
   itself (it is model:haiku per its definition — cheap models sometimes skip
   tool use if not pushed)?
2. Does the frontend<->design loop actually iterate, or run once and stop?
3. Does the reviewer<->debugger loop actually fix what reviewer finds, or just
   report findings without a second pass?
4. Does anything stop to ask a question with nobody able to answer it?
5. Independent verification: do the tests actually pass (own `node --test` run,
   not the stage's claim)? Does the markdown renderer actually escape a real
   XSS payload (own test, not the agent's claim)?
6. Host memory (F9): does this interactive-session path touch
   ~/.claude/projects/.../memory the same way headless runs did, now that the
   steering exists in BOUNDARY_RULES (driver.js) — which this path does NOT
   go through at all, since no driver.js code runs here. If host memory shows
   up in THIS run, it confirms the absorb fix is narrowly scoped to the
   academy driver's prompts and does not reach the plain Agent-tool path.
7. Cost and shape: total tool calls, whether it stayed within one Agent
   invocation or needed resuming.

(continued below as the run progresses)
