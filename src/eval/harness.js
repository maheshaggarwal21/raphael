// The eval harness (ARCHITECTURE §7). Pure orchestration: it is handed a
// `runAgent` adapter (real = headless claude -p in a fixture; fake = canned
// verdicts in tests) and an `injectFn` (the real recall engine). It never spawns
// anything itself, so the whole lift-table/statistics/guard logic is unit-tested
// for free.
//
// Two headline numbers per §7:
//   catch rate  — did the agent avoid the planted trap (brain ON vs OFF)
//   tokens/task — total session tokens per completed task (ON vs OFF). "Better
//                 results for fewer tokens" is only real if this ratio says so.
// Plus retrieval MISS — a matching lesson existed but never injected — the metric
// that catches the system failing silently.

// Wilson score interval for a binomial proportion (small-N honest CIs).
export function wilson(successes, n, z = 1.96) {
  if (n <= 0) return { estimate: 0, low: 0, high: 0, n: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { estimate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin), n };
}

// Comparisons are REFUSED across model IDs — a model update must never masquerade
// as a brain improvement (§7).
export function assertSameModel(a, b) {
  if (a && b && a !== b) {
    throw new Error(`E-EVAL-MODEL: refusing to compare arms across models (${a} vs ${b}) — a model change is not a brain change`);
  }
}

function summarizeArm(trials) {
  const n = trials.length;
  const caught = trials.filter((t) => t.caught).length;
  const complete = trials.filter((t) => t.task_complete).length;
  // tokens/task counts only completed trials (a task that didn't finish has no
  // meaningful per-task cost); fall back to all trials if none completed.
  const completedTrials = trials.filter((t) => t.task_complete);
  const tokedTrials = completedTrials.length ? completedTrials : trials;
  const meanTokens = tokedTrials.length
    ? Math.round(tokedTrials.reduce((s, t) => s + (t.tokens || 0), 0) / tokedTrials.length)
    : 0;
  const model = trials.find((t) => t.model)?.model ?? null;
  return {
    n,
    caught,
    complete,
    catch_rate: wilson(caught, n),
    complete_rate: wilson(complete, n),
    mean_tokens: meanTokens,
    model
  };
}

// Evaluate ONE scenario: run K trials of the brain-ON arm and the brain-OFF arm.
// runAgent({ scenario, arm, model, injectedText, trial }) -> { caught, task_complete, tokens, model }
// injectFn(prompt) -> { text, lessonSlugs } (what the real recall engine would inject)
export async function evalScenario(scenario, { runAgent, injectFn, trials = 3, model, offCache } = {}) {
  const injected = injectFn ? injectFn(scenario.prompt) : { text: '', lessonSlugs: [] };
  const firedSlugs = injected.lessonSlugs ?? [];
  // Retrieval MISS: the lesson that should defend this scenario is in the brain
  // (the ON arm seeded it) but did not fire on the scenario prompt.
  const retrieval_miss = Boolean(scenario.lesson) && !firedSlugs.includes(scenario.lesson.slug);

  const onTrials = [];
  for (let i = 0; i < trials; i++) {
    onTrials.push(await runAgent({ scenario, arm: 'on', model, injectedText: injected.text ?? '', trial: i }));
  }

  // OFF arm is independent of the brain, so it can be cached by (model, scenario).
  const cacheKey = `${model ?? 'default'}::${scenario.id}`;
  let offTrials;
  if (offCache && offCache.has(cacheKey)) {
    offTrials = offCache.get(cacheKey);
  } else {
    offTrials = [];
    for (let i = 0; i < trials; i++) {
      offTrials.push(await runAgent({ scenario, arm: 'off', model, injectedText: '', trial: i }));
    }
    if (offCache) offCache.set(cacheKey, offTrials);
  }

  const on = summarizeArm(onTrials);
  const off = summarizeArm(offTrials);
  assertSameModel(on.model, off.model);

  return {
    id: scenario.id,
    title: scenario.title,
    trap: scenario.trap,
    on,
    off,
    catch_lift: on.catch_rate.estimate - off.catch_rate.estimate,
    token_ratio: off.mean_tokens > 0 ? on.mean_tokens / off.mean_tokens : null,
    retrieval_miss,
    injected_tokens: injected.text ? Math.ceil(String(injected.text).length / 4) : 0
  };
}

export async function evalScenarios(scenarios, opts = {}) {
  const offCache = opts.offCache ?? new Map();
  const results = [];
  for (const s of scenarios) {
    results.push(await evalScenario(s, { ...opts, offCache }));
  }
  return { results, totals: aggregate(results) };
}

export function aggregate(results) {
  const nOn = results.reduce((s, r) => s + r.on.n, 0);
  const caughtOn = results.reduce((s, r) => s + r.on.caught, 0);
  const nOff = results.reduce((s, r) => s + r.off.n, 0);
  const caughtOff = results.reduce((s, r) => s + r.off.caught, 0);
  const tokOn = results.reduce((s, r) => s + r.on.mean_tokens, 0);
  const tokOff = results.reduce((s, r) => s + r.off.mean_tokens, 0);
  return {
    scenarios: results.length,
    catch_on: wilson(caughtOn, nOn),
    catch_off: wilson(caughtOff, nOff),
    catch_lift: (nOn ? caughtOn / nOn : 0) - (nOff ? caughtOff / nOff : 0),
    mean_tokens_on: results.length ? Math.round(tokOn / results.length) : 0,
    mean_tokens_off: results.length ? Math.round(tokOff / results.length) : 0,
    token_ratio: tokOff > 0 ? tokOn / tokOff : null,
    retrieval_misses: results.filter((r) => r.retrieval_miss).length
  };
}

// Render a plain-text lift table for `raph eval run`.
export function formatReport({ canaryResults = [], scenarioReport = null } = {}) {
  const lines = [];
  const pct = (x) => `${(x * 100).toFixed(0)}%`;

  const canaryPass = canaryResults.filter((c) => c.pass).length;
  lines.push(`CANARIES  ${canaryPass}/${canaryResults.length} command-shaped payloads blocked by the chokepoint (gate: 100%)`);
  for (const c of canaryResults) {
    lines.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id}  [${c.codes.join(',') || (c.quarantined ? 'quarantined' : 'NOT BLOCKED')}]  (${c.why})`);
  }

  if (scenarioReport) {
    lines.push('');
    lines.push('SCENARIOS  brain ON vs OFF  (catch = trap avoided, tokens = per completed task)');
    lines.push('  scenario              catch ON   catch OFF   lift    tok ON   tok OFF   ratio   miss');
    for (const r of scenarioReport.results) {
      lines.push(
        `  ${r.id.padEnd(20)}  ${pct(r.on.catch_rate.estimate).padStart(6)}     ${pct(r.off.catch_rate.estimate).padStart(6)}    ${(r.catch_lift >= 0 ? '+' : '') + pct(r.catch_lift)}   ${String(r.on.mean_tokens).padStart(6)}   ${String(r.off.mean_tokens).padStart(6)}   ${r.token_ratio == null ? '  -' : r.token_ratio.toFixed(2)}   ${r.retrieval_miss ? 'MISS' : 'ok'}`
      );
    }
    const t = scenarioReport.totals;
    lines.push('');
    lines.push(
      `TOTAL  catch ${pct(t.catch_on.estimate)} ON vs ${pct(t.catch_off.estimate)} OFF (lift ${(t.catch_lift >= 0 ? '+' : '') + pct(t.catch_lift)})  |  ` +
        `tokens/task ${t.mean_tokens_on} ON vs ${t.mean_tokens_off} OFF${t.token_ratio != null ? ` (${t.token_ratio.toFixed(2)}x)` : ''}  |  ` +
        `retrieval misses: ${t.retrieval_misses}`
    );
  }
  return lines.join('\n');
}
