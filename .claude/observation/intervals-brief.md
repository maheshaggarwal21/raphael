Build "Intervals": a single-page interval timer for workouts (HIIT, Pomodoro,
stretching routines).

Core requirements:
- A routine is an ordered list of intervals. Each interval has a label, a
  duration in seconds, and a kind ("work" or "rest").
- Build, edit, reorder and delete intervals in the routine. Routines persist
  across a page reload.
- Run the routine: start, pause, resume, skip to next, reset. The display shows
  the current interval's label, its countdown, which interval this is out of how
  many, and the total time left in the whole routine.
- A routine can repeat a whole cycle N times. The total-time-left figure must
  account for remaining cycles, not just the current pass.
- Time is displayed as M:SS (and H:MM:SS once an hour or more remains).
- A real, crafted UI: the running timer is the focus, controls are unambiguous,
  and the current interval is visually distinct from work vs rest. Proper empty
  state (no intervals yet) and a clear "routine finished" state.

Constraints:
- Node.js >= 18, ESM, ZERO runtime dependencies, front and back.
- No build step, no bundler, no framework. The page must run by opening it
  through a tiny static server the project provides.
- Windows-first: no POSIX assumptions, atomic writes if anything is written.
- The scheduling logic must be PURE and separated from the DOM: given a routine
  and an elapsed-milliseconds value, a pure function returns which interval is
  current, its remaining time, and the total remaining. This is what makes it
  testable without a browser.
- Automated tests (node:test) covering that pure logic specifically — success,
  failure, and edge cases. Required edges: an empty routine, a single interval,
  elapsed exactly on an interval boundary, elapsed past the end of the routine,
  a multi-cycle routine, and a zero-duration interval.
- Persistence is a local JSON file via a tiny Node HTTP API. No database, no
  external services, no authentication.

Out of scope: audio/sound, notifications, accounts, sharing, mobile app,
hosting or deployment of any kind, analytics.
