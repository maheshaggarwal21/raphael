# Wiring the injection hooks

**Preferred: install the plugin.** The Raphael plugin (`plugin/`) registers these hooks
automatically via `plugin/hooks/hooks.json` — install the CLI (`npm install -g
maheshaggarwal21/raphael`) so `raph` is on PATH, then add the plugin in Claude Code:

```
/plugin marketplace add maheshaggarwal21/raphael
/plugin install raphael-brain@raphael
```

Then run `/brain` for the first-five-minutes setup. Nothing else to wire.

**Manual fallback** (no plugin): add this to `.claude/settings.json` in a project (or
`~/.claude/settings.json` for everywhere), with the real path to this repo:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/Users/Mahesh/Desktop/Projects/raphael/bin/raph.js inject --event session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/Users/Mahesh/Desktop/Projects/raphael/bin/raph.js inject --event user-prompt"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/Users/Mahesh/Desktop/Projects/raphael/bin/raph.js inject --event pre-tool"
          }
        ]
      }
    ]
  }
}
```

What to expect:

- Whatever the command prints becomes session context. It prints nothing until
  the first lesson is approved into the brain.
- Session start: a short advisory preamble + up to 10 stack-matched headlines
  (≤340 tokens), then — if a project atlas has been built (`raph atlas`) — a
  compact project map (most-connected files + how to ask where to look, ≤250
  tokens). It re-fires after compaction; already-shown headlines stay suppressed.
- Each prompt: at most 3 headlines and only when a trigger keyword/path in the
  prompt matches — the typical prompt gets zero added tokens.
- Before a search (Grep/Glob): a one-time-per-session nudge to try
  `raph atlas where "<error or symbol>"` first — but ONLY when an atlas is built
  for this project (capability-checked: Raphael never points you at a surface
  that isn't there). No atlas, no nudge; fires at most once per session.
- Hard session cap: ~1,200 injected tokens; past it, only high/critical fire.
- `raph why` shows every injection with its score breakdown. `raph off` stops
  injection entirely. The command always exits 0 — a broken brain can slow
  nothing down and block nothing (fail-open).
