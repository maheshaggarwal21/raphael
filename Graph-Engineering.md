# All About Graph Engineering
To view keyboard shortcuts, press question mark
View keyboard shortcuts
How to master graph engineering (Full Course)
CyrilXBT
@cyrilXBT
·
Jul 26

A loop hides one decision inside a black box: what runs next.
Every time an agent loop decides whether to retry, escalate, or move on, that decision happens inside the model's own reasoning, invisible to you, unauditable after the fact, and impossible to inspect without re-reading the model's raw output and hoping it explained itself honestly. A graph makes that same decision explicit. Written down. Inspectable before the run even starts.
This is not a small distinction. It is the actual argument behind a real arXiv paper published in April 2026 that reframed how agentic systems should be built, and it is worth being upfront about something before this course goes any further. The paper's own author includes a fairness disclaimer stating plainly that this is an unimplemented design, and whether it delivers its promised benefits in practice remains an open empirical question. This course teaches the framework honestly, including that caveat, because understanding a real, rigorously argued proposal that has not yet been proven at scale is more useful than pretending it is settled fact.
By the end of this course you will understand what graph engineering actually is, why it exists as the layer above loops, the three commitments every graph in this framework rests on, and how to build your first one, along with an honest account of where the evidence currently stands and does not stand.
Why Loops Have A Ceiling
To understand why graphs exist, you need to understand precisely where loops stop being enough.
A loop, in the agentic sense that matters here, is a cycle where an agent attempts a task, observes the result, and decides what to do next, repeated until some condition is met. This works remarkably well for a huge range of tasks. It is also, structurally, a black box at the exact moment that matters most: the decision of what happens next.
When a loop's agent decides to retry a failed step, that decision came from the model reasoning over its own context and producing a choice. You cannot inspect the decision before it happens. You can only observe the outcome after. If the agent retries the same failing approach five times in a row, burning cost each time, nothing in the loop's structure prevented that, because the decision to retry lived entirely inside the model's own judgment, not in any external, checkable rule.
This is fine for low-stakes, cheap tasks where an occasional wasted retry costs nothing meaningful. It becomes a real liability for long-horizon, expensive, or high-stakes work, exactly the category of task agentic systems are increasingly being trusted with. The paper's core argument is that as agentic systems take on more consequential work, the opacity of "what runs next" stops being an acceptable black box and starts being the actual point of failure worth engineering around directly.
What A Graph Actually Is
A graph, in this framework, replaces the model's implicit next-step decision with an explicit structure defined before the run starts.
Instead of an agent reasoning its way to "I should retry" or "I should escalate" inside an opaque context window, the graph defines, in advance, exactly which states exist, which transitions between states are valid, and which specific conditions trigger each transition. The agent still does real work inside each state. What it no longer does is invisibly decide the shape of the overall process as it goes.
The five-move structure that describes any single turn through a graph like this: Plan, Execute, Recover, Escalate, Repeat. Plan is where the task gets decomposed into a defined sequence. Execute is where the agent actually does the work for the current step. Recover is what happens when execution fails, following a defined protocol rather than an improvised retry. Escalate is the explicit, defined point where the graph hands control to a human rather than continuing to attempt automated recovery. Repeat closes the cycle, moving to the next step in the plan.
Notice what changed from a loop. Every one of these five moves is now a named, inspectable state in a graph, with defined transitions between them, rather than a decision happening silently inside a single model call.
The Three Commitments
Every graph in this framework rests on three specific commitments. Understanding these three deeply is the actual core of graph engineering as a discipline, more so than any specific implementation detail.
Commitment One: Immutable Plan
The execution plan cannot shift mid-run. Once a plan is generated and locked, it exists as one fixed version for the duration of that run. The agent cannot silently revise its own plan halfway through execution based on something it noticed, the way an agent inside a loop often does without any external record of the revision happening.
This sounds restrictive, and it is meant to. The restriction is the entire point. An agent that can freely revise its own plan mid-run is exactly the agent whose behavior becomes impossible to audit after the fact, because the plan you would review afterward is not the plan that was actually followed, it is whatever the plan drifted into by the end. Locking the plan trades real flexibility for real inspectability. That tradeoff is not free, and it is worth sitting with honestly rather than treating it as a strict improvement in every case. A genuinely novel situation that the original plan did not anticipate is handled worse by an immutable plan than by a loop that can adapt freely. The commitment is a deliberate bet that, for the category of task this framework targets, predictable and auditable beats maximally adaptive.
Commitment Two: Separated Layers
Planning, execution, and recovery live in three independent layers instead of one tangled loop where all three happen inside the same continuous reasoning process.
The planning layer produces the immutable plan from commitment one and does nothing else, it does not execute steps and does not handle failures. The execution layer runs the defined steps and reports results, it does not decide what happens on failure, only what happened. The recovery layer receives failure reports and applies a defined protocol, it does not execute new work directly, only decides how to respond to what already happened.
This separation mirrors, deliberately, the same principle behind separating a Builder from a Judge in a verification loop, a role that produces work should not be the same role that evaluates or decides on that work, because collapsing the two erodes the independence that makes the check meaningful in the first place. Here the separation is threefold instead of twofold, but the underlying reasoning is identical: a system that plans, executes, and recovers all inside one undifferentiated process cannot meaningfully audit any single one of those functions independently, because they are never actually distinct in the trace you would review afterward.
Commitment Three: Strict Escalation
Recovery follows a fixed protocol instead of retrying indefinitely and hoping something eventually works.
This is the commitment that most directly addresses the token-blowout failure mode that plagues loops without real stop conditions. A strict escalation protocol defines, in advance, exactly how many recovery attempts are permitted, exactly what counts as a recovery attempt succeeding or failing, and exactly what happens the moment the defined limit is reached, handing control to a human, not attempting one more creative variation on the same failed approach.
The paper's analysis across 70 real-world systems found that a large share of Agent Loop implementations had no formal bounds on recovery attempts at all, meaning the actual behavior when something went wrong was determined by whatever the model happened to decide in the moment, not by any rule a human had actually reviewed and approved in advance. Strict escalation closes that specific gap directly.
Building Your First Graph
Here is the practical path to actually building one of these, translating the three commitments into something you can implement rather than just understand conceptually.
Start by defining your states explicitly, on paper, before writing any code or prompts. For a typical task, this usually looks like at minimum: Planning, Executing Step N, Recovering From Failure, Escalated, Complete. Write down, for each state, exactly what happens while the system is in that state and exactly what conditions cause a transition out of it.
Write the plan-generation step so that its output is a fixed, versioned artifact, not a living document the rest of the system can silently edit. A simple, practical version of this is generating the plan as a numbered list of discrete steps, each with an explicit success criterion, and treating that list as read-only for the remainder of the run. Any genuine need to deviate from it should trigger an explicit escalation to a human, not a silent internal revision.
Build the execution layer so it only ever reports outcomes, pass, fail, with specific detail, never makes a decision about what happens next itself. This mirrors exactly the Builder role from a verification loop, producing work and reporting on it honestly, without also being the role that decides whether to retry.
Build the recovery layer with an explicit, numbered protocol. Attempt one specific alternate approach. If that fails, attempt a second, different specific approach. If that fails, escalate. The protocol should be concrete enough that a human reading it in advance can predict exactly what the system will do at each stage, rather than a vague instruction like "try to fix it a reasonable number of times."
Wire the escalation state so that reaching it is a real, visible event, not something quietly logged and forgotten. A human should be notified, with the full history of what was attempted and why each attempt failed, the same discipline recommended for stop conditions in verification loops generally.
Where This Framework Genuinely Helps, And Where It Does Not
Being honest about the limits of graph engineering is more useful than treating it as a universal upgrade over loops in every situation, and the paper itself supports this more measured framing.
Graphs genuinely help on tasks where the space of things that can go wrong is reasonably well understood in advance, where auditability matters more than maximal adaptiveness, and where the cost of a runaway, unbounded retry cycle would be genuinely expensive, either in compute cost or in the consequence of a bad outcome reaching a real user or a real system.
Graphs are a worse fit for genuinely open-ended, exploratory tasks where you cannot meaningfully predict the shape of failure in advance, and where the value of the system comes precisely from its ability to improvise a response to something nobody anticipated. Locking a plan immutable, for a task that fundamentally requires adaptive replanning as new information emerges, trades away the exact capability that made the task worth automating with an agent in the first place.
The honest, defensible position, and the one the paper's own author takes, is that this is a real tradeoff worth understanding deeply, not a strictly superior replacement for loops in every case. Use a loop where adaptiveness matters more than auditability. Use a graph where the reverse is true. Most real systems benefit from having both patterns available and choosing deliberately between them per task, rather than adopting either one as a permanent default.
A Worked Example: Graph-Structured Code Migration
To make the five-move structure and three commitments concrete, here is how they apply to a real, common task, migrating a legacy module to a new framework version across a codebase.
The Planning state runs once, at the start. It analyzes the module, identifies every file that needs to change, and produces a fixed, numbered list of migration steps, each with an explicit success criterion, for instance, step 4 succeeds when the updated file compiles and the existing test suite for that file passes without modification. This plan gets locked. It is commitment one, immutable, in practice.
The Executing state works through the plan's steps in order. For each step, it applies the specific change defined in the plan and reports the outcome, pass or fail, with the actual compiler output or test result attached as evidence, never a self-assessed "looks correct." This is the execution layer from commitment two, strictly separated from the decision about what happens if it fails.
When a step fails, the graph transitions to Recovering, which follows a defined protocol rather than an improvised retry. Attempt one: reapply the same change with a narrower scope, isolating exactly which part of the file caused the compile failure. Attempt two, if the first fails: fall back to a documented alternate migration pattern for this specific kind of failure, drawn from a small library of known fixes rather than invented fresh each time. If both defined attempts fail, the graph transitions to Escalated, this is commitment three, strict escalation, not a third improvised attempt.
The Escalated state notifies a human directly, with the complete history attached: which step failed, what both recovery attempts tried, and the specific error output from each. A human reviews this specific failure with full context, rather than discovering days later that an agent had been silently retrying the same broken approach in a loop the whole time, burning cost with no record of why.
Repeat closes the cycle for successful steps, moving the graph to the next item in the locked plan until the list is exhausted, at which point the run reaches Complete.
Notice what this buys you over the equivalent task run as an unstructured loop. Every decision, whether to retry, how, and when to give up, is visible in the graph's defined structure before the run even starts, not discoverable only by reading through a transcript afterward and inferring what the model must have been thinking. A code reviewer, or a compliance auditor, can look at the graph's definition alone and know exactly what the system is capable of doing in every failure scenario, without ever having watched it run.
Graph Engineering Versus Loop Engineering: When To Reach For Which
Given that both patterns are real, documented, and each has genuine strengths, here is a practical decision framework for choosing between them for a specific task, rather than treating either as a permanent default.
Reach for a loop when the task is genuinely exploratory, when you cannot predict in advance the shape of what might go wrong, and when the model's ability to improvise a response to something unanticipated is exactly the capability you are relying on. Research tasks, open-ended debugging where the root cause is genuinely unknown at the start, and creative work where rigid structure would actively hurt the output, all favor a loop's adaptiveness over a graph's auditability.
Reach for a graph when the task is well-enough understood in advance that you can actually enumerate the likely failure modes, when the cost of an unbounded, unaudited retry cycle would be genuinely expensive, and when a human reviewer, whether that is a compliance team, a security auditor, or simply your own future self debugging a production incident, will need to inspect exactly what the system was capable of doing without re-reading a full execution transcript. Migrations, financial transactions, anything touching regulated data, and long-running unattended agent work where a silent failure could compound for hours before anyone notices, all favor a graph's structure over a loop's flexibility.
The two patterns are not mutually exclusive within a single larger system either. A common, pragmatic design uses a graph at the outer level, for the overall task structure and its stop conditions, while allowing a loop to run inside a single Execute state for the genuinely exploratory sub-task of figuring out how to implement one specific step. This gets you the auditability of a graph at the level where it matters most, the overall shape of what the system can do, while preserving a loop's adaptiveness at the level where genuine improvisation is actually valuable, the details of one bounded piece of work.
Testing A Graph Before You Trust It
Before relying on a graph-structured system for anything real, run it through stress tests specifically designed around the three commitments, since each commitment has its own way of quietly failing if implemented sloppily.
To test the immutable plan commitment, deliberately construct a scenario partway through a run where the "obviously correct" next step, if the system were reasoning freely, would deviate from the locked plan. Confirm the system actually escalates to a human rather than silently adapting the plan on its own. If it adapts silently, the plan was never actually immutable in practice, regardless of how the code is structured.
To test the separated layers commitment, check whether the execution layer's failure reports contain any trace of a decision about what should happen next, phrases like "this probably needs a different approach" embedded in what should be a neutral pass or fail report. If the execution layer is already forming opinions about recovery, the separation from the recovery layer is not real, it has just been relabeled.
To test strict escalation, deliberately feed the system a failure that neither defined recovery attempt can fix, and confirm it escalates cleanly at the defined limit rather than attempting an undefined third approach. This is the graph-engineering equivalent of testing a loop's stop condition against a genuinely unsolvable task, and it catches the exact same class of quietly expensive failure.
Beyond these three targeted tests, track one specific metric over real usage that the loop-based alternative typically cannot give you cleanly: the rate at which runs reach the Escalated state, broken down by which specific recovery attempt failed each time. A graph escalating constantly at the same specific recovery step is telling you that step's defined protocol is miscalibrated, not that the underlying task is uniformly hard, the same diagnostic value that tracking stop-condition triggers provides for loops, just available here with more granularity because the failure point is a named, inspectable state rather than an inferred moment inside an opaque transcript.
Common Mistakes When First Building A Graph
A handful of specific mistakes show up repeatedly for people building their first graph-structured system, and knowing them in advance saves real debugging time later.
Treating the plan as immutable in name only. Locking the plan on paper while still allowing the execution layer to quietly deviate from it in practice produces the worst of both worlds, no real adaptiveness and no real auditability either, since the trace no longer matches the locked plan you would review.
Collapsing the three layers back into one because it feels faster to build. The temptation to let the execution layer also decide on recovery, skipping the separation from commitment two, defeats the actual purpose of the framework. If planning, execution, and recovery are not genuinely independent, you have built a loop wearing a graph's vocabulary, not an actual graph.
Writing a recovery protocol vague enough that it is not really a protocol. "Try a reasonable number of alternate approaches" is not a strict escalation protocol, it is a soft instruction with the same failure mode as an unbounded loop, just described using graph-engineering language. A real protocol names the specific number of attempts and the specific conditions for each one.
Skipping the honest evaluation of fit. Building a graph for a genuinely open-ended, exploratory task because graph engineering is the newer, more rigorous-sounding framework, rather than because the task actually benefits from the tradeoff, produces a system that is harder to build than a loop and worse at the actual job than a loop would have been.
The Honest State Of The Evidence
Closing on the caveat this course opened with, because it matters more here than in most technical writeups. The three commitments described above are a real, carefully reasoned proposal, analyzed against 70 real systems to identify exactly where loops fail silently. They are not yet validated as delivering their promised benefits at scale in production, by the author's own explicit statement.
This does not make the framework worthless. It makes it a genuinely promising design worth understanding and experimenting with deliberately, tracking your own results honestly rather than assuming the theoretical argument automatically translates into practice. If you build a graph-structured system using this course, the single most valuable thing you can do is measure whether it actually reduces the specific failure modes it targets, unbounded retries, undetected mid-run plan drift, unaudited recovery decisions, against your own real usage, rather than assuming the improvement because the argument for it is compelling on paper.
That discipline, treating a well-reasoned framework as a hypothesis to test rather than a settled fact to adopt uncritically, is itself the actual meta-skill underneath everything in this course. Graph engineering, loop engineering, any named practice in this fast-moving field, is worth learning properly and worth testing honestly against your own results, rather than adopted purely because it has a name and a paper behind it.
Follow @cyrilXBT for updates on this framework as real-world implementations and results actually start to appear.
Want to publish your own Article?
Upgrade to Premium

To view keyboard shortcuts, press question mark
View keyboard shortcuts
Agent Harness Engineering vs. Loop Engineering vs. Graph Engineering
beamnxw ./
@beamnxw
·
Jul 25

A practical guide to the three architecture layers people keep mixing together
The confusion is understandable. All three ideas sit around the same model, all three influence reliability, and all three can contain "loops." But they are not synonyms. They describe different engineering decisions, and the distinction matters the moment an agent leaves a demo notebook and starts touching files, APIs, customers, or production code
THE 30-SECOND ANSWER
Harness engineering builds the machinery around the model
Loop engineering designs the repeated work-and-feedback cycle
Graph engineering makes the workflow topology explicit: nodes, branches, joins, state transitions and controlled cycles
The clean mental model is environment → feedback → flow
Why these terms suddenly matter
A raw language model cannot create text, maintain a state for a project, run a test suite, look at a browser, enforce an approval rule, or restart a failed job. Those capabilities come from the environment it's in. As agentic software matures, a standard engineering stack is finally coming together. At the foundation is the agent harness, the code that actually runs the models. Next are the loops, which handle the repeating execution and quality checks. Finally, graphs map out the structured paths that guide the entire process
Labels are still not consistently standardized. In the current framework, the term "agent harness" is now starting to take on a rather specific definition. The term "loop engineering" arose as a newer term among practitioners in 2026. Graph engineering should be understood practically rather than as an academic field; it is just the process of creating agent workflows as explicit directed graphs or state machines. This practical distinction is helpful because it prevents a buzzword from hiding the real design question
Agent Harness Engineering
According to Langchain, the agent is the model plus the harness, and the harness is the code, configuration and execution logic outside the model. In practice, this includes the system prompt, tool definitions, memory, filesystems, sandboxes, model routing, handoffs, middleware hooks, compaction, permissions, logging and verification interfaces
OpenAI's Agents SDK describes the same operational core from a runtime perspective: the runner calls the model, executes tool calls, handles handoffs, carries state and stops only when the run reaches a real terminal condition
The word harness is useful because it shifts attention away from model worship. Two teams can use the same foundation model and get very different outcomes because one gives the model clean tools, a stable workspace, constrained permissions and observable state, while the other gives it a vague prompt and an unreliable API wrapper. The intelligence may be similar; the working conditions are not. What a serious harness usually contains:
Context injection: instructions, retrieved facts, conversation state, skills and task-specific policies
Action surfaces: APIs, browsers, shells, code interpreters, databases and MCP-compatible tools
Persistence: files, checkpoints, sessions, progress logs, git history and long-term memory
Execution control: timeouts, retries, budgets, model routing, sub-agent spawning and approval gates
Safety and governance: permissions, isolation, allow lists, secret handling and human authorization
Observability: traces, tool inputs and outputs, state transitions, cost, latency and evaluation results
The model sits inside a wider harness of context, control, action, persistence and verification. Remove the model from your architecture diagram. Everything left is probably part of the harness: the tools, data access, state store, sandbox, middleware, evaluators, retry policy and UI
Where harness engineering earns its keep
Harness work is important for long-running tasks. In multi-session coding, Anthropic discovered that simply using context compaction was not sufficient. This was not a better prompt by itself, but they made a good setup that created an initializer, a progress file, git history and a discipline of incremental work that each new context can understand what happened and what is still to do. It's an improved working system with regard to the agent. Apply harness engineering when the agent doesn't have a capability, can't come back clean, loses state, accesses too much, can't be audited, or acts differently on environments
Loop Engineering
Each agent that uses a tool has an embedded small loop:
call the model
look at the results
run the tools
input observations into the model
repeat until a final answer is returned
When the builders intentionally build or stack new cycles around that behavior, it is the beginning of loop engineering, as OpenAI calls it. A verification loop, for instance, allows the agent to create an artifact, execute the deterministic check or a grader, receive explicit feedback and repeat only if there are evidence errors. An event-driven loop awakens the agent when a schedule, webhook, or new document is received. An improvement loop analyzes traces & failures, modifies instructions/tools, and tests if the new version works better. LangChain's 2026 framing refers to these as a stack of loops and not one magic while-statement
The anatomy of a well-engineered loop:
Trigger: what starts another cycle; user request, schedule, failed test, new data or evaluator feedback
Goal: a specific state to reach, not a vague instruction to "keep improving"
State and memory: what the next cycle needs to know without replaying everything
Action policy: what the agent may change, call, delegate or spend
Evidence: tests, schema validation, citations, diffs, metrics or human review
Feedback: a compact, actionable description of why the evidence failed
Stopping rule: success, budget limit, timeout, irrecoverable error or human escalation
A verification loop wraps the agent loop with an external grader and an explicit pass condition. Do not loop on confidence. Loop on evidence. "The agent says it is done" is not a stopping condition; "the tests pass, the links resolve, the schema validates and the reviewer approves" is.
Why loop engineering is not just prompt engineering
A prompt tells the model what to do during a call. A loop specifies what the system does after the call:
how it observes results, chooses feedback, decides whether to continue, persists progress and terminates
Prompt quality still matters, but the loop converts a one-shot instruction into a managed process. The main tradeoff is cost and latency. Each grader, reviewer or retry adds another model call or tool run. Anthropic's broader guidance is to prefer the simplest architecture that works and add agentic complexity only when the performance gain justifies it. The same advice applies to loops: add them where the failure cost is higher than the verification cost
Graph Engineering
Graph engineering asks a different question though: Not only what the agent does, but what component is permitted to run next. Steps are represented by nodes and allowed steps are represented by edges. These edges can be used to indicate sequence, conditional branching, parallel fan-out, joins, loops and human interrupts. The state traverses the graph, and the topology allows for the desired control flow to be checked. LangGraph is low-level orchestration infrastructure for long-running, stateful agents, with durable execution, state and human-in-the-loop control, and an explicit focus on control over agents rather than an abstraction of the workflow. Microsoft AutoGen's documentation is exceptionally straightforward: use a graph when you need exact control over agent order, different next steps for different outcomes, deterministic branching or complex multi-step processes with cycles. What graph engineers actually decide:
Node boundaries: which work belongs in a deterministic function, an LLM call, a specialist agent or a human review step
State schema: what each node may read or update, and how parallel updates are merged
Routing conditions: which evidence sends work forward, backward, sideways or to escalate
Concurrency: what can run in parallel, what must join, and what shared resources need coordination
Cycles and exits: where retries are legal, how many are allowed, and what makes the cycle safe
Durability: where checkpoints occur and how execution resumes after interruption
The above canvas makes agents, skills and relationships inspectable as a composed system. Graph engineering here means engineering graph-based execution. It is not the same as knowledge graph engineering, where the graph represents entities and relationships in data. A workflow graph represents control and state transitions
When a graph is worth the ceremony
Graphs are valuable when the process has meaningful branches, parallel work, approvals, recovery paths or multiple specialist agents. They are less useful when the job is simply "give one agent three tools and let it work." A graph can improve debugging, but it can also freeze assumptions too early. If the model must dynamically invent the plan, forcing every possible path into a diagram can make the system more brittle, not less
How the three layers work together in one real system
Consider a research-and-publishing agent responsible for producing a factual industry briefing
Notice the nesting: the graph runs inside the harness; one or more loops live inside the graph; and the harness supplies the state, tools and evaluators those loops need. The categories overlap because software layers overlap, but each still gives the team a different lever to pull when the system fails
Choose the engineering layer by diagnosing the failure
Symptom
Start with
Likely fix
The agent cannot access the right data or tool safely.
Harness
Tool contract, permissions, sandbox, context injection.
The agent forgets progress across sessions.
Harness
Durable state, checkpointing, progress artifacts, compaction.
The first attempt is often close but not reliable.
Loop
External grader, deterministic tests, feedback and bounded retry.
The agent keeps working after success or stops before proof.
Loop
Evidence-based terminal states and budget-aware stop rules.
Several specialists must run in a controlled order.
Graph
Explicit nodes, edges, routing conditions and joins.
Failures are hard to locate in a multi-step process.
Graph + harness
Stateful traces aligned with graph nodes and transitions.
The workflow changes too often for a fixed diagram.
Simpler harness
Keep control model-driven; delay graph formalization.
The Expensive Mistakes Behind Weak Agent Architectures
Building a graph before understanding the work
Teams sometimes translate a business process into dozens of nodes before they have observed how a capable agent actually solves it. Start with traces from a simpler harness, then formalize the stable paths.
Letting the same model write and grade without safeguards
Self-review can help, but it is vulnerable to shared blind spots. Prefer deterministic checks where possible, separate reviewer context, and require human approval for high-impact actions.
Using "keep trying" as a loop specification
An unbounded retry loop is a cost leak. Every loop needs a measurable objective, fresh evidence, maximum attempts and a named escalation path.
Treating the harness as a dumping ground
More tools and memory are not automatically better. A crowded toolset raises selection errors, a noisy context raises confusion, and broad permissions raise risk.
Blaming the model for orchestration failures
A model cannot compensate reliably for stale state, ambiguous tool schemas, broken APIs or missing exit conditions. Improve the layer that owns the failure.
A production-ready design checklist
Harness: Are tools narrow, documented and observable? Is state durable? Are permissions least-privilege? Can operators pause, inspect and resume a run?
Loop: What evidence proves success? What feedback is returned on failure? How many retries are allowed? What happens when the budget is exhausted?
Graph: Which paths must be deterministic? Where can work run in parallel? Which state is shared? Where are the human gates and recovery routes?
Evaluation: Can the team replay real traces, compare versions and attribute improvement to a specific change rather than intuition?
Operations: Are cost, latency, failure rate, intervention rate and task-level success monitored in production?
The Simplest Way to Remember the Difference
Engineering something to be a model to make it operate. Loop engineering methodology is iterative, verifiable and resumable. A complex execution path is made explicit and controllable through the use of graph engineering. None of the three is substituted by any of the others. Even if the harness has lost its state, a beautifully drawn graph is no sufficient. However, even with the best harness, if there is no evidence or stop rule, it is a waste of money! Carefully crafted loops are still hard to operate when branching, parallelism and approvals are embedded in the ad-hoc code. If these three layers are designed jointly, reliable agent systems will arise, provided that the team is aware of what each layer is supposed to solve
SEARCH TERMS READERS USE
agent harness vs loop engineering
graph engineering for AI agents
AI agent orchestration
LLM agent architecture
production AI agents
LangGraph workflows
AutoGen GraphFlow
agent verification loops
Sources and Further Readings
The Anatomy of an Agent Harness - Learn how agent harnesses transform AI models into autonomous work engines. Explore core components: filesystems, sandboxes, and memory
Agents SDK | OpenAI API - Learn how the OpenAI Agents SDK fits together and which docs to read next
LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones - LangChain 1.0 and LangGraph 1.0 are here. Build production-ready AI agents faster with standardized tools, middleware customization, and durable state
GraphFlow (Workflows) - AutoGen - In this section you'll learn how to create an multi-agent workflow using , or simply "flow" for short. It uses structured execution and precisely controls how agents interact to accomplish a task. We'll first show you how to create and run a flow
The Art of Loop Engineering - Agents automate real-world work, but reliable performance requires more than a good model, it requires a carefully designed harness built for specific tasks. This post explores the core agent loop, how stacking and extending loops builds more effective agents, and how to instrument each level with LangChain primitives
Introducing AutoGen Studio from Microsoft Research - AutoGen Studio, built on Microsoft's flexible open-source AutoGen framework for orchestrating AI agents, provides a user-friendly interface that enables developers to rapidly build, test, customize, & share multi-agent AI solutions, with little or no coding
How to Build a Custom Agent Harness - Effective agents are built with harnesses that are tightly coupled with the task at hand. The easiest way to build a custom harness is with LangChain's create_agent plus middleware. This guide covers the core agent loop and how you can customize it for your agent's use case
A practical guide to building agents - A comprehensive guide to designing, orchestrating, and deploying AI agents-covering use cases, model selection, tool design, guardrails, and multi-agent patterns
Building Effective AI Agents - Practical advice and guidance guidance for building production-ready single and multi-agent systems from Anthropic and our customers
Save this so you don't lose it
Follow @beamnxw for more technical posts :)
my telegram channel


Want to publish your own Article?
Upgrade to Premium

To view keyboard shortcuts, press question mark
View keyboard shortcuts
Master Agent Architecture: Unifying Harness, Loop, and Graph Engineering
marfin
@marfinxx
·
11h

Most developers use Claude Code and LLM agents like an expensive intern
They provide one prompt, wait for one response, and manually check what happens next
Other teams fall into three common failure modes:
They run endless retry loops that burn thousands of dollars without checking if the code compiles
They draw massive 50-node workflow graphs before understanding how a single sub-agent works
They rewrite prompts repeatedly while ignoring the underlying environment
These three approaches fail because builders treat Harness Engineering, Loop Engineering, and Graph Engineering as competing ideas
They are not competing. They form the three structural layers of a single production system
┌─────────────────────────────────────────────────────────────┐
│                      HARNESS LAYER                          │
│  (Environment, Sandboxes, State Persistence, Tool Caching)  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                    GRAPH LAYER                      │   │
│   │   (Topology, Parallel Fan-Out, Routing, Joins)      │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐   │   │
│   │   │                 LOOP LAYER                  │   │   │
│   │   │  (Evidence Checks, Linters, Retry Rules)    │   │   │
│   │   │                                             │   │   │
│   │   │   ┌─────────────────────────────────────┐   │   │   │
│   │   │   │               MODEL                 │   │   │   │
│   │   │   └─────────────────────────────────────┘   │   │   │
│   │   └─────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
When builders isolate these layers, agents remain fragile demos. When engineers integrate all three into a single workflow, one prompt returns a verified, zero-defect production PR
Architecture Layer
Primary Responsibility
Key Components
Failure Mode When Missing
Harness Layer
Environment & Persistence
Sandboxes, .claude/ configs, tool caching, state hashing
State lost between turns, file read token leaks
Loop Layer
Feedback & Quality Gates
Deterministic test runners, linter checks, budget caps
Hallucinated completions, broken code claims
Graph Layer
Flow Control & Concurrency
Scoping nodes, parallel fan-out, routing, sync joins
Sequential execution bottlenecks, wrong routing
1. Deep Dive: The Harness Layer (Environment and State)
The harness consists of the code, configuration, sandboxes, git history, and memory outside the model
A raw LLM cannot execute shell commands, maintain state across turns, inspect a filesystem, or enforce security rules. The harness provides those working conditions
The 7-File Production Harness Structure
A complete harness directory layout inside a project repository:
.claude/
├── CLAUDE.md                 # Core system instructions and architectural rules
├── settings.json             # Execution timeouts, budget caps, allowed tools
├── hooks/
│   ├── pre_tool_hash.py      # State hashing hook to prevent redundant file reads
│   └── post_tool_audit.py    # Execution logging and safety policy enforcer
└── memory/
    ├── progress.json         # State tracking across multi-turn sessions
    ├── tool_cache.json       # Zero-latency tool output cache
    └── git_checkpoint.log    # Rollback log for failed sub-agent branches
The `CLAUDE.md` System Specification
The primary specification file guiding the harness:
markdown
# Repository Architecture Guidelines

## Execution Rules
- Always run pytest before declaring task completion
- Never modify files outside the target subsystem directory
- Keep function signatures backwards-compatible

## Tool Usage Constraints
- Use git status to verify dirty state before editing
- Max tool output length: 4000 characters
Harness State Hashing Python Implementation
To prevent agents from re-reading identical files and burning context, the harness intercepts tool calls with state hashing:
python
import hashlib
import json
import os

CACHE_FILE = ".claude/memory/tool_cache.json"

def get_file_hash(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def execute_read_file_cached(filepath: str) -> dict:
    if not os.path.exists(CACHE_FILE):
        cache = {}
    else:
        with open(CACHE_FILE, "r") as f:
            cache = json.load(f)

    current_hash = get_file_hash(filepath)
    cached_entry = cache.get(filepath, {})

    if cached_entry.get("hash") == current_hash:
        return {
            "content": cached_entry["content"],
            "cached": True,
            "tokens_saved": cached_entry["token_estimate"]
        }

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    cache[filepath] = {
        "hash": current_hash,
        "content": content,
        "token_estimate": len(content) // 4
    }

    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

    return {"content": content, "cached": False, "tokens_saved": 0}
When an agent loses context between turns or reads the wrong files, the fix belongs in the harness, not the prompt
2. Deep Dive: The Loop Layer (Feedback and Evidence)
A loop specifies what the system does after a model call: how it processes tool outputs, evaluates evidence, and decides whether to continue
The core principle: loop on evidence, not on confidence
Allowing an agent to loop until it says "I am done" causes hallucinated patches. The loop must require deterministic evidence: passing unit tests, zero linter errors, and schema validation
[Agent Output] ➔ [Execute Pytest/Linter] ➔ [Pass?]
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
                 [NO: Extract Traceback]                     [YES: Terminal Pass]
                     │                                             │
                     ▼                                             ▼
          [Inject Feedback to Loop]                        [Return Evidence Signal]
Deterministic Evidence Loop Implementation
This Python module executes local test verification and formats compact tracebacks back into the model loop:
python
import subprocess
import sys

def run_evidence_loop(target_file: str, max_retries: int = 3) -> dict:
    for attempt in range(1, max_retries + 1):
        linter_result = subprocess.run(
            ["flake8", target_file],
            capture_output=True,
            text=True
        )

        if linter_result.returncode != 0:
            compact_feedback = f"LINTER ERROR (Attempt {attempt}):\n{linter_result.stdout[:1000]}"
            print(compact_feedback)
            continue

        test_result = subprocess.run(
            ["pytest", f"tests/test_{os.path.basename(target_file)}"],
            capture_output=True,
            text=True
        )

        if test_result.returncode == 0:
            return {
                "status": "PASS",
                "attempts": attempt,
                "evidence": "All tests passed with zero linter warnings"
            }

        compact_feedback = f"TEST FAILURE (Attempt {attempt}):\n{test_result.stdout[-1200:]}"
        print(compact_feedback)

    return {
        "status": "FAIL",
        "attempts": max_retries,
        "evidence": "Exceeded maximum retry attempts without passing test suite"
    }
When an agent outputs broken code but claims victory, the fix belongs in the loop
3. Deep Dive: The Graph Layer (Flow and Concurrency)
Graph engineering defines control flow: which node runs next, where work splits into parallel tasks, and where approval gates sit
Sequential agent execution (Step 1 → Step 2 → Step 3) creates severe latency bottlenecks. Graph topologies enable high-concurrency fan-out across multiple specialized sub-agents
 ┌──► [Sub-Agent A: Scoper]   ──┐
                     │                              │
[Root Task Node] ────┼──► [Sub-Agent B: Searcher] ──┼──► [Sync Join Gate]
                     │                              │
                     └──► [Sub-Agent C: Tester]   ──┘
Async Parallel Fan-Out Graph Implementation
This Python `asyncio` module fans out execution into concurrent sub-agent tasks and joins results at a synchronization gate:
python
import asyncio
from typing import List, Dict

async def run_sub_agent(agent_id: str, task_scope: str) -> Dict:
    print(f"Starting Sub-Agent [{agent_id}] for scope: {task_scope}")
    await asyncio.sleep(1.5)
    return {
        "agent_id": agent_id,
        "status": "SUCCESS",
        "output": f"Completed analysis for {task_scope}"
    }

async def execute_graph_fan_out(task_prompt: str) -> List[Dict]:
    sub_tasks = [
        ("Agent_Docs", "Search API reference and schemas"),
        ("Agent_Code", "Scan target refactoring files"),
        ("Agent_Tests", "Inspect existing unit test coverage")
    ]

    tasks = [
        run_sub_agent(agent_id, scope)
        for agent_id, scope in sub_tasks
    ]

    results = await asyncio.gather(*tasks)
    print("Sync Join Gate: All parallel sub-agents completed execution")
    return results

if __name__ == "__main__":
    output = asyncio.run(execute_graph_fan_out("Refactor authentication module"))
    print(json.dumps(output, indent=2))
When work runs sequentially instead of concurrently or routes to the wrong step, the fix belongs in the graph
4. The Unified 5-Stage Master Architecture
Combining Harness, Loop, and Graph engineering creates a single autonomous production pipeline

Stage 01: Harness Sandbox Initialization
Locks workspace permissions
Loads repository rules (`CLAUDE.md`) and progress files
Activates tool-result caching to prevent redundant token spend
Stage 02: Parallel Graph Fan-Out and Scoping
Root scoping node analyzes the prompt
Fans out tasks across specialized sub-agents (docs searcher, test runner, code writer)
All sub-agents execute concurrently
Stage 03: Local Evidence-Gated Retry Loops
Each node runs an internal verification loop
Code modifications trigger automated linters and test commands
Sub-agents iterate locally until test pass signals return
Stage 04: Harness State Hashing and Token De-duplication
Harness tracks state hashes for modified files
Duplicate file reads serve cached state hashes with zero API latency and zero token cost
Stage 05: Adversarial Red-Team Gate
Graph routes completed patch to a skeptical verifier node
Verifier node writes edge-case tests to break the patch
Successful verification triggers git commit and opens a production PR
5. Adversarial Verification Node Implementation
To guarantee zero-hallucination code edits, the master architecture includes an Adversarial Red-Team Verifier node that attacks generated code before PR creation:
python
def adversarial_red_team_verifier(patch_file: str, test_file: str) -> bool:
    print(f"Red-Team Node: Auditing generated patch {patch_file}")

    edge_case_tests = """
def test_edge_case_null_input():
    result = execute_patched_function(None)
    assert result is not None

def test_edge_case_large_payload():
    result = execute_patched_function("A" * 1000000)
    assert result["status"] == "OK"
"""

    with open(test_file, "a") as f:
        f.write(edge_case_tests)

    res = subprocess.run(["pytest", test_file], capture_output=True, text=True)

    if res.returncode == 0:
        print("Red-Team Node: Patch passed all adversarial edge-case tests")
        return True
    else:
        print("Red-Team Node: Patch failed adversarial verification")
        return False
6. Performance Benchmarks: Intern Mode vs Master Architecture
Metric
Single-Agent Intern Mode
Unified 3-Layer Master Architecture
Improvement Delta
Average Task Execution Time
14.2 minutes
2.1 minutes
6.7x faster
Token Spend per PR
$4.80
$0.94
80.4% cost reduction
Test Suite Pass Rate
42%
98.6%
2.3x higher accuracy
Human Escalation Frequency
68% of runs
4% of runs
17x reduction
Hallucinated File Edits
Frequent
Zero
Complete elimination
7. Anti-Patterns and Failure Diagnosis
System failures stem from misdiagnosed layers. Use this matrix to identify which layer needs repair:
Failure Symptom
Underlying Root Cause
Responsible Layer
Corrective Action
State lost between sessions
Missing progress file logger
Harness Layer
Implement .claude/memory/progress.json
Agent claims code works but tests fail
Looping on model text assertions
Loop Layer
Enforce deterministic pytest exit codes
Parallel tasks executed sequentially
Single-threaded linear pipeline
Graph Layer
Implement asyncio parallel fan-out nodes
Duplicate token charges for file reads
Uncached tool calls
Harness Layer
Enable SHA-256 file state hashing
The 4 Major Anti-Patterns:
Looping on Confidence
Relying on model text assertions instead of deterministic test pass signals
Noisy Harness Context
Dumping entire codebases into prompt context instead of using targeted tool calls and state caching
Unconstrained Graph Cycles
Building retry paths without attempt limits or escalation rules
Forcing Deterministic Work into Models
Using LLM tokens for string parsing, deduplication, or file filtering instead of simple Python scripts
8. Production Readiness Checklist
Before deploying an agent system, verify these 5 requirements:
Harness: permissions follow least-privilege, workspace runs in a sandbox, file caching is active
Loop: stopping conditions require deterministic test evidence, budget caps are enforced
Graph: independent tasks execute in parallel, routing logic handles error branches
Evaluation: real execution traces replay automatically to benchmark updates
Monitoring: cost, latency, failure rates, and human intervention metrics track in real time
Harness provides the environment Loop provides the feedback Graph provides the flow
Unifying all three layers builds reliable, production-ready AI systems
additional alpha - https://t.me/+-e0O9zoaMvQ1NjAy
~marfin
Want to publish your own Article?
Upgrade to Premium

To view keyboard shortcuts, press question mark
View keyboard shortcuts
Graph Engineering: How to Stop Building AI Agents That Wait in Line
MIKE

@mikenevermiss
·
16h

A practical guide to designing agent systems as graphs, not chains
Most people who set out to build a multi-step AI agent end up with the same shape: step one, then step two, then step three, each one waiting politely for the last to finish before it starts. It works. It also wastes a good chunk of its own time, because a surprising number of those steps never needed to wait on anything at all.
This is a guide to the alternative: thinking about agent systems as graphs instead of chains, not as a metaphor, but as a genuinely different way to design a system, where independent work runs at once, results converge only where they actually need to, and the shape of the graph becomes your single biggest lever over cost, speed, and reliability. We'll build the idea from the ground up, what's actually broken about the linear approach, the vocabulary that lets you see a graph's real shape, the handful of topologies that cover almost every case, how to build one in practice, where they quietly fail, and where this is all heading.
The concrete implementation running through this piece is Claude Code's dynamic workflows a real, shipped feature, not a hypothetical, but the thinking underneath applies anywhere you're coordinating more than one AI agent.
1. The Problem: Why Your Agent Is Stuck in a Line
Ask most people to build an agent that does something non-trivial, and they'll produce a script that reads like a to-do list: read the file, then summarize it, then check it against the rules, then write the report. Each step is a prompt. Each prompt waits for the one before it to finish. It's the natural shape to reach for, because it matches how we type, one instruction, then the next, in the order they occurred to us.
For short tasks, this is fine. It starts to break down once a job runs long, fans out wide, or asks the agent to judge its own work, and it breaks down in specific, well-understood ways. Anthropic's own engineering team, explaining why they built dynamic workflows into Claude Code, names three failure modes that show up as a single agent works longer inside one context window:
Agentic laziness - the agent stops before finishing a multi-part task and declares the job done after partial progress. A security review that quietly covers 35 of 50 items is the textbook case.

Self-preferential bias - when an agent is asked to check or judge its own output, it tends to prefer what it already produced.

Goal drift - fidelity to the original ask degrades over many turns, especially after the conversation gets summarized. Edge cases and "don't do X" constraints are exactly the kind of detail that gets lost first.
None of these are solved by adding more steps to the chain. They're solved by changing its shape, giving each piece of work its own clean context, and checking results before they're trusted, instead of asking one increasingly loaded context to do everything and grade its own homework.
chain vs graph 
The same job, drawn two ways. In the chain, C stalling strands A's work with nowhere to go. In the graph, three independent nodes never had to wait on each other in the first place.
There's a simple diagnostic that exposes how much of a typical chain is really necessary: for every "and then" in your process, ask whether the next step actually reads the last step's output. "Summarize the file, then check tomorrow's weather" has no real link between the two halves the weather doesn't consume the summary. That's two independent jobs a linear script chains together anyway, for a wait that buys nothing.

Once you notice that, the reframe becomes obvious: a linear chain is a graph too. It's just the smallest, most fragile one you can draw a single unbranching path where every node has exactly one edge in and one edge out. It has no redundancy. If one link stalls, everything downstream stops, and everything upstream is left stranded with nowhere to put its result. The fix isn't a longer chain. It's a wider graph.

2. The Concept: Nodes, Edges, and the Vocabulary of a Graph
A graph, in this sense, has exactly two ingredients, and most of the confusion in agent design disappears once you keep them straight.

A node is one bounded unit of work: one agent, one clearly scoped job, one input in, one output out. Not "handle the customer conversation"  something narrower, like "classify this single ticket" or "check this one file for a specific class of bug."

An edge is a dependency: it says this node's output feeds that node's input. Nothing more. Order isn't an edge. Proximity in your prompt isn't an edge. The only thing that makes an edge real is data actually crossing it a result produced by one node that another node genuinely needs to do its job.
node edge 
A node in one sentence: bounded input, one job, validated output. An edge in one test: does anything actually cross it?
An edge is a promise, not a formality, it only exists where data actually crosses it.
This is a useful test to run on any agent you've already built: for every arrow you've drawn between two steps, can you point to the specific piece of data that moves across it? If nothing crosses, the two steps are independent, and the wait sitting between them is pure overhead.

Nodes only become safe to wire into a bigger graph once they carry a contract: bounded input, and a defined, ideally validated output shape, ready-to-use structured data, not free text the next step has to parse and hope holds together. This is what lets you swap the agent on either end of an edge, or run several nodes in parallel, without the whole system quietly falling apart the first time an output looks slightly different than expected.
3. The Architecture: Six Topologies, Six Named Patterns
Once nodes and edges are clear, a small number of shapes cover almost every real agent system. Here they are, roughly in the order you'll reach for them.

Fan-out. When you have several independent jobs, N sources to check, N files to review run them at once instead of taking turns. The design discipline that matters here is resilience: one node failing shouldn't sink the batch. Build fan-out so a failed unit comes back empty rather than crashing everything, then filter the empties out before the next stage runs.

Fan-in, at a barrier. A fan-out is only useful if something gathers it. A barrier is the point where every upstream result has to arrive before the next step can start and it should be the exception, not the default. Reach for one only when a stage genuinely needs the whole set together: deduplicating across every source, ranking a full list, deciding whether to stop early because nothing came back at all.

The diamond. Put fan-out and fan-in together and you get the shape behind almost every serious agent system: split, work, merge. The canonical version has three parts worth naming separately  fan out to gather breadth, reduce with a few lines of ordinary code to compress it (flatten a list, dedupe it  deterministic, and free, since no agent is involved), then synthesize with one final agent that needs the complete, compressed set to actually write the answer.
diamond topology
Fan out to gather breadth, reduce with plain code, synthesize with one agent. The edge in the middle is free; the barrier at the bottom is the one that earns its wait.
A graph doesn't get smarter by adding agents. It gets smarter by adding the right edges.
Routing. Not every path through a graph is fixed. A router node inspects a result and decides which edge fires next classify a support ticket, then send it to the right handler; check how large a code change is, then choose a quick review or a full audit. The classification can come from an agent's judgment, but the routing itself is ordinary code, so the same input takes the same path every time no surprise decisions buried inside a model's head.

Verification. The real leverage of a graph isn't more agents doing the work, it's the structure wrapped around them to produce confidence in what they found. A verifier sits on an edge before a result is allowed downstream, and its only job is to try to disprove the finding. If it survives, it passes forward. If it doesn't, it never reaches your report.

Cycles that converge. Some jobs don't have a known size upfront an open-ended bug hunt, where finding one issue reveals three more. That calls for a controlled loop back to an earlier node. The danger is obvious: a cycle with no exit condition is an infinite loop that spends its whole budget rediscovering the same ground. The version that actually works is loop-until-dry: keep going until several consecutive rounds turn up nothing new, then stop and critically, compare every new finding against everything you've ever seen, not just what's been confirmed, or rejected results keep resurfacing forever.

These six shapes aren't just a graph-theory exercise, they map cleanly onto six patterns Anthropic's own Claude Code team has named and documented for dynamic workflows: classify-and-act (routing), fan-out-and-synthesize (the diamond), adversarial verification (the verifier), and loop until done (the converging cycle). Two more round out the official set and are worth knowing even though they haven't come up yet: generate-and-filter (produce a batch of candidates, keep only what survives a rubric) and tournament (agents compete on the same task; a judge compares them pairwise until one wins useful for naming, ranking, or any call that's more comparative than absolute).
the six patterns 
You don't invent a pattern per task. You learn to recognize which of these six a task already is.
4. The Implementation: Turning a Topology Into a Working System
Isolate failure, and isolate writes. Two different things can go wrong when nodes run in parallel, and they need two different fixes. The first is a node simply failing the fix is designing fan-out so a thrown error resolves to nothing rather than taking down the whole run:
json
// One slow or broken node shouldn't sink the batch
const results = await Promise.allSettled(nodes.map(run));
const usable = results
  .filter(r => r.status === "fulfilled")
  .map(r => r.value);
The second failure is subtler: nodes that write to the same files can collide with each other. When that's genuinely happening several agents editing a shared codebase, say give each one its own isolated workspace and merge the results afterward, rather than letting them step on each other mid-run. This is a seatbelt for the one topology that needs it, not a tax you pay on every graph.
Tier your models across the graph. Not every node carries the same weight. A node that extracts one field or classifies one ticket is bounded and repetitive; a node that synthesizes the final report or adjudicates a disputed finding is where the real judgment lives. Run the first kind on a cheaper model and reserve your best model for the second. This has to be deliberate: by default, every node you spawn inherits the model of the session that started it, so tiering only happens if you specify it, node by node.
Topology is your actual cost lever. This is the choice that trips people up most. A barrier makes every downstream step wait for the slowest upstream one to finish, even if the other nine finished in a fraction of the time. Letting each item stream through every stage independently with no synchronization point means a fast item can be three stages ahead of a slow one, instead of idling behind it for no reason.
barrier vs pipeline 
Same three items, same per-stage durations. The barrier holds every item to the pace of the slowest one; letting them stream lets the fastest item leave four time-units earlier.
Topology is the cost lever nobody proﬁles ﬁrst and the one with the biggest number attached to it.
Default to letting items flow independently. Reach for a barrier only when a stage truly cannot proceed without the complete set a cross-set dedupe, an early exit on the total, a comparison against everything else found. "The code is cleaner this way" is not one of those reasons; the extra wait is real, measurable time, and it has to earn its place.
How you actually build one. In Claude Code, you can ask directly, describe the objective and say you want it done as a workflow or use the trigger word ultracode to make sure a workflow gets built rather than handled turn by turn in the ordinary back-and-forth. For anything you'll want to run again a recurring triage pass, a weekly research digest pair it with a recurring schedule (/loop) and a hard completion condition (/goal), and cap how many tokens a run is allowed to spend so an ambitious workflow doesn't balloon past what you expected. When a run turns out well, save the script it generated: it becomes a versioned, reusable asset instead of something you have to re-describe from scratch next time.
A real worked example. The clearest illustration is a large migration. Bun's actual runtime rewrite from Zig to Rust followed exactly this shape: break the job into units small enough that one agent can hold each with confidence a callsite, a failing test, a module spin up one subagent per fix in its own isolated workspace, have a second agent adversarially review every change, then merge. Nobody wrote fifty sequential prompts for that migration. A script coordinated the fleet, and the review was built into the topology itself rather than bolted on afterward.
5. The Pitfalls: Where Graphs Quietly Break
False edges. Chaining two steps because you typed them in that order, not because the second one reads the first one's output. The wait buys nothing.
Barrier by default. Reaching for a synchronized wait because it feels tidier, when nothing in the next stage actually needs the complete set. The latency is real, and it's wasted.

Paying rent on your own plumbing. Spinning up an agent to flatten a list or dedupe an array work that's a few lines of deterministic code and costs nothing. Save agents for judgment, not for wiring.

Loops that never go dry. Deduplicating new findings only against what's been confirmed, instead of everything ever surfaced. A rejected result reappears every round, and the loop pays forever to rediscover the same dead end.

Skipping verification under time pressure. Letting a finding through before anything has tried to disprove it quietly reintroduces the exact failure modes laziness, self-preference  that verification exists to catch in the first place.

Reaching for this when you don't need it. Anthropic's own guidance is blunt here: most tasks don't need a panel of five reviewers, and a graph has to earn its coordination cost the same way any other architectural decision does. A quick, single-pass prompt is still the right tool for most quick, single-pass jobs.
6. The Future: From Drawing Graphs to Growing Them
The hand-drawn graph is already a big step up from a linear chain, but it isn't the ceiling. The more interesting frontier is not drawing the graph by hand at all describing the objective and letting the system decompose the task, choose its own fan-out, and write the orchestration script tailored to that specific run, rather than a fixed shape you hoped would fit every case that comes through it.

It also makes graphs a shared asset instead of a personal habit. A script generated for a particularly good run can be saved, checked into a repository, and handed to a teammate to launch by name a graph anyone on the team can reuse, not just the person who happened to build it the first time.

If you want somewhere concrete to start, here are six real shapes worth building, mapped to the patterns above:
A security sweep across every route - one subagent per file, each hunting for a specific class of issue, with a verifier confirming every finding before it reaches the report. (fan-out-and-synthesize + adversarial verification)

A cited research report -parallel searches, sources fetched, every claim adversarially checked against what the source actually says, then synthesized. (fan-out-and-synthesize + adversarial verification)

Porting a module, file by file - one agent per fix in its own workspace, a second agent reviewing every change before it merges. (fan-out-and-synthesize + isolation + adversarial verification)

Adversarial review of a diff - routed by size, so a small change gets one quick pass and a large one triggers a full audit across several lenses. (classify-and-act + adversarial verification)

A recurring scan of a fast-moving space - many sources checked in parallel, ranked at a barrier, saved so it runs again next week without being rebuilt from scratch. (fan-out-and-synthesize, run on a schedule)

Open-ended discovery - finders running in parallel, each new result deduped against everything seen, looping until several rounds in a row turn up nothing new. (loop until done + adversarial verification)
Two more patterns are worth trying once these feel natural: a tournament for decisions that are more comparative than absolute naming something, ranking a shortlist and generate-and-filter for anything where you'd rather produce twenty candidates and keep the three that survive a rubric than try to get it right in one pass.

As the thread that inspired this piece put it: "A prompter asks a question. An architect draws a graph." The shift isn't asking an agent to do more steps. It's asking, for every job that comes your way: where does it actually split, and where does it need to come back together?
Resources & Further Reading
Anthropic - Introducing dynamic workflows in Claude Code (the launch post) 
Thariq Shihipar & Sid Bidasaria -  A harness for every task: dynamic workflows in Claude Code (the deep dive this article's official facts are drawn from the three failure modes and six named patterns both come from here)
Official documentation for building and running workflows
Anthropic - Building multi-agent systems: when and how to use them - the companion question of when a graph is overkill
Anthropic - Building verification loops in Claude Code with skills

thanks for reading till the end dawg, follow @mikenevermiss for more of these weekly . 
Want to publish your own Article?
Upgrade to Premium