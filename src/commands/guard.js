import path from 'node:path';
import {
  installPreCommitHook, uninstallPreCommitHook, scanStaged, scanTracked,
  scanFile, gitTopLevel, isGitRepo, loadAllowlist, ALLOWLIST_FILE
} from '../lib/guard.js';

const HELP = `raph guard — block commits that would leak secrets

Usage:
  raph guard install [--project <path>] [--force]
        Install a pre-commit hook in the project (default: current directory).
        --force replaces a non-raphael pre-commit hook (back it up first).
  raph guard uninstall [--project <path>]
        Remove the raphael pre-commit hook (leaves any other hook alone).
  raph guard scan [--staged | --all | <path...>] [--entropy]
        Scan for secrets and exit 1 if any are found. --staged = the content
        about to be committed (what the hook runs); --all = every tracked file;
        or pass explicit file paths. --entropy adds the noisier high-entropy pass.

Allowlist: a .raphallow file at the repo top lists glob patterns (one per line,
# comments; ** spans directories) for files the guard skips — for detector
sources and test fixtures that legitimately contain secret-shaped strings.
The scan announces when an allowlist is active. Explicit file paths are always
scanned in full, allowlist or not.

Same secret patterns as the brain's safety chokepoint. Bypass a single commit
(sparingly) with: git commit --no-verify`;

const flag = (args, name) => args.includes(name);
function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

export default async function guard(args = []) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'install') {
    const project = opt(rest, '--project') || process.cwd();
    const res = installPreCommitHook(project, { force: flag(rest, '--force') });
    if (!res.ok && res.reason === 'not-a-git-repo') {
      console.error(`raph: ${project} is not a git repository — run "git init" first.`);
      return 1;
    }
    if (!res.ok && res.reason === 'foreign-hook') {
      console.error(`raph: a different pre-commit hook already exists at ${res.hookPath}.`);
      console.error('      re-run with --force to replace it (back it up first).');
      return 1;
    }
    console.log(`raph: secret guard installed -> ${res.hookPath}`);
    console.log('      commits are now scanned for secrets. Bypass once with: git commit --no-verify');
    return 0;
  }

  if (sub === 'uninstall') {
    const project = opt(rest, '--project') || process.cwd();
    const res = uninstallPreCommitHook(project);
    if (!res.ok && res.reason === 'not-a-git-repo') {
      console.error(`raph: ${project} is not a git repository.`);
      return 1;
    }
    if (!res.ok && res.reason === 'foreign-hook') {
      console.error(`raph: the pre-commit hook at ${res.hookPath} was not installed by raphael — leaving it in place.`);
      return 1;
    }
    console.log(res.removed ? `raph: secret guard removed from ${res.hookPath}` : 'raph: no raphael guard was installed');
    return 0;
  }

  if (sub === 'scan') {
    const entropy = flag(rest, '--entropy');
    let results;

    // visibility: an allowlist changes what a security gate sees — say so
    const announceAllowlist = (top) => {
      const allow = loadAllowlist(top);
      if (allow.patterns.length) {
        console.error(`raph: allowlist active — ${ALLOWLIST_FILE} (${allow.patterns.length} pattern(s)) skips matching files`);
      }
      return allow;
    };

    if (flag(rest, '--staged')) {
      const cwd = process.cwd();
      if (!isGitRepo(cwd)) return 0; // nothing staged / not a repo -> clean
      announceAllowlist(gitTopLevel(cwd) || cwd);
      results = scanStaged(cwd, { entropy });
    } else if (flag(rest, '--all')) {
      const cwd = process.cwd();
      announceAllowlist(gitTopLevel(cwd) || cwd);
      results = scanTracked(cwd, { entropy }).results;
    } else {
      const paths = rest.filter((a) => !a.startsWith('--'));
      if (paths.length === 0) {
        console.error('raph: nothing to scan — pass --staged, --all, or one or more file paths');
        return 1;
      }
      results = paths
        .map((f) => ({ file: f, findings: scanFile(path.resolve(f), { entropy }) }))
        .filter((r) => r.findings.length);
    }

    if (!results || results.length === 0) return 0;

    console.error('raph: secrets detected — commit blocked (nothing was written to git history):');
    let count = 0;
    for (const { file, findings } of results) {
      for (const f of findings) {
        console.error(`  ${file}:${f.line}  ${f.type}`);
        count++;
      }
    }
    console.error(`\n  ${count} finding(s). Move the secret to an env var or a secrets manager and unstage it.`);
    console.error('  If this is a genuine false positive, bypass once with: git commit --no-verify');
    return 1;
  }

  console.log(HELP);
  return sub ? 1 : 0;
}
