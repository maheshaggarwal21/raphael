# Model provider — subscription vs API key

Raphael needs a model for exactly one job: turning a mined episode into a candidate
lesson (`raph distill`). It can get that model two ways.

## The two providers

| Provider | How | Billing | When |
|---|---|---|---|
| **subscription** (default) | shells out to the local `claude -p` | your fixed-price Pro/Max plan | you're logged into the Claude Code CLI |
| **api** (fallback) | direct Anthropic Messages API (`src/lib/model.js`) | metered `ANTHROPIC_API_KEY` usage | CI / servers with no logged-in CLI |

`model.provider` in `config.yaml` chooses: `auto` (default — subscription if the CLI is
available, else the API key), `subscription`, or `api`.

Why subscription is the default: the owner's concern is **predictable cost**. A metered
API key can run up an unbounded bill; the subscription is a flat monthly price. So unless
you deliberately choose `api`, Raphael spends your subscription, not metered tokens.

## Same containment, two transports

The security invariant is identical on both paths: the model reads adversarial episode
text but can **execute nothing**.

- **api**: the request defines exactly one tool and forces it (`tool_choice`), and no
  other tools exist — the model is architecturally incapable of acting.
- **subscription**: `claude -p` is launched with `--tools ""` (every built-in tool off)
  and `--strict-mcp-config` with no MCP config (no MCP tools either), and structured
  output is forced with `--json-schema`. The spawned process also runs with
  `ANTHROPIC_API_KEY` stripped from its environment, so billing can't silently fall
  through to metered API usage, and in a neutral working directory so no project
  `CLAUDE.md` leaks into the extraction context.

## Session limits (subscription)

When the subscription hits its limit, `claude -p` refuses with a message like
"You've hit your session limit · resets 5:50pm (Asia/Calcutta)". Raphael detects this
(`E-LIMIT`), **stops the run**, and leaves every not-yet-distilled episode unledgered so
they retry untouched next time. `raph distill` exits with code 4 and prints when the
limit resets. This is the hook the self-training pipeline (ARCHITECTURE §12) uses to
pause and auto-resume.

## Still pending: one live verification

The pure logic (arg building, output parsing, limit detection, provider selection) is
unit-tested. The live end-to-end call (`claude -p` actually returning a structured
lesson) has NOT been run yet — the subscription limit was reached during this build. The
first thing to verify when the limit resets:

```
RAPHAEL_HOME=<sandbox> raph distill --yes
# expect: "MODEL  provider=subscription (auto: CLI available)" then real candidates
```

If the structured object doesn't come back where `parseCliResult` looks for it
(`result` field), that parser is the one place to adjust — everything else is transport.
