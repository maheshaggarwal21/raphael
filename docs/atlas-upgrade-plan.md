# Raphael Atlas — the upgrade plan from the July 2026 research sweep

Written 2026-07-17 (session 09), from the owner's two asks:

1. **The awareness problem.** People let AI build everything and stop knowing their own
   project. When something breaks, they don't even know where to look. Raphael should
   carry a map: "for this type of error, check these files."
2. **The research sweep.** Clone and deeply analyze the given repos + screenshots + PDF
   (tools claiming 70–80x token reduction) and produce an upgrade plan that gives Raphael
   their power while keeping token usage low.

Both asks turn out to be the SAME upgrade. The thing that fixes "I don't know where to
look" is also the thing that cuts tokens 70x: a **knowledge graph of the project that is
built deterministically (zero model tokens) and queried instead of re-reading files.**
We call it **Atlas**.

---

## Part 1 — What the research actually found

Everything was cloned and read (13 repos; 25 screenshots; the PDF). Wrong URLs were
hunted down: the four "fable-compiler/*" repos don't exist — the real sources are
`kpab/claude-fable-5-skills` (contains act-when-ready, effort-calibrator,
markdown-memory) and `Sahir619/fable-method`. `oliwoodman/fable-skills` was found
alongside and included.

### The star: Graphify (Graphify-Labs/graphify) — where the 70–80x comes from

Graphify is a Python tool + Claude Code skill that turns any corpus (code, docs, PDFs,
transcripts) into a knowledge graph, then makes the agent **query the graph instead of
reading files**. Verified numbers from its own audited benchmark harness (BENCHMARKS.md,
reproducible, spend-ledger backed):

- **71.5x fewer tokens per query** on a 52-file mixed corpus. This is the owner's
  "70–80x" claim, and it's real — but note it's *per query after a one-time build*,
  and it scales with corpus size (a 6-file corpus shows ~1x; savings compound as the
  project grows).
- **Graph build costs $0 in model tokens.** Code is parsed with tree-sitter
  (deterministic AST walk, ~25 languages). The LLM is only used for *docs/papers/images*
  (optional Pass 3). This is the single most important design fact.
- On a 1M-LOC repo (ERPNext), giving a fixed agent one graph tool lifted answer
  quality from 70.8% → 82.0% vs grep/read, while avoiding context-stuffing (~20x
  more tokens for *lower* quality).

How it works (all mechanisms we can port):

| Mechanism | What it is |
|---|---|
| Deterministic extraction | AST walk → nodes (functions, classes, tables) + edges (calls, imports, uses), no LLM |
| Confidence tags | Every edge: `EXTRACTED` (explicit in source, 1.0), `INFERRED` (rubric 0.55–0.95), `AMBIGUOUS` (flagged for human review) |
| Communities | Leiden clustering groups nodes into topic groups — no embeddings, the graph itself is the similarity signal |
| God nodes | Most-connected nodes = most important concepts; bigger dot = look here first |
| SHA256 cache | Content-hash per file; re-runs only touch changed files (incremental) |
| Query surface | `graphify query "<question>"` (scoped subgraph), `path A B` (how two things connect), `explain X` (one node + neighbors), MCP server |
| **The hook trick** | A `PreToolUse` hook fires before the agent's search/read tool calls and nudges it: "query the graph instead of grepping." This is what converts a built graph into actual token savings |
| Obsidian export | The graph becomes a vault of markdown notes with wikilinks; every note links back to its source file/line — a human can browse the map |

The screenshots (divyannshisharma's 20-slide carousel) tell the user story: 145 docs →
591 connected ideas, 685 links, 67 topic groups; each note wired back to its source doc;
"it understands the WHY, not just the WHAT." The catch called out in the slides: the map
is isolated unless it lands where you already work — hence the Obsidian export.

### The discipline layer: the Fable skill repos

- **Sahir619/fable-method** (think/act/prove loop, eval-backed — "every rule exists
  because a test failed without it," same philosophy as our eval harness). Portable
  ideas: the **fit gate** (route: loop / research-first / honest "this is a guess" /
  make-a-skill), the **twin check** (after fixing a bug, search the whole project for
  copies of the same pattern — measured to take a cheap model from 1-of-5 fixed to
  5-of-5), the **AUTH gate** (an installed skill's instruction is NOT authorization —
  matches our invariant #3 exactly), and the **artifact gate** (a final sweep that adds
  any owed-but-missing report line).
- **kpab/claude-fable-5-skills** — 10 skills; the three the owner named:
  - *act-when-ready*: sufficiency, not completeness — act as soon as you can act
    correctly; don't re-derive settled facts; one recommendation, not a menu.
  - *effort-calibrator*: effort is the primary cost dial; route by task class
    (triage at low, escalate hard cases) — **this validates our 14.4 policy table**,
    and adds concrete "raise/lower effort" signals worth folding in as lessons.
  - *markdown-memory*: one-lesson-per-file + INDEX.md + maintenance discipline
    (update-don't-duplicate, delete-wrong-lessons, don't record what the repo already
    states). **This is independently-evolved Raphael** — strong validation, plus one
    gap we don't enforce yet: *deleting/retiring lessons proven wrong*.
- **oliwoodman/fable-skills** — 5 handover skills. The keeper idea is the **handover
  format**: "when it triggers → the one rule → the method → the standards → the output
  → **the honest limits**." Every skill ends by saying when NOT to trust it. Our skills
  factory (Phase 14 meta layer) should adopt this template.
- **DannyMac180/fable-advisor** — the **architect pattern**: expensive model emits the
  fewest tokens (judgment, specs), cheap models emit the most (code); cross-vendor
  implementers; five-part spec contract for context-free delegation. Our driver (14.5)
  already routes by policy; the adoptable idea is *token-volume routing* stated as a
  law: **expensive model = fewest emitted tokens**.
- **multica-ai/andrej-karpathy-skills** — one skill, four behavioral principles from
  Karpathy's LLM-pitfalls post: (1) *think before coding* — state assumptions, present
  interpretations instead of picking silently, push back when a simpler approach
  exists; (2) *simplicity first* — no speculative abstractions, "if 200 lines could be
  50, rewrite"; (3) *surgical changes* — every changed line traces to the request;
  clean up only orphans YOUR change created; (4) *goal-driven execution* — turn tasks
  into verifiable goals ("fix the bug" → "write a test that reproduces it, make it
  pass"). Good lesson-pack raw material for 16.7; partially overlaps lessons we
  already have (dedupe in curation).

### The memory-vault repos

- **breferrari/obsidian-mind** — an Obsidian vault as agent memory with a hook pipeline.
  Portable principles: **procedural code owns the environment, the agent owns content**
  (exactly our hooks-vs-lessons split); **progressive disclosure** (~2K tokens injected
  at session start, everything else pulled on demand — our inject budget is the same
  idea); **graph-first, not folder-first** (orphan notes are bugs; every note must link
  to an existing note); a **manifest as the single source of truth**.
- **eugeniughelbur/obsidian-second-brain** — the big idea is **OKM / the freshness
  policy**: every stored fact must be **timeless, dated, or a pointer**; a present-tense
  claim about a changeable fact with no date is the "sentence that becomes a lie next
  Tuesday." Enforced by a lint (FRESH-1..4). **Directly adoptable for our lessons and
  for Atlas** — staleness is the main long-term threat to a brain.
- **kepano/obsidian-skills** — five reference skills, two of which matter beyond the
  export use case:
  - *defuddle*: "extract clean markdown from web pages, removing clutter **to save
    tokens**" — the idea (not the npm dependency) upgrades `raph adopt`: strip
    HTML tags/nav/boilerplate to plain text before the reviewer model reads a fetched
    page. Fewer input tokens per adoption, zero new deps. → folded into 16.7.
  - *json-canvas*: the JSON Canvas 1.0 spec (`.canvas`: nodes/edges arrays, 16-char
    hex ids) — a precise, zero-dep target format for the Atlas visual export, plus
    the exact Obsidian wikilink/frontmatter rules for the markdown notes. → 16.5 now
    specifies both formats.
  - *obsidian-markdown / bases / cli*: format references; keep as pointers (a
    `lessons.base` table view over an exported brain is a cute later idea, not now).

### The outlier: teamchong/pxpipe

A local proxy that renders bulky context (system prompt, tool docs, old history) as
dense PNG images — ~3.1 chars per image-token vs ~1 per text-token, measured ~60–70%
bill cut. Impressively honest README (lossy on byte-exact strings: hashes/IDs silently
confabulate on some models). **Verdict: do not adopt.** It's orthogonal to Raphael's
architecture, adds a proxy between us and the model (tension with invariant #5's "no
other network access"), and its failure mode (silent confabulation) is the opposite of
our honesty guarantees. Recorded here so we don't re-litigate it.

### The PDF ("10 Open-Source Tools")

A listicle: Dify, Crawl4AI, Stirling PDF, Supabase, Langflow, Browser Use, Open WebUI,
Maxun, OpenHands, Coolify. These are big platforms, not techniques; nothing to port
directly. Two pointers worth keeping: OpenHands (autonomous coding agent — prior art
for the Academy driver) and Crawl4AI (clean web→markdown ingestion — prior art if
`raph adopt` ever needs richer fetching). No action items.

### Screenshot-only repos (okaashish carousel)

coleam00/context-engineering-intro (13.5k★ — context-engineering patterns; PRP
"product requirements prompt" flow), KhazP/vibe-coding-prompt-template,
filipecalegario/awesome-vibe-coding (curated list), feiskyer/claude-code-settings,
superagent-ai/vibekit (sandbox for agent code execution — relevant someday if the
Academy driver wants isolation stronger than workspace-cwd). All noted; none block
the Atlas plan; context-engineering-intro is the one worth a later `raph adopt` pass.

---

## Part 2 — The Atlas upgrade (Phase 16, proposed)

### What Atlas is, in one paragraph

`raph atlas` builds a **project knowledge graph** — files, functions/exports, commands,
tests, error codes, and the edges between them (imports, calls, tests, defines,
mentions) — **deterministically, zero model tokens**, cached by content hash, refreshed
incrementally. Agents (and the owner) then ask the graph, not the repo:
`raph atlas why-error "E-SCHEMA"` answers "this error is raised in validate.js, which is
called by writeCandidate in candidates.js and distill.js — check those three files."
The same engine powers the owner-facing map (the awareness fix) and the agent-facing
recall (the token fix).

### Why this fits Raphael perfectly

- We already have the injection moment (SessionStart/UserPromptSubmit hooks, `raph
  inject`), the explainable scorer (match.js), the compiled-index pattern
  (compile.js: hash-verified, rebuild-on-change), and a directory-level `raph map`.
  Atlas is map v2 on the same rails.
- Invariant-clean: the build is a pure local scan (no network, no model). The graph is
  data, not lessons — it does NOT enter the brain through validateLesson() because it
  never becomes a lesson; it's a per-project cache like the map. Nothing in the graph
  may command an agent (advisory data only, same rule as lessons).
- Token economics match graphify's measured curve: our Academy projects and raphael
  itself are exactly the corpus size (100s of files) where graph queries beat
  re-exploration by 10–70x.

### The milestones

**16.1 — Atlas core: the deterministic graph builder** (`src/lib/atlas.js`)
- Nodes: files, exported functions/classes (JS/TS via regex+heuristic extraction — we
  keep the js-yaml+ajv-only dependency rule, so no tree-sitter; our extractor handles
  `export function|const|class`, `require/import`, CLI verbs, test names, `E-<NAME>`
  error codes), package manifests, docs headings.
- Edges: `imports` (EXTRACTED), `calls` (INFERRED, best-effort name resolution with the
  graphify confidence rubric 0.55–0.95), `tests` (test file ↔ module under test),
  `raises`/`mentions` (error code ↔ file), `documents` (doc heading ↔ file).
- Confidence tags on every edge: EXTRACTED / INFERRED / AMBIGUOUS — ambiguous edges are
  listed in the report for the owner, never silently trusted (graphify's honesty rule).
- Degree = importance ("god nodes" = the files to know first). Simple connected-
  component + label-propagation grouping stands in for Leiden (zero-dep).
- Output: `atlas.json` (nodes/edges, node-link format) + `ATLAS.md` (the human report:
  top concepts, groups, surprising/ambiguous edges) under the project's raphael cache.
- SHA256 per-file cache; `raph atlas [--refresh]`; incremental like compile.js.

**16.2 — The error router: the owner's ask, verbatim** (`raph atlas where`)
- `raph atlas where "<error text | stack trace | E-code | question>"` → ranked files
  with the WHY: matches error-code nodes, symbol names, and path mentions, then walks
  1–2 hops (the graphify query-scoping trick) and returns a subgraph rendered as:
  "check src/lib/validate.js (raises E-SCHEMA; called by 3 write paths) → then
  candidates.js, distill.js." Deterministic, explainable (same philosophy as match.js
  — every hit shows its reasons), zero tokens.
- Also `raph atlas path A B` ("how does inject reach the model?") and
  `raph atlas explain <symbol|file>` (node + neighbors + source location).
- This is the awareness feature for humans AND the recall feature for agents — one
  engine, two faces (the §14 console law again).

**16.3 — Query-first wiring: making the savings real**
- The graphify lesson: a built graph saves nothing unless the agent is nudged at the
  moment it would otherwise grep. Wire Atlas into the existing injection surface:
  the SessionStart hook injects a ~10-line Atlas digest (top god nodes + "ask
  `raph atlas where` before wide searches") inside the existing ≤1,200-token budget;
  a PreToolUse hook (plugin/hooks) nudges search-shaped tool calls toward
  `raph atlas where` — mirror of graphify's hook, pointed at our CLI.
- The autopilot driver (14.5) prepends the Atlas digest to stage prompts for debug/
  review/develop kinds — the agent starts knowing the map instead of exploring.
- Console gets an Atlas tab later (defer until the CLI face is proven — same order we
  used for every other engine).

**16.4 — The token benchmark: prove it, honestly** (`raph atlas bench`)
- Port graphify's benchmark idea: for N recorded questions about a project, measure
  tokens-to-answer via (a) raw exploration (grep+read transcript replay or estimate)
  vs (b) Atlas subgraph. Report the ratio per corpus size, and STATE the caveat the
  way graphify does: small repos ≈ 1x, savings compound with size. Numbers go in
  `raph stats` and the weekly report. No 70x claims until our own bench shows them.

**16.5 — The Obsidian-compatible export (owner awareness, human face)**
- `raph atlas export --vault <dir>`: one markdown note per node group + per god node,
  wikilinks for edges (Obsidian Flavored Markdown per kepano's reference: `[[Name]]`
  resolves by name, frontmatter properties for type/source), every note carrying
  `source: <file>:<line>` back-references; plus an `atlas.canvas` per the JSON Canvas
  1.0 spec (plain JSON: nodes/edges, 16-hex ids — zero deps). Works in Obsidian but
  is just plain markdown + JSON.
- This is the "map only exists inside Graphify / stuck in its own bubble" catch from
  the slides, solved the same way: put the map where the human already looks.

**16.6 — Freshness discipline (OKM) for the brain and the atlas**
- Adopt the three-legal-forms rule for LESSONS: timeless / dated snapshot / pointer.
  Concretely: `raph doctor` (or a new `raph lint`) flags present-tense volatile claims
  in lesson text without an `(as of …)` stamp — FRESH-1 style, warn-only at first.
- Retire-wrong-lessons discipline from markdown-memory: the optimizer loop (Phase 14
  meta layer, already planned) uses stats retrieval-miss + a new "proven wrong" tombstone
  path — reject-after-approve — so a confidently wrong lesson can be killed, not just
  never fired. (Today we can only reject candidates; retiring actives exists only via
  adopt-revoke.)
- Atlas is self-refreshing by hash, so it can't rot the way prose does — state this in
  ATLAS.md ("generated 2026-07-17 from commit abc123", a dated snapshot by design).

**16.7 — Skill/lesson adoptions from the sweep (cheap, uses existing pipeline)**
- Run `raph adopt` over: fable-method's SKILL.md set (fit gate, twin check, AUTH gate,
  artifact gate → lessons + a possible reviewer/debugger spine update), kpab's
  act-when-ready + effort-calibrator (→ lessons feeding the policy table's "why"
  column), karpathy-guidelines (→ dedupe against existing lessons), fable-skills'
  handover format (→ the skills-factory template: every generated skill must end with
  "honest limits"). All flow through the normal gauntlet: license gate, scrub,
  reviewer agent, curator approval. Nothing hand-pastes into the brain.
- The twin check deserves special mention: it becomes both a lesson AND a Debugger-agent
  spine line ("after any fix, search the project for the same pattern; report a TWINS
  line"). Measured 5x completeness gain on cheap models in fable-method's evals.
- Defuddle's idea lands here too: a zero-dep HTML→text cleanup pass in the adopt
  fetcher (strip tags/scripts/nav boilerplate before the reviewer model reads a page)
  — fewer reviewer input tokens per adoption, no new dependency.

### Explicitly NOT adopted (and why)

| Thing | Why not |
|---|---|
| pxpipe (image-context proxy) | Lossy on byte-exact strings; proxy between us and the model conflicts with invariant #5's spirit; silent-confabulation risk is anti-honesty |
| tree-sitter / embeddings / vector DB | Breaks the js-yaml+ajv-only rule; graphify itself proves you don't need embeddings (the graph IS the similarity signal); our regex extractor is the 80% version |
| Whisper/video pass (graphify Pass 2) | No use case in our corpus; out of scope |
| supermemory/mem0-style hosted memory | Graphify's own benchmark shows the deterministic graph beats or matches them at ~1/10 the cost; and hosted = network, against invariants |
| vibekit sandbox | Real idea, wrong time — driver stages already confine to workspace cwd; revisit if Academy builds ever run untrusted code |

### Build order and cost

16.1 → 16.2 are the core (pure Node, testable with fixtures, zero tokens — same shape
as every other Raphael lib: pure functions + thin command). 16.3 makes it pay.
16.4 keeps us honest. 16.5–16.7 are cheap follow-ons that reuse existing pipelines
(inject, adopt, doctor, skills factory). Nothing here spends model tokens except the
16.7 adopt runs (reviewer agent, ~same cost as the gstack adoption) — the graph itself
is free to build and free to query, which is the entire point.

### Owner asks / boundary items

- Nothing in Phase 16 crosses the autonomy boundary (no deploy/spend/signin; adopt
  fetches are user-initiated per invariant #5b — the 16.7 runs happen when the owner
  or a session triggers them, and everything lands as reviewable candidates).
- Decision wanted: should Atlas ship inside the plugin for OTHER users' projects at
  Phase 11 (publish) time? Recommended yes — it's the most demo-able feature we'd have
  ("ask your repo where the bug lives"), and it demos at zero token cost.

---

## Addendum — gstack / gbrain deep analysis (session 10, 2026-07-17)

Owner asked for a serious, no-skim audit of **garrytan/gstack** (github.com/garrytan/gstack)
because it is "something like Raphael." Cloned (1,179 files, ~42.5k lines of code + huge docs).
Read inline (the parallel-agent attempt hit the session limit — the CLAUDE.md lesson held:
run analysis inline, not as heavy parallel workflows). Deep-read: README, ARCHITECTURE, ETHOS,
DESIGN, the full `USING_GBRAIN_WITH_GSTACK.md`, the `learn` skill end to end (gstack's brain),
plus `context-save`/`retro`/`plan-eng-review` structure and top-level layout.

### What gstack actually is (accurate mental model)

gstack is **not** a lesson-distilling brain like Raphael. It is a **library of ~60 Claude Code
skills** (markdown SKILL.md files, generated from SKILL.md.tmpl) installed into
`~/.claude/skills/gstack/`, wrapping a real dev pipeline: `spec -> office-hours -> plan-*-review
-> autoplan -> qa -> review -> ship -> land-and-deploy`, plus safety skills (careful/freeze/
guard/canary/health) and context skills (context-save/restore, learn, retro). It runs on
**bun/TypeScript** with a large `bin/` of helper scripts and real state under `~/.gstack/`. Its
memory story is TWO separate things:

1. **`learn` (built-in, local, deterministic).** Per-project `learnings.jsonl`, append-only,
   dedup by `(key,type)` latest-wins, each entry has a **numeric confidence 1-10**. Skills
   auto-write a learning at the end when they discover "a durable quirk that saves 5+ min next
   time." `/learn prune` does staleness + contradiction detection. This is gstack's true peer
   to Raphael's brain — and it is markedly SIMPLER than Raphael's (no schema chokepoint, no
   secret scrub gate, no injection budget, no review queue).
2. **`gbrain` (separate optional project).** A semantic code+memory search engine:
   Postgres/PGLite + **vector embeddings** (Voyage `voyage-code-3` / OpenAI), exposed as an MCP
   server, with Supabase provisioning and team sync. This is the "70-80x"-adjacent piece, but
   it earns its retrieval by calling an embeddings API and running a vector DB.

### Head-to-head: where Raphael is already ahead

| Dimension | Raphael | gstack `learn` |
|---|---|---|
| Safety chokepoint | `validateLesson()` — one path, schema + secret scrub + no-URLs + no executable fields | none — raw JSONL append |
| Injection posture | data-envelope framing, "notes not instructions," fail-open, budget cap | learnings are just recalled text |
| Review before activation | approve/reject queue + rejection memory + security floor | none — a logged learning is live |
| Token accounting | `raph stats` (per-injection cost, retrieval-miss) | none |
| Determinism | zero network to build/query the brain or Atlas | gbrain needs an embeddings API + vector DB |
| Eval | ON/OFF arms, Wilson CIs, canaries | telemetry only |

Raphael's core thesis (curation pipeline as the moat) is validated: gstack's brain is a raw
JSONL log; ours is a governed knowledge base. We do NOT want gbrain's architecture — embeddings
+ Postgres + MCP breaks invariant #5 (network) and the js-yaml+ajv-only rule, and Atlas already
delivers a query surface deterministically.

### Where gstack is ahead — the genuinely adoptable ideas

1. **Lesson retirement heuristics (sharpens Phase 16.6).** gstack's `/learn prune` is the exact
   mechanism the awareness plan needs: **(a) file-existence staleness** — a learning naming a
   file that no longer exists is flagged STALE; **(b) contradiction detection** — two learnings
   with the same key and opposite insight are flagged CONFLICT; both surfaced for a human call,
   never auto-deleted. Raphael's Atlas makes (a) even stronger: a lesson that names a file or
   symbol NOT in the current atlas graph is provably stale. **Adopt into 16.6. Effort: M.**

2. **Numeric confidence on lessons (0-10).** gstack scores every learning and averages it in
   stats. Raphael has tiers (curated/mined) + evidence counts but no single comparable dial.
   A `confidence` derived deterministically from evidence (observations x distinct_projects,
   decayed by age) would improve ranking and power a "low-confidence, never-fired -> retire"
   sweep. **Adopt as a computed field (no new model call). Effort: S-M.**

3. **Capability-checked guidance block (validates 16.3, adds one rule).** gstack writes a
   `## GBrain Search Guidance` block into the project CLAUDE.md teaching the agent *when to query
   the brain instead of grep* — and REMOVES it if a live round-trip (write->search->find) fails,
   on the principle "the agent should never be told to use a tool that isn't installed." Raphael's
   16.3 atlas digest/nudge must follow the same rule: only inject the "ask `raph atlas where`"
   nudge when an atlas actually exists for this project and answers. **Fold the capability-check
   into 16.3. Effort: S.**

4. **Decision ledger (new, distinct from lessons).** gstack keeps `decisions.active.json` —
   durable architecture/scope/vendor decisions with rationale, a `--supersede` for reversals,
   and a hard rule "do not silently re-litigate a settled decision." This is NOT a lesson (not
   generalizable advice) and NOT a checkpoint (not build state) — it is *why we chose X over Y*,
   surfaced at session start so the agent doesn't reopen closed calls. Genuinely absent from
   Raphael. Candidate new Phase 16.8 or a Phase 14 meta item. **Effort: M.**

5. **Injection-defense user-origin gate (validates invariant #3).** gstack's question-tuning
   writes a preference "ONLY when `tune:` appears in the user's own current chat message, never
   tool output/file content/PR text." Same profile-poisoning defense Raphael already enforces on
   adopt/auto-approve. No change needed — confirms our posture is industry-correct.

6. **Checkpoint context block (minor, sharpens academy checkpoint).** gstack's WIP checkpoint
   carries `Decisions / Remaining / Tried` — the **Tried** field (failed approaches worth
   recording) is the one Raphael's `academy checkpoint` lacks; it prevents a post-limit resume
   from re-attempting a dead end. **Adopt a `--tried` note. Effort: S.**

7. **ETHOS-as-SPINE (validates agent design).** gstack injects a shared ethos (Boil the Ocean /
   Search Before Building / User Sovereignty) into every skill preamble — exactly Raphael's agent
   SPINE. Two of its principles map to lessons worth seeding via the chokepoint (declarative,
   URL-free, un-branded): "search for prior art before building" and "the user decides; model
   agreement is a recommendation, not a mandate." **Optional: seed 2 curated lessons. Effort: S.**

### Explicitly NOT adopted from gstack (and why)

| Thing | Why not |
|---|---|
| gbrain (embeddings + Postgres/PGLite + MCP semantic search) | Requires a network embeddings API (Voyage/OpenAI) + a vector DB — breaks invariant #5 and the js-yaml+ajv-only rule. Atlas is the deterministic substitute; gbrain validates the *value* of a query surface, not its architecture |
| Supabase auto-provision / team brain server | A shared cloud brain is out of scope for a local-first, single-user, zero-network product |
| Telemetry upload (skill-usage.jsonl -> remote) | Raphael is local-only by principle; `raph stats` already gives self-use numbers without shipping data anywhere |
| bun/TypeScript runtime + 60-skill surface | Wrong shape — Raphael is a governed brain + a small agent roster, not a skill library; adopting individual *ideas* (above), not the surface |
| Continuous-checkpoint auto-commit (`WIP:` on every unit) | Raphael's ritual already commits at task boundaries with clean messages; auto-WIP noise conflicts with our "clean, documented, pushed" checkpoint discipline |

### Net for the roadmap

gstack changes **no** major architectural decision — it confirms Raphael's curation-pipeline
moat and its deterministic-over-embeddings bet. It sharpens Phase 16.6 (retire heuristics + the
Atlas-backed stale check), adds one rule to 16.3 (capability-check the nudge), and surfaces two
small new items worth a Phase 16.8: **computed confidence** and a **decision ledger**. All are
pure-Node, zero-network, zero-new-dependency — they fit Raphael's constraints exactly. Proceeding
with 16.3 as planned, now carrying the capability-check rule.
