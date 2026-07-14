# RESUME — how a fresh session continues an autonomous Academy build

If you are a new Claude Code session starting in the `raphael` project (because a Claude
usage limit reset, or the PC restarted mid-build), **read this first, then continue with no
input from the owner.**

## Find the active project, then read its checkpoint
```
node bin/raph.js academy list                 # which projects exist and their status
node bin/raph.js academy status <project>     # the live checkpoint for one
```
Trust its `NEXT:` line and the milestone checkboxes. State lives in
`~/.raphael/academy/<project>/state.json` (survives reboots; outside the project repos).
The active project is whichever is `in-progress` (currently: **onedesk**; repo-keeper is done).

## Then
1. Read the build plan for that project (e.g. `docs/academy/onedesk-plan.md`,
   `docs/academy/backlog.md`).
2. Open the workspace listed in the status.
3. Continue from `NEXT`. Work in small, tested steps. Run the project's tests after each.
4. **Checkpoint after every meaningful step** so the next resume is clean:
   ```
   node bin/raph.js academy checkpoint <project> --step "<what you just did>" --next "<the very next action>" --note "<durable note>"
   ```
   Mark a milestone done with `--done M2`.
5. **Use Raphael as you build** (the whole point — the brain now has 30 active lessons):
   - `node bin/raph.js search "<keywords>"` before writing code — pull past lessons.
   - `node bin/raph.js map --refresh` to read the project instead of re-exploring it.
   - When you learn something durable: `node bin/raph.js note "<one sentence>" --keywords a,b,c`,
     then approve it (`raph approve <id>`; security lessons need `--confirmed`, one at a time).

## Working ritual at each task boundary (see CLAUDE.md)
`npm test` -> update docs -> commit **and push** -> then it is safe to compact. Do all three
before declaring anything done, so a compaction never loses work.

## The autonomy boundary — STOP and hand to the owner (never do these autonomously)
- deploy / go live / host a running service
- sign in or create an account on a third-party service
- spend money
- anything that mutates production data or real user data

**Publishing is NOT a boundary anymore.** Per the owner (session 03), creating the product's
GitHub repo and pushing it once a milestone is green is Claude's job — do it (create the repo
via the GitHub API with the cached Git Credential Manager token, self-audit clean first, push,
add topics). Local-only was the old rule; it no longer applies.

When you reach a real boundary:
```
node bin/raph.js academy boundary <project> --reason "<exactly what the owner must do>"
```
Then stop and surface it. Do not try to route around the boundary.

## If a Claude limit stops you mid-step
```
node bin/raph.js academy limit <project> --reset "<when it resets, if shown>"
```
Then stop. The next session (or the scheduled auto-resume in
`.claude/academy/resume.ps1`) picks up from `NEXT`.
