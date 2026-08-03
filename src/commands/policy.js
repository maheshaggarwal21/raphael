// `raph policy [<kind>] [--escalated] [--json]` — the model policy table.
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
      const clock = Number.isFinite(resolved.timeoutMs)
        ? ` timeout=${Math.round(resolved.timeoutMs / 60000)}m`
        : ' timeout=default';
      console.log(`${resolved.kind}: model=${model} effort=${resolved.effort}${clock}${resolved.escalated ? ' (escalated)' : ''}`);
      // The tool grant is the thing worth being able to audit: a driver stage
      // may never exceed the tool set its roster agent was reviewed with.
      console.log(`  tools: ${resolved.tools.length ? resolved.tools.join(', ') : '(none — every built-in tool off)'}${resolved.agent ? ` (from the ${resolved.agent} agent)` : ''}`);
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
