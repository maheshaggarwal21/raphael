// `raph portfolio` — the company's project table (Phase 14). Thin printer over
// lib/portfolio.js; the console's Company tab calls the same functions.

import { readPortfolio, renderPortfolio } from '../lib/portfolio.js';

export default async function portfolio(args = []) {
  const pf = readPortfolio();
  if (args.includes('--json')) {
    console.log(JSON.stringify(pf, null, 2));
    return 0;
  }
  console.log(renderPortfolio(pf));
  return 0;
}
