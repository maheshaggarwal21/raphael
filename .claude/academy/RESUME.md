# RESUME — how a fresh session continues an autonomous Academy build

If you are a new Claude Code session starting in the `raphael` project (because a Claude
usage limit reset, or the PC restarted mid-build), **read this first, then continue with no
input from the owner.**

## The one command that tells you where you are
```
node bin/raph.js academy status repo-keeper
```
Trust its `NEXT:` line and the milestone checkboxes. That is the live checkpoint, stored in
`~/.raphael/academy/repo-keeper/state.json` (survives reboots; outside the project repos).

## Then
1. Read the build plan: `docs/academy/backlog.md` (Idea 3 → Repo Keeper → milestones).
2. Open the workspace listed in the status (`C:\Users\Mahesh\Desktop\Projects\repo-keeper`).
3. Continue from `NEXT`. Work in small, tested steps. Run the project's tests after each.
4. **Checkpoint after every meaningful step** so the next resume is clean:
   ```
   node bin/raph.js academy checkpoint repo-keeper --step "<what you just did>" --next "<the very next action>" --note "<durable note>"
   ```
   Mark a milestone done with `--done M2`.
5. **Use Raphael as you build** (the whole point):
   - `node bin/raph.js search "<keywords>"` before writing code — pull past lessons.
   - `node bin/raph.js map --refresh` to read the project instead of re-exploring it.
   - When you learn something durable: `node bin/raph.js note "<one sentence>" --keywords a,b,c`.
   - The Security Auditor agent reuses the 26-lesson security pack (`raph pack add security`).

## The autonomy boundary — STOP and hand to the owner (never do these autonomously)
- deploy / go live
- sign in or create an account
- spend money
- publish (npm publish, app store, etc.)
- push to a public remote (`git push` to GitHub)

When you reach one:
```
node bin/raph.js academy boundary repo-keeper --reason "<exactly what the owner must do>"
```
Then stop and surface it. Do not try to route around the boundary.

## If a Claude limit stops you mid-step
```
node bin/raph.js academy limit repo-keeper --reset "<when it resets, if shown>"
```
Then stop. The next session (or the scheduled auto-resume in
`.claude/academy/resume.ps1`) picks up from `NEXT`.

## Local commits are fine; pushes are not
Commit progress locally in the workspace repo after each milestone. Do NOT push. The owner
does the first push and any deploy.
