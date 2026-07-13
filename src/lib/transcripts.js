// Transcript locator: finds Claude Code session files (.jsonl) for a project.
// Read-only over ~/.claude — Raphael never writes into the transcript tree.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Claude Code sanitizes the project cwd into a directory name by replacing
// every char outside [A-Za-z0-9] with '-'.
export function sanitizeCwd(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

function defaultProjectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Resolves the transcript directory for a project cwd, or null if none exists.
// Drive-letter case drifts across Claude Code versions (C-- vs c--), so an
// exact-name miss falls back to a case-insensitive scan of the projects dir.
// projectsRoot is injectable for tests; callers use the default.
export function projectTranscriptDir(cwd, projectsRoot = defaultProjectsRoot()) {
  if (!existsSync(projectsRoot)) return null;

  const name = sanitizeCwd(cwd);
  const exact = path.join(projectsRoot, name);
  if (existsSync(exact) && statSync(exact).isDirectory()) return exact;

  const wanted = name.toLowerCase();
  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.toLowerCase() === wanted) {
      return path.join(projectsRoot, entry.name);
    }
  }
  return null;
}

// Lists top-level *.jsonl session files (subdirectories hold subagent
// transcripts — not sessions, so no recursion). Live files (recently written,
// possibly mid-session) are flagged, not filtered: the caller reports counts.
export function listSessionFiles(dir, { skipLiveMs = 600000, now = Date.now() } = {}) {
  if (!existsSync(dir)) return [];

  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) continue;
    const filePath = path.join(dir, entry.name);
    const st = statSync(filePath);
    out.push({
      path: filePath,
      mtimeMs: st.mtimeMs,
      size: st.size,
      live: now - st.mtimeMs < skipLiveMs
    });
  }
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}

// Content hash for the mined ledger. CRLF is normalized to LF first so the
// hash is stable across line-ending drift on Windows checkouts.
export function contentHash(filePath) {
  const text = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
