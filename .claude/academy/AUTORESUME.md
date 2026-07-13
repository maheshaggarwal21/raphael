# Auto-resume across reboots and limit resets

Two layers keep an autonomous Academy build going without owner input:

## Layer 1 — the checkpoint (always reliable)
Every step writes durable state to `~/.raphael/academy/repo-keeper/state.json`. Any Claude
session opened in the `raphael` project can resume perfectly by reading it:
```
node bin/raph.js academy status repo-keeper     # shows NEXT
node bin/raph.js academy resume repo-keeper      # shows the runbook + NEXT
```
This needs nothing installed and never breaks. If auto-launch ever fails, opening Claude Code
in the raphael folder and saying "resume the academy build" is enough.

## Layer 2 — auto-launch on logon (best-effort)
A launcher lives in the current user's **Startup folder** and runs
`.claude/academy/resume.ps1` at every logon (no admin needed):
```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\repo-keeper-resume.cmd
```
The script:
- resumes **only** when the build status is `in-progress` or `blocked-limit`
  (never when it is `done` or paused at the owner boundary),
- throttles to at most one launch per 30 minutes,
- opens a **visible** PowerShell window and starts Claude with the resume prompt,
- logs every decision to `.claude/academy/resume.log`.

So after a reboot (or when you next log in after a limit reset), it reopens the build. It is
best-effort: it needs the PC on, the `claude` CLI logged in, and the subscription available.

### Manage it
```
# turn it OFF: just delete the launcher
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\repo-keeper-resume.cmd"

# turn it back ON: recreate that .cmd with one line:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "<repo>\.claude\academy\resume.ps1"
```

### Alternative: a scheduled task (needs an admin terminal)
If you prefer Task Scheduler, run from an **elevated** PowerShell:
```
powershell -ExecutionPolicy Bypass -File .claude\academy\register-resume-task.ps1
```
(That path failed here because this session isn't elevated — the Startup launcher above is the
no-admin equivalent and is what's installed.)

### On a Claude usage limit
When a limit stops the build mid-step, run (or the session runs):
```
node bin/raph.js academy limit repo-keeper --reset "<when>"
```
The status becomes `blocked-limit`; the next logon (or the next opened session) resumes it,
and the first checkpoint flips it back to `in-progress`.
