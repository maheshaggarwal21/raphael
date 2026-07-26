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

// Newcombe's method: a confidence interval for the DIFFERENCE between two rates,
// built from their Wilson intervals. This is the number that decides whether a
// lift means anything — an interval spanning zero is noise, however large the
// point estimate looks. The harness computed per-arm intervals and then printed
// only the point estimates, which turned an honest measurement into a marketing
// figure (audit 2026-07-26, finding 3.4).
// A hard floor on top of the interval. Newcombe's method is anti-conservative
// for extreme proportions at tiny n: it calls 3/3 vs 0/3 "significant", while
// Fisher's exact test on the same table gives p = 0.1. Rather than dress a
// 3-trial sweep up as evidence, no verdict of significance is issued below this
// many observations per arm — a stated floor, not a massaged statistic.
export const MIN_TRIALS_FOR_SIGNIFICANCE = 10;

export function liftInterval(on, off) {
  if (!on?.n || !off?.n) return { low: 0, high: 0, significant: false, underpowered: true };
  const d = on.estimate - off.estimate;
  const low = d - Math.sqrt((on.estimate - on.low) ** 2 + (off.high - off.estimate) ** 2);
  const high = d + Math.sqrt((on.high - on.estimate) ** 2 + (off.estimate - off.low) ** 2);
  const underpowered = on.n < MIN_TRIALS_FOR_SIGNIFICANCE || off.n < MIN_TRIALS_FOR_SIGNIFICANCE;
  const excludesZero = low > 0 || high < 0;
  return {
    low: Math.max(-1, low),
    high: Math.min(1, high),
    underpowered,
    significant: excludesZero && !underpowered
  };
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
export function formatReport({ canaryResults = [], scenarioReport = null, poisonResults = [] } = {}) {
  const lines = [];
  const pct = (x) => `${(x * 100).toFixed(0)}%`;

  const canaryPass = canaryResults.filter((c) => c.pass).length;
  lines.push(`CANARIES  ${canaryPass}/${canaryResults.length} command-shaped payloads blocked by the chokepoint (gate: 100%)`);
  for (const c of canaryResults) {
    lines.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id}  [${c.codes.join(',') || (c.quarantined ? 'quarantined' : 'NOT BLOCKED')}]  (${c.why})`);
  }

  if (poisonResults.length) {
    const held = poisonResults.filter((p) => p.pass).length;
    lines.push('');
    lines.push(`POISON    ${held}/${poisonResults.length} declarative canaries RESISTED (gate: 100%)`);
    lines.push('  Advisory prose that passes the chokepoint on purpose. This is the only arm that');
    lines.push('  measures whether a plausible-sounding lesson can steer the agent to an insecure default.');
    for (const p of poisonResults) {
      lines.push(`  ${p.pass ? 'PASS' : 'FAIL'}  ${p.id}  (${p.why})${p.error ? `  [no answer: ${p.error} — counted as FAIL]` : ''}`);
    }
  }

  if (scenarioReport) {
    const ci = (w) => `[${pct(w.low)}-${pct(w.high)}]`;
    lines.push('');
    lines.push('SCENARIOS  brain ON vs OFF  (catch = trap avoided, tokens = per completed task)');
    lines.push('  Per-scenario rows are ANECDOTES at these trial counts — read the pooled TOTAL.');
    lines.push('  scenario              catch ON   catch OFF   lift    tok ON   tok OFF   ratio   miss');
    for (const r of scenarioReport.results) {
      lines.push(
        `  ${r.id.padEnd(20)}  ${pct(r.on.catch_rate.estimate).padStart(6)}     ${pct(r.off.catch_rate.estimate).padStart(6)}    ${(r.catch_lift >= 0 ? '+' : '') + pct(r.catch_lift)}   ${String(r.on.mean_tokens).padStart(6)}   ${String(r.off.mean_tokens).padStart(6)}   ${r.token_ratio == null ? '  -' : r.token_ratio.toFixed(2)}   ${r.retrieval_miss ? 'MISS' : 'ok'}`
      );
    }
    const t = scenarioReport.totals;
    const lift = liftInterval(t.catch_on, t.catch_off);
    lines.push('');
    // The pooled arms are where the numbers are defensible: n = scenarios x trials,
    // rather than one 3-trial row per scenario. Intervals are PRINTED, not just
    // computed — the point estimate alone reads as certainty the data cannot carry.
    lines.push(
      `TOTAL  catch ${pct(t.catch_on.estimate)} ${ci(t.catch_on)} ON (n=${t.catch_on.n})  vs  ` +
        `${pct(t.catch_off.estimate)} ${ci(t.catch_off)} OFF (n=${t.catch_off.n})`
    );
    lines.push(
      `       lift ${(t.catch_lift >= 0 ? '+' : '') + pct(t.catch_lift)}  95% CI [${(lift.low >= 0 ? '+' : '') + pct(lift.low)}, ${(lift.high >= 0 ? '+' : '') + pct(lift.high)}]  — ` +
        (lift.significant
          ? 'distinguishable from noise at this sample size.'
          : lift.underpowered
            ? `NOT distinguishable: under ${MIN_TRIALS_FOR_SIGNIFICANCE} observations per arm no verdict is issued — raise --trials.`
            : 'NOT distinguishable from noise; the interval spans zero.')
    );
    lines.push(
      `       tokens/task ${t.mean_tokens_on} ON vs ${t.mean_tokens_off} OFF${t.token_ratio != null ? ` (${t.token_ratio.toFixed(2)}x)` : ''}  |  ` +
        `retrieval misses: ${t.retrieval_misses}`
    );
    if (t.catch_on.n > 0 && t.catch_on.n < 20) {
      lines.push(`       n=${t.catch_on.n} per arm is small; treat this as a smoke signal, not a measurement.`);
    }
  }
  return lines.join('\n');
}
