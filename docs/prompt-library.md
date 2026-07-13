# Prompt library — extracted from Mahesh's saved screenshots

Source: 23 screenshots in `Desktop/Media/` (transcribed 2026-07-13). Two carousels:

- **@the_coding_wizard** — "AI News & Tools", a 13-slide set of senior-engineer *role*
  prompts for Claude (coding work).
- **@nicolasboucherfinance** — a 14-slide set of general *prompting techniques*.

This file is reference material for designing Raphael's agent prompts (ARCHITECTURE §8).
It is NOT a lesson and never enters the brain — it is human design input only.

> Honest note on the source: these are social-media prompt templates. They are useful as
> *role framing and structure*, not as gospel. Raphael's agents should take the shape
> (senior-role framing, explicit deliverables, "don't change behavior" guardrails,
> think-before-acting) and drop the hype ("genuinely dangerous", "monster"). Where a
> template says "provide production-ready code" with no verification step, Raphael adds
> the verification step — that discipline is the whole point of the product.

---

## Part 1 — Senior-engineer role prompts (@the_coding_wizard)

These map almost one-to-one onto Raphael's agent roster. Each is a "act like a senior X"
role frame + explicit deliverable list + a guardrail.

### 2/ Audit a codebase like a senior engineer  → **Reviewer / Architect**
> Act like a senior engineer who just joined a massive unfamiliar codebase. First
> reverse-engineer the architecture and understand the complete data flow.
> Then identify: bad architecture decisions · duplicate logic · performance bottlenecks ·
> scalability risks · maintainability issues.
> Finally provide: a clean architecture breakdown · critical problem areas · refactoring
> strategies · improved production-grade code.
> **Do not change functionality. Only upgrade code quality, scalability, maintainability.**

### 3/ Production-level debugging  → **Debugger**
> Act like a senior debugging engineer investigating a live production issue. Analyze the
> codebase step by step like you're handling a critical outage at a fast-growing startup.
> Your job: understand what the code actually does · trace the real root cause · explain
> why the failure happens · identify hidden edge cases · propose the most robust fix.
> Provide: code functionality breakdown · root cause analysis · failure explanation ·
> edge case analysis · fixed production-ready code.
> **Do not guess. Think deeply before making changes.**

### 4/ Performance optimization engineer  → **Reviewer (perf lens) / Developer**
> Act like a senior performance engineer optimizing a production application used by
> millions. Goals: maximum speed · lower memory · better scalability · faster rendering ·
> cleaner execution.
> Identify: performance bottlenecks · inefficient logic · unnecessary rendering ·
> expensive operations · memory leaks.
> Provide: performance issue breakdown · optimization strategies · improved
> production-ready code · scalability recommendations.

### 5/ Rebuild messy code into clean scalable architecture  → **Architect / Reviewer**
> Act like a senior software architect rebuilding a messy production codebase using clean
> architecture principles. Mission: separate concerns · increase modularity · reduce tight
> coupling · improve scalability · make it maintainable long term.
> **Do NOT change product behavior. Only improve architecture and code quality.**
> Provide: new folder structure · clean architecture breakdown · refactored
> production-grade code · explanation of architectural improvements.

### 6/ Architect a startup backend like a senior systems engineer  → **Architect**
> Act like a senior systems architect designing infrastructure for a high-growth startup.
> First design a scalable production-grade system architecture. Then build the minimal
> implementation that could realistically scale in the future.
> Include: system architecture · component structure · data flow · API design · database
> schema · caching strategy · production-ready implementation code.
> Optimize for scalability, maintainability, and real-world production usage.

### 11/ Senior DevOps + Deployment Engineer  → **Deployer**
> Act like a senior DevOps engineer preparing this application for real production
> deployment. Job: design deployment architecture · configure CI/CD · set up
> monitoring/logging · improve reliability · reduce downtime risks · optimize scaling.
> Provide: infrastructure architecture · deployment workflow · CI/CD pipeline ·
> Docker/Kubernetes setup · monitoring strategy · production deployment checklist.

*(Slides 1, 7–10, 12–13 of that carousel were not in the screenshots — only 2,3,4,5,6,11.)*

---

## Part 2 — Prompting techniques (@nicolasboucherfinance)

Structural techniques for how Raphael's agents should *build* their prompts — especially
the Planner and Manager, who compose instructions for other agents.

### Basic prompting — two frameworks (slide 3/14)
- **CSI** = **C**ontext · **S**pecific · **I**nstruction  (the minimum viable prompt)
- **FBI** = **F**ormat · **B**lueprint · **I**dentity  (the elaboration on top)
- Example: "I am an accountant, my client is 2 months overdue, draft a communication"
  (CSI) + "make it a formal letter, firm, mention legal action, write it as the best
  lawyer would" (FBI).

### Chunking (slide 5/14)
Break complex information into smaller manageable chunks — for INPUT (feed a big document
in parts) or OUTPUT (ask for the answer in several passes). Example directive:
"**Only answer one cause at a time.**" → directly relevant to Raphael's token budgets and
to keeping agent turns small.

### Socratic prompting — 3 steps (slide 8/14)
1. Pose questions that don't have straightforward answers.
2. Use questions that encourage the AI to reconsider.
3. Prompt the AI to clarify and expand on its answers.
Example: "I have a team of 5 finance professionals, what's the best development program
and why?" → "Which assumptions did you use? Which needs reconsidering? Now clarify."
→ maps to the **Critique** agent's job.

### Agent prompting — 9 traits (slide 9/14)
Frame a prompt as a persistent agent by defining: **Name · Definition · Knowledge ·
Traits · Analysis · Output · Format · English · Start.** This is essentially a system-
prompt schema → the template for each Raphael agent's spine.

### Team prompting (slide 10/14)
A group of agents where **the output of one is the input of the next.** Example: FP&A
Expert analyzes → Marketing Manager builds on that → Web Developer implements. This is
exactly Raphael's **Manager → Planner → Architect → Developer → Reviewer** pipeline
(ARCHITECTURE §8) and the self-training pipeline (§12).

### Iterative Inquiry & Sequential Questioning (slide 11/14)
Each question builds on the previous responses to gradually refine understanding.
"Guide me through it by asking one question at a time, each based on my previous answer."
→ the interaction pattern for the Planner when it refines a raw idea into a spec.

---

## How this feeds Raphael's agents

| Screenshot role prompt | Raphael agent | What we borrow |
|---|---|---|
| Audit codebase, rebuild architecture | Architect, Reviewer | reverse-engineer first, explicit deliverables, "don't change behavior" |
| Production debugging | Debugger | root-cause-first, "don't guess, think deeply", edge-case pass |
| Performance engineer | Reviewer (perf lens) | concrete bottleneck checklist |
| Startup backend / systems architect | Architect | full design list: arch, data flow, API, schema, caching |
| DevOps + Deployment | Deployer | CI/CD + monitoring + deployment checklist |
| Agent prompting (9 traits) | all agents | the system-prompt spine schema |
| Team prompting | Manager, Planner | output-of-one-is-input-of-next pipeline |
| Socratic / Iterative Inquiry | Critique, Planner | reconsider-assumptions, one-question-at-a-time refinement |

**What Raphael adds that the templates lack:** every "provide production-ready code" is
followed by an actual verification step (build, test, run), because unverified
"production-ready" output is the exact failure mode Raphael exists to fix.
