// Self-upgrade rule (Phase 14 meta layer, docs/company-vision.md + ARCHITECTURE
// §14.self-patches). Raphael may draft changes to its OWN code/agents (agent-maker,
// skills factory, 13b patches), but "no measurement, no mutation": such a change
// only merges after branch + tests + eval. This is the deterministic GATE that
// checks the rule held. The pure evaluator takes the three facts and decides; the
// command gathers them (git branch, npm test, eval canaries). Human still merges —
// the gate refuses to green-light, it does not push. Zero model tokens.

export const DEFAULT_BRANCHES = new Set(['main', 'master']);

// Decide whether a self-upgrade is clear to merge. Inputs are plain facts so the
// policy is unit-testable without running anything.
export function evaluateSelfUpgrade({ branch, testsPassed, evalPassed } = {}) {
  const onFeatureBranch = !!branch && !DEFAULT_BRANCHES.has(branch);
  const checks = [
    {
      name: 'branch',
      ok: onFeatureBranch,
      detail: !branch
        ? 'could not determine the git branch'
        : onFeatureBranch
          ? `on feature branch "${branch}"`
          : `on the default branch "${branch}" — a self-change must live on its own branch`
    },
    {
      name: 'tests',
      ok: testsPassed === true,
      detail: testsPassed === true ? 'npm test is green' : testsPassed === false ? 'npm test FAILED' : 'npm test was not run'
    },
    {
      name: 'eval',
      ok: evalPassed === true,
      detail: evalPassed === true ? 'eval canaries are green' : evalPassed === false ? 'eval canaries FAILED' : 'eval was not run'
    }
  ];
  const blockers = checks.filter((c) => !c.ok).map((c) => c.name);
  return { ok: blockers.length === 0, checks, blockers };
}

export function renderSelfUpgrade(rep) {
  const L = [];
  L.push('raph selfcheck — the self-upgrade gate (branch + tests + eval before merge)');
  L.push('');
  for (const c of rep.checks) L.push(`  [${c.ok ? 'x' : ' '}] ${c.name.padEnd(6)} ${c.detail}`);
  L.push('');
  if (rep.ok) {
    L.push('PASS — this self-change met the rule. A human still does the merge.');
  } else {
    L.push(`BLOCKED — fix: ${rep.blockers.join(', ')}. No measurement, no mutation: do not merge a self-change until all three are green.`);
  }
  return L.join('\n');
}
