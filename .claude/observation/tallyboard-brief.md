Build "Tallyboard": a tiny offline scoreboard for a board-games night.

Why it exists: a group playing several rounds wants running totals without a
spreadsheet, on one laptop, with no account and no network.

Core requirements:
- A zero-dependency Node ESM module that holds players and rounds and computes
  standings: total per player, rank, and the leader. Ties share a rank.
- A CLI (`tally`) that can add a player, record a round of scores, and print the
  standings table.
- A single self-contained HTML page rendering the same standings, opened
  directly from disk. No server, no build step, no CDN.
- Automated tests with node:test covering success, failure, and edge cases for
  every function — including the tie case and an empty board.

Constraints:
- Node >= 18, ESM, ZERO runtime dependencies.
- Windows-first: no POSIX assumptions, atomic writes via temp-file + rename.
- All user-supplied text must be escaped where it is rendered into HTML.
- The UI must meet the mechanical floor: text contrast at least 4.5:1, a visible
  focus state on every interactive element, colours from CSS custom properties
  rather than raw hex scattered through the markup, and it must respect
  prefers-reduced-motion.

Out of scope: hosting it, publishing it, any account or sign-in flow, any
network call whatsoever.
