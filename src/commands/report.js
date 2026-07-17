// `raph report` — company reports (Phase 14). Thin printer over lib/report.js;
// the console's Company tab calls the same functions.

import { readWeekly, renderWeekly, DEFAULT_DAYS } from '../lib/report.js';

export default async function report(args = []) {
  const sub = args[0];
  if (sub && sub !== 'weekly') {
    console.error('raph: usage: raph report weekly [--days N] [--json]');
    return 1;
  }

  const dIdx = args.indexOf('--days');
  let days = DEFAULT_DAYS;
  if (dIdx >= 0) {
    days = Number(args[dIdx + 1]);
    if (!Number.isInteger(days) || days < 1) {
      console.error('raph: --days must be a positive integer');
      return 1;
    }
  }

  const r = readWeekly({ days });
  if (args.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  console.log(renderWeekly(r));
  return 0;
}
