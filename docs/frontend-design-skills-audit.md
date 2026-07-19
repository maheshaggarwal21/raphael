# Frontend / design skills — a deep read

Owner ask (2026-07-20): frontend design/development is where AI lags most, so the
agents/skills concerned with it should become Raphael's flagship. Study two resources
the same way gstack was studied (docs/gstack-agents-audit.md) — understand the real
architecture, then propose. The resources:

1. **`nextlevelbuilder/ui-ux-pro-max-skill`** — an AI design-intelligence skill: 161
   reasoning rules, 84 UI styles, a searchable rule database, a design-system generator.
2. **The "EZYE Design Stack"** — which, read honestly, is a *marketing guide* (by EZYE
   Consulting) wrapped around **Anthropic's own public skills repo** (`anthropics/skills`:
   `frontend-design`, `web-artifacts-builder`, `brand-guidelines`, `canvas-design`,
   `pptx`, `docx`). The genuinely novel artifacts to study there are Anthropic's actual
   skill files, not EZYE's install instructions — so that's what this read covers.

Both cloned to `C:/Users/Mahesh/Desktop/Projects/_research/` (reference only, not
committed). Depth-of-read is annotated per skill in §5.

---

## 1. The headline finding: these two resources are complementary, not competing

They solve the *same* problem — AI frontend output looks generic ("AI slop") — from two
completely different architectural directions, and Raphael can take one lesson from each:

- **ui-ux-pro-max is the deterministic KNOWLEDGE layer.** A searchable local database of
  design rules (styles, palettes, font pairings, UX guidelines, anti-patterns), queried by
  a **BM25 search engine with zero LLM/API calls** (verified: `search.py` imports only a
  local `core`/`design_system` module; `grep` for `anthropic|openai|requests.post|http`
  across its scripts returned nothing). Structured knowledge, retrieved deterministically.
- **Anthropic's `frontend-design` is the JUDGMENT / taste layer.** A dense, opinionated
  system prompt — no scripts, no database — about *how to make non-generic choices*: name
  the subject, spend your boldness in one place, critique your own plan against the generic
  default before building. Pure prose guidance for the model's own reasoning.

The strongest possible frontend agent needs both: the knowledge layer so it isn't
guessing at what a good spa palette is, and the judgment layer so it doesn't produce the
same competent-but-templated page every time. Raphael already has the *machinery* for the
knowledge layer (the exact same architecture, see §3) and the *delivery mechanism* for the
judgment layer (agent missions). It's missing the design *content* in both.

**A convergence worth naming, because it recurs across every design resource studied:**
the specific "AI slop" visual clusters are named identically by four independent sources.
Anthropic's `frontend-design` names them exactly (a warm cream background near `#F4F1EA`
with a high-contrast serif and a terracotta accent; a near-black background with one acid-
green/vermilion accent; a broadsheet layout with hairline rules and zero border-radius);
`web-artifacts-builder` names "excessive centered layouts, purple gradients, uniform
rounded corners, Inter font"; ui-ux-pro-max encodes anti-patterns per rule ("Emoji as
icons," "Mixing flat & skeuomorphic randomly"); and the `taste-skill` from the earlier v2
research (docs/v2-vision.md §1) named the same purple-gradient/centered-card look. Four
unrelated teams converging on the same named enemy is strong evidence that "generic
frontend output" is a real, specific, nameable failure mode — not a vague complaint — and
therefore something a curated lesson set can actually target.

---

## 2. ui-ux-pro-max — the mechanism in detail (read in full: main SKILL + design-system + brand + ui-styling + search.py header + data layout)

Seven skills under `.claude/skills/`: `ui-ux-pro-max` (the core search intelligence),
`design-system` (token architecture + slide generation), `design` (logos/mockups/social),
`ui-styling` (shadcn/Tailwind implementation), `brand` (identity + sync), `banner-design`,
`slides`. The architecture that matters:

### 2.1 A deterministic, searchable design-rule database
The core skill ships a `data/` directory of CSVs — `colors.csv`, `products.csv`,
`landing.csv`, `motion.csv`, `google-fonts.csv`, `icons.csv`, `charts.csv`, plus a
`stacks/` subdirectory with one CSV per framework (22 stacks: react, nextjs, vue, svelte,
flutter, swiftui, react-native, laravel, and more). `search.py` does **BM25 ranking over
these CSVs** — a classic sparse-retrieval algorithm, entirely local, no model call. This
is, structurally, *exactly* Raphael's Atlas bet ("deterministic retrieval over structured
knowledge beats embeddings and model-calls when the knowledge is structured"), applied to
the design domain instead of the code-graph domain. It is the single most architecturally-
aligned repo studied across this whole v2 research effort — it independently validates
Raphael's core retrieval philosophy from a completely different problem space.

### 2.2 The `--design-system` reasoning engine
`search.py --design-system "<product> <industry> <keywords>"` searches product/style/
color/landing/typography domains in parallel, applies reasoning rules from a
`ui-reasoning.csv`, and returns a synthesized recommendation: layout pattern, style, color
palette (with named hex + rationale), typography pairing (with a Google Fonts share URL),
key effects, and **the anti-patterns to avoid** — all in one pass, rendered as ASCII,
markdown, or JSON. The "0 results → do not fabricate, say it came from defaults" honesty
rule is stated explicitly, matching Raphael's own fail-honest posture.

### 2.3 The MASTER.md + page-override persistence pattern
`--persist` writes `design-system/<slug>/MASTER.md` (the global source of truth for a
project's design system) plus per-page override files under `pages/`. Crucially:
`--persist` **refuses to overwrite an existing MASTER.md without `--force`**, so prior
design decisions a human or teammate made are never silently discarded. Retrieval when
building a page: read MASTER, check for a page override, apply. This is functionally
identical to Raphael's own **decision ledger** (`src/lib/decisions.js`, `raph decide`) —
a durable, per-project record of settled calls, surfaced at the right moment, not
re-litigated. ui-ux-pro-max applies the pattern to *design* decisions specifically;
Raphael has the exact mechanism and doesn't yet point it at design.

### 2.4 Design dials (variance / motion / density, 1-10)
`--variance`, `--motion`, `--density` are optional 1-10 sliders that tune the generated
design system without changing the query (low variance → minimalism; high → brutalism/
bento; high density → dashboard spacing). **This is the third independent occurrence** of
the "named, bounded 1-10 dial" pattern in this research effort (taste-skill had variance/
motion/density; Raphael's own proposed recall dial, docs/v2-vision.md §3.4, is the same
shape). Three unrelated sources landing on the identical UX pattern is a strong signal
it's the right way to expose a bounded aesthetic/behavioral control.

### 2.5 Three-layer token architecture + a deterministic token-compliance validator
`design-system` encodes primitive → semantic → component tokens (`--color-blue-600` →
`--color-primary` → `--button-bg`) and ships `validate-tokens.cjs`, which **scans code for
hardcoded hex/color values that should be token references** — a deterministic lint, no
model call. This is structurally the same idea as Raphael's `guard` (`src/lib/guard.js`
scans for a pattern class — secrets — deterministically); a "design guard" that flags
raw hex where a token belongs is the same mechanism pointed at a different pattern class.

### 2.6 Priority-ordered rule categories with explicit anti-patterns
The core skill's rule table is ordered by impact (1 = Accessibility CRITICAL, 2 = Touch &
Interaction CRITICAL, … 10 = Charts LOW), each row listing "Key Checks (Must Have)" and
"Anti-Patterns (Avoid)." This is precisely the shape of a Raphael lesson — a declarative
rule with a rationale and a failure mode — just authored as a static table rather than
mined. It's a ready-made source of curated design lessons.

---

## 3. Anthropic's design skills — the judgment layer + the build pipeline

### 3.1 `frontend-design` (read in full, 55 lines) — the taste system prompt
No scripts. It's a masterclass system prompt for *not* producing generic design, and it's
the single most directly-usable artifact for sharpening Raphael's own `raphael-design`
agent mission. Its load-bearing moves:
- **Frame as a studio design lead** whose client already rejected templated proposals and
  is paying for a distinctive point of view — "take one real aesthetic risk you can justify."
- **Ground it in the subject:** if the brief doesn't pin down the product, pin it yourself;
  distinctive choices come from "the subject's own world, its materials, instruments,
  artifacts, and vernacular." Explicitly says to use anything in memory about the human's
  preferences or prior designs — i.e. *exactly* what a Raphael brain of design lessons
  would provide.
- **The named slop clusters** (§1) with the rule: where the brief pins a direction, follow
  it; where it leaves an axis free, "don't spend that freedom on one of these defaults."
- **A two-pass process:** brainstorm a compact token system (4-6 named hex, 2+ typeface
  roles, a layout concept in ASCII wireframes, and a "signature" — the one memorable
  element), then **critique that plan against the generic default before writing any
  code** — "work through a similar prompt to see if you arrive somewhere similar; if so,
  revise and say what you changed and why." This is a self-adversarial gate, the design-
  domain twin of gstack's "quote the line or suppress" review gate.
- **"Spend your boldness in one place"** + Chanel's "remove one accessory before leaving"
  — restraint as a discipline, with a stated quality floor (responsive to mobile, visible
  keyboard focus, reduced motion respected) built "without announcing it."
- **Copy is design material, not decoration:** active-voice controls ("Save changes" not
  "Submit"), an action keeps its name through the whole flow ("Publish" → "Published"),
  errors don't apologize and are never vague, empty states are invitations to act.

### 3.2 `web-artifacts-builder` (read in full) — the build pipeline
A concrete React 18 + TypeScript + Vite + Tailwind + shadcn/ui pipeline: an init script
scaffolds a project with 40+ shadcn components pre-installed, you edit, a bundle script
inlines everything to a single self-contained `bundle.html`. Leads with the same anti-slop
rule ("avoid excessive centered layouts, purple gradients, uniform rounded corners, Inter
font"). This is the *builder* half — the thing Raphael's roster completely lacks today
(§4). Note: it targets claude.ai artifacts specifically, so the exact scaffolding isn't
directly portable, but the shape (opinionated scaffold → edit → bundle → optionally test-
later-not-upfront) is a real reference for a frontend-builder agent's workflow.

### 3.3 `brand-guidelines` + `canvas-design` (read in full) — brand-as-shared-context, philosophy-first
`brand-guidelines` is a brand identity (colors, type, accent-cycling rules) that every
*other* output reads and applies — the "store the identity once, every skill applies it"
pattern EZYE's guide correctly identifies as "the whole trick." `canvas-design` is
philosophy-first: write a named design *manifesto* (an aesthetic movement) first, then
express it visually, with a striking instruction to **repeatedly emphasize craftsmanship**
in the philosophy ("meticulously crafted," "master-level execution") so the downstream
expression aims high. The brand-as-shared-context pattern is, again, Raphael's decision-
ledger / a design-decisions lesson applied at every build — the same convergence as §2.3.

---

## 4. The gap in Raphael today, stated precisely (verified against src/lib/agents.js + the schema)

- **`raphael-design` is review-only and NOT flagship.** Confirmed in `src/lib/agents.js`:
  its tools are `Read, Grep, Glob` — it literally *cannot build or edit* anything, only
  review UI it's shown. Its mission is "reviews UI/UX and visual consistency." So Raphael
  today has no agent that actually *produces* distinctive frontend — the generic
  `developer` agent writes whatever code, and `design` can only comment afterward.
- **No `design` lesson category exists.** Confirmed: the schema enum is `security,
  correctness, performance, reliability, process, tooling, api-design, data` — design is
  absent. Raphael's brain has no way to *hold* a design lesson today even if one were mined.
- **No design pack.** `raph pack add security` seeds 26 security lessons; there is no
  design equivalent, so a fresh brain knows nothing about avoiding AI slop.
- **The decision ledger isn't pointed at design.** `raph decide` exists and is exactly the
  MASTER.md pattern, but nothing records or injects per-project design decisions.
- **Guard doesn't cover design tokens.** `raph guard` scans for secrets; there's no
  hardcoded-hex-where-a-token-belongs check.

Every one of these gaps maps to a mechanism Raphael *already has* and simply hasn't
pointed at the design domain — which is why "make frontend design flagship" is a
realistic, mostly-additive project rather than a new subsystem. The plan is in
docs/frontend-design-flagship-plan.md.

---

## 5. Full skill catalog (depth of read noted)

**ui-ux-pro-max-skill** (7 skills):

| Skill | Read depth | Purpose |
|---|---|---|
| `ui-ux-pro-max` | **FULL** (SKILL + search.py header + data layout) | The core deterministic design-rule search DB + `--design-system` generator + dials + persistence |
| `design-system` | **FULL** | 3-layer token architecture + token validator + BM25 slide generation w/ emotion-arc CSVs |
| `brand` | **FULL** | Brand identity + sync (brand-guidelines.md → tokens → CSS) + asset validation |
| `ui-styling` | **PARTIAL** (SKILL head) | shadcn/ui + Tailwind implementation guidance + component catalog |
| `design` | FRONTMATTER | Logo/mockup/icon/social-image generation (CIP data-driven) |
| `banner-design` | FRONTMATTER | Banner sizes + styles |
| `slides` | FRONTMATTER | Thin entry to design-system's slide generator |

**anthropics/skills** (design-relevant subset):

| Skill | Read depth | Purpose |
|---|---|---|
| `frontend-design` | **FULL** | The taste/judgment system prompt — anti-slop, two-pass critique, copy-as-material |
| `web-artifacts-builder` | **FULL** | React+TS+Vite+Tailwind+shadcn scaffold → edit → bundle-to-single-HTML pipeline |
| `brand-guidelines` | **FULL** | Anthropic brand-as-shared-context (colors/type/accent-cycling) |
| `canvas-design` | **FULL** (philosophy half) | Design-philosophy-manifesto-first, then express visually; craftsmanship emphasis |
| `pptx` / `docx` | FRONTMATTER (via EZYE description) | Real .pptx / print-ready .docx generation (out of Raphael's coding-agent scope — noted, not pursued) |
| `webapp-testing` | FRONTMATTER | Playwright/Puppeteer testing (overlaps Raphael's eval/qa direction, not design) |

---

## 6. What NOT to import (stated plainly)

- **pptx/docx/slide/banner/logo generation** — real capabilities, but they're
  document/marketing-asset production, not the coding-agent frontend work that is
  Raphael's domain. Out of scope; naming them so a future session doesn't treat "make
  design flagship" as license to build a slide generator.
- **A bundled Python search binary shipped inside Raphael** — ui-ux-pro-max's `search.py`
  is a great *reference architecture*, but Raphael already has its own deterministic
  retrieval engine (the brain + Atlas). The right move is to feed design *knowledge*
  through Raphael's existing chokepoint as lessons, not to vendor a second, parallel
  retrieval system in a different language (that would violate the js-yaml/ajv-only
  dependency discipline and duplicate machinery Raphael already owns).
- **canvas-design's "repeat 'meticulously crafted' many times" prompt-padding trick** —
  it may work for that skill, but it's the kind of unmeasured prompt-superstition
  Raphael's eval-first posture exists to avoid asserting. Borrow the *idea* (aim the
  agent at a high craft bar) without the specific incantation, unless an eval shows it
  actually helps.
