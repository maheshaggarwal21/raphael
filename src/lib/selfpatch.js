// Self-patch gate (Phase 13b, ARCHITECTURE §11.11). Raphael may propose patches to
// its OWN code (from the driver, agent-maker follow-through, or a described fix), but
// §11.11 is absolute: NEVER auto-applied — a self-patch is always PRESENTED for a
// human to merge. This module is the deterministic gate a proposed patch must clear
// before it is even presented:
//   - the self-upgrade rule (branch + tests + eval green) — reused from selfupgrade.js;
//   - CHOKEPOINT FILES (the ONE brain write path + the secret scrubber + the schema)
//     are heavyweight: touching them needs an explicit acknowledgement;
//   - a near-verbatim port under a COPYLEFT license is blocked (same family gate as
//     adopt) — ideas may be learned, copyleft code may not be pasted in.
// Pure decision + a thin git-backed command. Zero model tokens. It refuses to
// green-light; it never merges.

import { evaluateSelfUpgrade } from './selfupgrade.js';

// The security-critical files. A change to any of these is the product's guarantee
// changing — it gets the heavyweight path, never a quiet edit.
export const CHOKEPOINT_FILES = [
  'src/lib/validate.js',        // the ONE validation chokepoint (invariant #1)
  'src/lib/scrub.js',           // the secret scrubber (invariant #2)
  'src/lib/frontmatter.js',     // lesson (de)serialization
  'src/schemas/lesson.schema.json'
];

export function chokepointTouched(changedFiles = []) {
  const norm = changedFiles.map((f) => String(f).replace(/\\/g, '/'));
  return CHOKEPOINT_FILES.filter((c) => norm.some((f) => f === c || f.endsWith('/' + c)));
}

// Decide whether a proposed self-patch is CLEAR TO PRESENT (never to merge). Inputs
// are plain facts so the policy is unit-testable without git or a model.
export function evaluateSelfPatch({
  branch,
  testsPassed,
  evalPassed,
  changedFiles = [],
  chokepointAck = false,
  licenseFamily = null
} = {}) {
  const gate = evaluateSelfUpgrade({ branch, testsPassed, evalPassed });
  const chokepointFiles = chokepointTouched(changedFiles);
  const copyleftBlocked = licenseFamily === 'copyleft' || licenseFamily === 'weak-copyleft';

  const blockers = [...gate.blockers];
  if (chokepointFiles.length && !chokepointAck) blockers.push('chokepoint-ack');
  if (copyleftBlocked) blockers.push('copyleft-port');

  return {
    ok: blockers.length === 0,   // clear to PRESENT
    present: true,               // §11.11: ALWAYS present, NEVER auto-apply
    gate,
    changedCount: changedFiles.length,
    chokepointFiles,
    heavyweight: chokepointFiles.length > 0,
    copyleftBlocked,
    blockers
  };
}

export function renderSelfPatch(rep) {
  const L = [];
  L.push('raph selfpatch — the self-patch gate (§11.11: propose, never auto-apply)');
  L.push('');
  L.push(`  changed files: ${rep.changedCount}`);
  for (const c of rep.gate.checks) L.push(`  [${c.ok ? 'x' : ' '}] ${c.name.padEnd(10)} ${c.detail}`);
  const heavy = rep.chokepointFiles.length
    ? `HEAVYWEIGHT — touches ${rep.chokepointFiles.join(', ')} (needs --confirm-chokepoint)`
    : 'no chokepoint files touched';
  L.push(`  [${rep.chokepointFiles.length === 0 || !rep.blockers.includes('chokepoint-ack') ? 'x' : ' '}] chokepoint ${heavy}`);
  L.push(`  [${rep.copyleftBlocked ? ' ' : 'x'}] license    ${rep.copyleftBlocked ? 'BLOCKED — copyleft near-verbatim port' : 'no copyleft port'}`);
  L.push('');
  if (rep.ok) {
    L.push('CLEAR TO PRESENT — show this patch to the human to merge. Raphael never merges its own patch.');
  } else {
    L.push(`BLOCKED — fix: ${rep.blockers.join(', ')}. A self-patch is presented only when the gate is green.`);
  }
  return L.join('\n');
}
