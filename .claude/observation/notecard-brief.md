Build "Notecard": a single-user, local, single-page notes app.

Core requirements:
- Create, edit, delete notes. Each note has a title and a markdown body.
- Tag notes with one or more free-text tags; filter the note list by tag.
- Full-text search across title + body.
- Notes render as HTML from markdown, but rendering must be safe — a note body
  is untrusted input (the user might paste text from anywhere) and must never
  be able to inject a script or break out of its container.
- Persistence via a small local HTTP API (Node, zero runtime dependencies)
  backed by a file store — no database server, no external services.
- No authentication — this is a single-user local tool, not a hosted product.
- A real, crafted UI: list + detail/edit view, tag filter, search box, and
  proper empty/loading/error states. Not a bare unstyled form.

Constraints:
- Node.js >= 18, ESM, zero runtime dependencies front or back.
- Windows-first: no POSIX assumptions, atomic writes.
- Automated tests (node:test) covering the API and the markdown-to-safe-HTML path
  specifically — success, failure, and edge cases.
- No build step required to run it (no bundler, no framework compile step).

Out of scope: multi-user support, real-time sync, note attachments/images,
mobile app, hosting/deployment of any kind.
