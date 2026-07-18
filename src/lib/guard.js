// Project secret guard: a deterministic pre-commit scanner for the USER's own
// repositories (distinct from the brain's pre-push guard in init.js). It blocks
// a commit that would write a secret into git history. It reuses the chokepoint's
// exact secret patterns (SECRET_RULES) so "what is a secret" has one definition.
//
// Design: the named, high-precision rules always run and are what a commit gate
// should block. The recall-oriented entropy heuristic is OPT-IN (--entropy) —
// it is noisy on lockfiles/minified assets, the wrong default for a blocker.
// The scanner fails toward letting a commit proceed on any read error (a guard
// must never wedge a repo); the named rules only match real secret shapes anyway.

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, rmSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SECRET_RULES, isHighEntropyToken } from './scrub.js';

export const HOOK_MARKER = 'raphael-guard';
export const ALLOWLIST_FILE = '.raphallow';
const MAX_SCAN_BYTES = 1024 * 1024; // 1 MB — skip large/generated blobs

// Absolute path to this CLI's entry, baked into installed hooks as the fallback
// used when the global `raph` command is not on PATH.
export function cliBinPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'raph.js');
}

// --- allowlist (.raphallow) -----------------------------------------------------
//
// Security tools' own sources and test fixtures always trip secret scanners
// (pattern definitions, canonical example keys) — seen on repo-keeper AND assay.
// `.raphallow` at the repo top lists glob patterns for files the PROJECT guard
// skips. Scoped deliberately: it affects only this guard, never the brain's
// chokepoint or the scrubber, and the CLI announces when it is active — an
// allowlist must be visible, not silent.

// Minimal glob -> RegExp: `**` spans directories, `*` stays inside one segment,
// `?` is a single character; a trailing `/` means the whole directory.
export function globToRegExp(pattern) {
  let p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.endsWith('/')) p += '**';
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        out += '(?:.*)';
        i++;
        if (p[i + 1] === '/') i++; // "**/" also matches zero directories
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

// Load .raphallow from the repo top. Always returns a matcher; with no file (or
// outside a repo) it matches nothing, so the guard's default stays strict.
export function loadAllowlist(topDir) {
  const patterns = [];
  const regexps = [];
  try {
    const raw = readFileSync(path.join(topDir, ALLOWLIST_FILE), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      patterns.push(t);
      regexps.push(globToRegExp(t));
    }
  } catch { /* no allowlist — match nothing */ }
  return {
    patterns,
    matches(relPath) {
      const p = relPath.replace(/\\/g, '/');
      return regexps.some((re) => re.test(p));
    }
  };
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

// Find secrets in a blob of text. Returns [{ line, type }], de-duped and sorted.
export function scanText(text, { entropy = false } = {}) {
  const findings = [];
  for (const [type, re] of SECRET_RULES) {
    // fresh RegExp so module-level lastIndex is never shared between scans
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const rx = new RegExp(re.source, flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      findings.push({ line: lineOf(text, m.index), type });
      if (m.index === rx.lastIndex) rx.lastIndex++; // guard against zero-width matches
    }
  }
  if (entropy) {
    const flagged = new Set(findings.map((f) => f.line));
    text.split(/\r?\n/).forEach((ln, i) => {
      if (flagged.has(i + 1)) return; // a named rule already caught this line
      for (const tok of ln.split(/[\s"'`]+/)) {
        if (isHighEntropyToken(tok)) { findings.push({ line: i + 1, type: 'high-entropy' }); break; }
      }
    });
  }
  const seen = new Set();
  const out = [];
  for (const f of findings.sort((a, b) => a.line - b.line || a.type.localeCompare(b.type))) {
    const k = `${f.line}:${f.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Scan a file on disk. Returns [] for missing/binary/oversized/unreadable files.
export function scanFile(absPath, opts) {
  try {
    const st = statSync(absPath);
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) return [];
    const buf = readFileSync(absPath);
    if (looksBinary(buf)) return [];
    return scanText(buf.toString('utf8'), opts);
  } catch {
    return [];
  }
}

// --- git plumbing -------------------------------------------------------------

function git(cwd, args, opts = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
}

export function isGitRepo(dir) {
  const r = git(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && r.stdout.trim() === 'true';
}

export function gitTopLevel(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.status === 0 ? r.stdout.trim() : null;
}

// Files staged for the next commit (added/copied/modified — deletions excluded).
export function listStagedFiles(cwd) {
  const r = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACM']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function listTrackedFiles(cwd) {
  const r = git(cwd, ['ls-files']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

// The staged CONTENT of a file (":path" = the index blob) — what will actually
// be committed, which can differ from the working tree.
function readStagedBlob(cwd, file) {
  const r = spawnSync('git', ['show', `:${file}`], { cwd });
  if (r.status !== 0) return null;
  return r.stdout; // Buffer (no encoding set)
}

// Scan everything staged for commit. Returns [{ file, findings }] for hits only.
// Files matched by .raphallow (repo top) are skipped.
export function scanStaged(cwd, opts) {
  const allow = loadAllowlist(gitTopLevel(cwd) || cwd);
  const results = [];
  for (const file of listStagedFiles(cwd)) {
    if (allow.matches(file)) continue;
    const buf = readStagedBlob(cwd, file);
    if (!buf || buf.length > MAX_SCAN_BYTES || looksBinary(buf)) continue;
    const findings = scanText(buf.toString('utf8'), opts);
    if (findings.length) results.push({ file, findings });
  }
  return results;
}

// Scan every TRACKED file (what `raph guard scan --all` runs; the console's
// guard page calls this too). Allowlisted files are skipped — the caller must
// surface `allowlist` so a security gate never narrows silently.
export function scanTracked(cwd, opts) {
  const top = gitTopLevel(cwd) || cwd;
  const allow = loadAllowlist(top);
  const results = listTrackedFiles(cwd)
    .filter((f) => !allow.matches(f))
    .map((f) => ({ file: f, findings: scanFile(path.join(top, f), opts) }))
    .filter((r) => r.findings.length);
  return { top, allowlist: allow.patterns, results };
}

// Is the raphael pre-commit guard installed in this repo?
export function hookStatus(projectDir) {
  const top = gitTopLevel(projectDir);
  if (!top) return { isRepo: false, installed: false };
  const hookPath = path.join(top, '.git', 'hooks', 'pre-commit');
  if (!existsSync(hookPath)) return { isRepo: true, installed: false };
  const foreign = !readFileSync(hookPath, 'utf8').includes(HOOK_MARKER);
  return { isRepo: true, installed: !foreign, foreign, hookPath };
}

// --- hook install/uninstall ---------------------------------------------------

function hookScript(binPath) {
  const nodePath = binPath.replace(/\\/g, '/'); // sh-safe even on Windows
  return `#!/bin/sh
# ${HOOK_MARKER} v1 — blocks commits that would leak secrets.
# Reinstall/upgrade: raph guard install   ·   remove: raph guard uninstall
# Bypass a single commit (use sparingly): git commit --no-verify
if command -v raph >/dev/null 2>&1; then
  raph guard scan --staged
  exit $?
fi
node "${nodePath}" guard scan --staged
exit $?
`;
}

export function installPreCommitHook(projectDir, { force = false } = {}) {
  const top = gitTopLevel(projectDir);
  if (!top) return { ok: false, reason: 'not-a-git-repo' };
  const hooksDir = path.join(top, '.git', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  if (existsSync(hookPath) && !force) {
    const existing = readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) return { ok: false, reason: 'foreign-hook', hookPath };
  }
  writeFileSync(hookPath, hookScript(cliBinPath()), 'utf8');
  try { chmodSync(hookPath, 0o755); } catch { /* windows: mode is a no-op */ }
  return { ok: true, hookPath, top };
}

// Autopilot's zero-touch guard (owner ask 2026-07-18): make sure a project's
// git repo carries the pre-commit secret hook without anyone running
// `raph guard install`. Idempotent and polite: an already-raphael hook is left
// alone, a FOREIGN hook is NEVER clobbered (reported, not forced), and a
// directory that is not a git repo is a clean no-op.
export function ensureGuard(projectDir) {
  const status = hookStatus(projectDir);
  if (!status.isRepo) return { status: 'not-a-repo' };
  if (status.installed) return { status: 'present', hookPath: status.hookPath };
  if (status.foreign) return { status: 'foreign-hook', hookPath: status.hookPath };
  const r = installPreCommitHook(projectDir, { force: false });
  return r.ok
    ? { status: 'installed', hookPath: r.hookPath }
    : { status: r.reason, hookPath: r.hookPath ?? null };
}

export function uninstallPreCommitHook(projectDir) {
  const top = gitTopLevel(projectDir);
  if (!top) return { ok: false, reason: 'not-a-git-repo' };
  const hookPath = path.join(top, '.git', 'hooks', 'pre-commit');
  if (!existsSync(hookPath)) return { ok: true, removed: false };
  const existing = readFileSync(hookPath, 'utf8');
  if (!existing.includes(HOOK_MARKER)) return { ok: false, reason: 'foreign-hook', hookPath };
  rmSync(hookPath, { force: true });
  return { ok: true, removed: true, hookPath };
}
