// `raph policy [<kind>] [--escalated] [--json]` — the model policy table (Phase 14).
// Thin printer over lib/policy.js; the autopilot driver resolves the same table.

import { POLICY, resolvePolicy, renderPolicy } from '../lib/policy.js';

export default async function policy(args = []) {
  const json = args.includes('--json');
  const escalated = args.includes('--escalated');
  const kind = args.find((a) => !a.startsWith('--'));

  if (kind) {
    let resolved;
    try {
      resolved = resolvePolicy(kind, { escalated });
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    if (json) {
      console.log(JSON.stringify(resolved, null, 2));
    } else {
      const model = resolved.model ?? '(cli default)';
      console.log(`${resolved.kind}: model=${model} effort=${resolved.effort}${resolved.escalated ? ' (escalated)' : ''}`);
      console.log(`  ${resolved.why}`);
    }
    return 0;
  }

  if (escalated) {
    console.error('E-POLICY: --escalated needs a task kind (raph policy <kind> --escalated)');
    return 1;
  }

  if (json) {
    console.log(JSON.stringify(POLICY, null, 2));
    return 0;
  }
  console.log(renderPolicy());
  return 0;
}
