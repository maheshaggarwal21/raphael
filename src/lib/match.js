// The deterministic matcher/scorer (ARCHITECTURE §4). No model, no fuzz:
//   3.0·stack_overlap + 4.0·trigger_hits + 2.0·path_match
//   + 1.0·recency/observations prior − 10.0·already_injected_this_session
// Every point comes with a human-readable reason string, so `raph why` and
// `raph search` can show exactly why a lesson fired. Severity breaks ties.

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const W_STACK = 3.0;
const W_KEYWORD = 4.0;
const W_PATH = 2.0;
const W_ALREADY = -10.0;
const HIT_CAP = 3; // keyword-stuffed lessons can't dominate the ranking

// Severity is part of the score, not just the tie-break. Sorting consulted
// severity only when two scores were equal, and `prior` gives +0.1 per
// observation — so a lesson mined once scored 1.60 while every curated
// critical security lesson capped at 1.50 (no mined observations, by
// definition) and lost every session by a tenth of a point. Measured on the
// real brain: "inline single-call-site abstractions" permanently
// outranked "check ownership to stop IDOR", "enforce authorization on the
// server", "hash passwords with a slow KDF" and "use parameterized queries".
// The severity ladder was decorative. These weights are deliberately smaller
// than one keyword hit (4.0): severity orders lessons of comparable relevance,
// it never drags an irrelevant lesson over a relevant one.
const W_SEVERITY = { critical: 0.75, high: 0.5, medium: 0.25, low: 0 };

// A relevance signal is a reason to show the lesson AT ALL: it applies to any
// stack, its stack matched, or its keywords/paths hit. `prior` is not one — it
// only says the lesson is well-attested. Severity amplifies relevance; it must
// never manufacture it, or a stack-scoped lesson in a project it does not apply
// to would ride its severity over the digest threshold.
const RELEVANCE_PREFIXES = ['any-stack', 'stack:', 'keyword:', 'path:'];

function hasRelevanceSignal(reasons) {
  return reasons.some((r) => RELEVANCE_PREFIXES.some((p) => r.startsWith(p)));
}

// Did anything in the QUERY (or prompt) actually match? `any-stack` and `stack:`
// come from the working directory, and `prior` only says a lesson is well
// attested — none of them mean the user's words hit anything. The per-prompt
// injection gate already required this; `raph search` did not, so a query the
// brain knows nothing about returned the highest-prior lessons numbered 1, 2,
// 3 like ranked answers. One definition, used by both.
export function hasQueryHit(reasons) {
  return (reasons ?? []).some((r) => r.startsWith('keyword:') || r.startsWith('path:'));
}

// Words that flip the meaning of a keyword occurrence a few words later.
// Deliberately short and conservative: a missed negation costs one spurious
// hit (the old behaviour), while an over-eager one silently hides a real lesson.
const NEGATORS = new Set([
  'no', 'not', 'never', 'without', 'avoid', 'avoids', 'avoiding', 'avoided',
  'exclude', 'excludes', 'excluding', 'excluded', 'zero', 'nor', 'neither',
  'dont', "don't", 'doesnt', "doesn't", 'isnt', "isn't", 'arent', "aren't"
]);
const NEGATION_WINDOW = 32; // characters of context to look back over
const NEGATION_LOOKBACK_WORDS = 4;

// Is the occurrence at `index` inside a negated phrase? A brief saying
// "Persistence is local files. No database." would otherwise have
// `text.includes('database')` score a database-hardening lesson highly — the
// matcher firing on the very sentence saying the thing does not exist.
export function isNegatedAt(text, index) {
  let before = String(text).slice(Math.max(0, index - NEGATION_WINDOW), index);
  // Negation does not cross a clause boundary. Without this, "never use eval;
  // eval is unsafe" reads the `never` from the FIRST clause and suppresses the
  // second, genuine mention — caught by the boundary test below.
  const lastBreak = Math.max(
    before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf(','),
    before.lastIndexOf(':'), before.lastIndexOf('!'), before.lastIndexOf('?'),
    before.lastIndexOf('\n')
  );
  if (lastBreak !== -1) before = before.slice(lastBreak + 1);
  const words = before.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.slice(-NEGATION_LOOKBACK_WORDS).some((w) => NEGATORS.has(w));
}

// How many times does `keyword` occur in `text` in a NON-negated position?
// One negated mention does not suppress a genuine one elsewhere in the text.
export function keywordHits(text, keyword) {
  const k = String(keyword ?? '').toLowerCase();
  if (!k) return 0;
  const hay = String(text ?? '');
  let i = 0;
  let hits = 0;
  for (;;) {
    const at = hay.indexOf(k, i);
    if (at === -1) return hits;
    if (!isNegatedAt(hay, at)) hits++;
    i = at + k.length;
  }
}

// Simple glob → regex for trigger paths: `*` = one segment, `?` = one char,
// `**` = anything, and a leading `**/` is optional so `**/webhook*/**` also
// matches `webhooks/x.js`.
const REGEX_META = '.+^${}()|[]';

export function globToRegex(pattern) {
  const norm = String(pattern).replace(/\\/g, '/');
  // ONE pass, no placeholder character. The chained-replace version needed a
  // sentinel to hold `**` between passes: a raw NUL was used, which made git
  // classify this file as BINARY (no diffs, no blame on the core scorer), and a
  // literal space before that, which silently over-matched any pattern holding a
  // real space. A single pass needs no sentinel, so neither bug can return.
  let out = '';
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === '*') {
      if (norm[i + 1] === '*') { out += '.*'; i++; } // `**` spans separators
      else out += '[^/]*';                          // `*` stays in one segment
    } else if (c === '?') {
      out += '[^/]';        // ONE character — not a regex quantifier
    } else if (REGEX_META.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  if (out.startsWith('.*/')) out = '(?:.*/)?' + out.slice(3);
  return new RegExp(`^${out}$`, 'i');
}

// Pull path-looking tokens out of free text (a prompt usually names the file
// being worked on). Deterministic and cheap; false negatives are fine.
export function extractPaths(text) {
  if (!text) return [];
  const hits = String(text).match(/[\w.-]+[/\\][\w./\\-]+/g) ?? [];
  return hits.map((h) => h.replace(/\\/g, '/').replace(/[.,;:]+$/, ''));
}

// Score one compiled-index entry against a retrieval context. Returns null
// when a hard scope filter excludes the lesson entirely.
// ctx: { text, stacks, paths, project, agent, injected:Set<id> }
export function scoreLesson(entry, ctx = {}) {
  // Agent scoping only applies when retrieval runs FOR a specific agent role
  // (§4): the plain session sees everything; a scoped agent sees its slice.
  const agents = entry.scope?.agents ?? [];
  if (ctx.agent && agents.length > 0 && !agents.includes(ctx.agent)) return null;

  // Project scoping is a narrowing, not a routing: a lesson pinned to certain
  // projects never leaks into others — unknown project counts as "other".
  const projects = entry.scope?.projects ?? [];
  if (projects.length > 0) {
    const here = String(ctx.project ?? '').toLowerCase();
    if (!here || !projects.some((pr) => String(pr).toLowerCase() === here)) return null;
  }

  const reasons = [];
  let score = 0;

  const stacks = entry.scope?.stacks ?? [];
  if (stacks.length === 0) {
    score += 1.0;
    reasons.push('any-stack+1.0');
  } else {
    const overlap = stacks.filter((s) => (ctx.stacks ?? []).includes(s));
    if (overlap.length > 0) {
      const pts = W_STACK * Math.min(overlap.length, HIT_CAP);
      score += pts;
      reasons.push(`stack:${overlap.slice(0, HIT_CAP).join(',')}+${pts.toFixed(1)}`);
    }
  }

  const text = String(ctx.text ?? '').toLowerCase();
  if (text) {
    // substring match on purpose: trigger keywords are stems ("idempoten"),
    // but a mention inside a negated phrase is not evidence the topic applies.
    const hits = (entry.triggers?.keywords ?? []).filter((k) =>
      keywordHits(text, k) > 0
    );
    if (hits.length > 0) {
      const pts = W_KEYWORD * Math.min(hits.length, HIT_CAP);
      score += pts;
      reasons.push(`keyword:${hits.slice(0, HIT_CAP).join(',')}+${pts.toFixed(1)}`);
    }
  }

  const ctxPaths = ctx.paths ?? [];
  if (ctxPaths.length > 0) {
    const patterns = entry.triggers?.paths ?? [];
    const matched = patterns.filter((pat) => {
      let re;
      try {
        re = globToRegex(pat);
      } catch {
        return false;
      }
      return ctxPaths.some((cp) => re.test(cp));
    });
    if (matched.length > 0) {
      const pts = W_PATH * Math.min(matched.length, HIT_CAP);
      score += pts;
      reasons.push(`path:${matched.slice(0, HIT_CAP).join(',')}+${pts.toFixed(1)}`);
    }
  }

  // Severity, but ONLY on top of a real relevance signal (see W_SEVERITY).
  // Without the gate, a lesson scoped to stacks this project does not use would
  // ride severity alone over the digest threshold and start appearing everywhere.
  if (hasRelevanceSignal(reasons)) {
    const sevPts = W_SEVERITY[entry.severity] ?? 0;
    if (sevPts > 0) {
      score += sevPts;
      reasons.push(`severity:${entry.severity}+${sevPts.toFixed(2)}`);
    }
  }

  // Prior, bounded to 1.0: half from how often it was observed, half from
  // whether it was seen in the last 90 days.
  const obs = entry.evidence?.observations ?? 0;
  let prior = 0.5 * Math.min(1, obs / 5);
  const lastSeen = entry.evidence?.last_seen;
  if (lastSeen) {
    const age = (Date.now() - Date.parse(lastSeen)) / 86400000;
    if (Number.isFinite(age) && age >= 0 && age <= 90) prior += 0.5;
  }
  if (prior > 0) {
    score += prior;
    reasons.push(`prior+${prior.toFixed(1)}`);
  }

  if (ctx.injected?.has(entry.id)) {
    score += W_ALREADY;
    reasons.push('already-injected-10.0');
  }

  return { score, reasons };
}

// Rank all entries against a context. Only results at/above `threshold`
// survive; sort is score desc, then severity, then slug (stable + explainable).
export function rank(entries, ctx = {}, threshold = 0) {
  const out = [];
  for (const entry of entries ?? []) {
    const s = scoreLesson(entry, ctx);
    if (!s) continue;
    if (s.score < threshold) continue;
    out.push({ entry, score: s.score, reasons: s.reasons });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sev =
      (SEVERITY_RANK[a.entry.severity] ?? 9) - (SEVERITY_RANK[b.entry.severity] ?? 9);
    if (sev !== 0) return sev;
    return String(a.entry.slug).localeCompare(String(b.entry.slug));
  });
  return out;
}
