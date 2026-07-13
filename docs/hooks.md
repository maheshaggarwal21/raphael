# Wiring the injection hooks (manual, until the plugin ships)

The plugin (Phase 9) will register these automatically. For self-use now, add
this to `.claude/settings.json` in a project (or `~/.claude/settings.json` for
everywhere), with the real path to this repo:

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
    ]
  }
}
```

What to expect:

- Whatever the command prints becomes session context. It prints nothing until
  the first lesson is approved into the brain.
- Session start: a short advisory preamble + up to 10 stack-matched headlines
  (≤340 tokens). It re-fires after compaction; already-shown headlines stay
  suppressed, only the framing is re-sent.
- Each prompt: at most 3 headlines and only when a trigger keyword/path in the
  prompt matches — the typical prompt gets zero added tokens.
- Hard session cap: ~1,200 injected tokens; past it, only high/critical fire.
- `raph why` shows every injection with its score breakdown. `raph off` stops
  injection entirely. The command always exits 0 — a broken brain can slow
  nothing down and block nothing (fail-open).
