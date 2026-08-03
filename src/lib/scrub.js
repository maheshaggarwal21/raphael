import { ID_PREFIXES } from './ulid.js';

// Secret scrubber. Runs BEFORE any model ever sees mined text, and again on
// pipeline output. Replacements are typed placeholders, never partial masks.

// The named secret patterns. Exported (as SECRET_RULES) so the project secret
// guard (src/lib/guard.js) scans with the EXACT same rules the chokepoint uses —
// one source of truth for what counts as a secret.
const RULES = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['stripe-key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/gi],
  // A real bearer token virtually always carries a digit or a structural char;
  // a hyphenated English phrase never does. Without that requirement this rule
  // flagged ordinary security PROSE ("the Bearer authorization-header must be
  // validated") and E-SECRET then hard-rejected the lesson — in the security
  // category, which is the flagship pack.
  ['bearer', /\bBearer\s+(?=[A-Za-z0-9._~+/-]*[0-9._~+/=])[A-Za-z0-9._~+/-]{16,}=*/g],
  // Underscore-aware boundaries: `\b` treats `_` as a word char, so a `\b`-walled
  // keyword would MISS the archetypal env-var leak `DB_PASSWORD=...` /
  // `SESSION_SECRET=...` / `AUTH_TOKEN=...` (keyword fenced by underscores). The
  // lookarounds below exclude only alphanumerics, so `_` (and `=`, quotes, space)
  // count as boundaries — while `<` stays excluded on the left so this rule never
  // re-matches our own <SECRET:...> placeholders.
  // ...and the keyword may carry TRAILING joined segments before the separator.
  // Without that, the archetypal compound names escaped entirely — 'secret' in
  // DJANGO_SECRET_KEY= is followed by '_KEY', which failed the separator test, so
  // DJANGO_SECRET_KEY / SECRET_KEY_BASE / AWS_SECRET_ACCESS_KEY were all missed by
  // the named rule, and the entropy net only catches values with both digits
  // and letters, so a letters-only passphrase in one of them passed the whole
  // scrubber. A separator plus an 8+ char value is still required, so prose
  // like "a secret_key is needed" stays clean.
  ['kv-secret', /(?<![a-z0-9<])(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)(?:[_-][a-z0-9]+){0,3}(?![a-z0-9])\s*[:=]\s*(?:'[^'\n]{8,}'|"[^"\n]{8,}"|[^\s'"]{8,})/gi]
];

const ENTROPY_MIN_LEN = 20;
const ENTROPY_THRESHOLD = 4.0;

function shannon(s) {
  const freq = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  let e = 0;
  for (const k in freq) {
    const p = freq[k] / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

// Raphael's own ids are random base32 and would trip the entropy scan. Their
// charset (no lowercase, no I/L/O/U) cannot encode an arbitrary secret, so
// exempting them is safe. The prefix list is DERIVED from ulid.js — the single
// place ids are minted — because a hand-maintained copy here already drifted
// once (dec_ was missing, so decision ids were mangled as secrets).
const RAPHAEL_ID_RE = new RegExp(`^(?:${ID_PREFIXES.join('_|')}_)[0-9A-HJKMNP-TV-Z]{26}$`);

// A source location — a stack frame, a module specifier, a file path with a
// line number. These read as high-entropy (mixed case, digits, punctuation,
// varied charset) but are diagnostics, never credentials.
//
// Exempting them matters because error text is scrubbed before it reaches an
// escalation message or a retry prompt. Redacting the stack destroys precisely
// the evidence a human needs to act on the escalation, and the evidence the
// retrying stage needs to repair — turning "here is where it broke" into a
// column of <SECRET:high-entropy>.
//
// Safety: this narrows only the ENTROPY HEURISTIC. The named rules (AWS keys,
// bearer tokens, private keys, connection strings...) run first and are
// untouched, so a real credential that happens to sit inside a path is still
// caught by its own rule.
const SOURCE_LOCATION_RE = new RegExp([
  '^node:',                                   // node:internal/modules/cjs/loader:1145:15
  '^file://',                                 // file:///C:/Users/x/app.js:42:11
  ':\\d+:\\d+$',                              // ...loader:1145:15  (line:col)
  '\\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|py|go|rs|java|rb|php):\\d+$' // app.js:42
].join('|'));

// True when a single token looks like a high-entropy secret. Shared by the
// scrubber (below) and the guard's opt-in --entropy pass, so both agree.
export function isHighEntropyToken(tok) {
  if (tok.length < ENTROPY_MIN_LEN) return false;
  if (tok.includes('<SECRET:')) return false;
  const bare = tok.replace(/^[[('"]+|[\])>,'"]+$/g, '');
  if (RAPHAEL_ID_RE.test(bare)) return false;
  if (SOURCE_LOCATION_RE.test(bare)) return false;
  // require a mixed charset so long ordinary words never trip the scan
  if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) return false;
  if (shannon(tok) < ENTROPY_THRESHOLD) return false;
  return true;
}

function scrubEntropy(text, found) {
  return text.replace(/[^\s"'`]+/g, (tok) => {
    if (!isHighEntropyToken(tok)) return tok;
    found.push('high-entropy');
    return '<SECRET:high-entropy>';
  });
}

export function scrubSecrets(text) {
  const found = [];
  let out = text;
  for (const [type, re] of RULES) {
    out = out.replace(re, () => {
      found.push(type);
      return `<SECRET:${type}>`;
    });
  }
  out = scrubEntropy(out, found);
  return { text: out, found };
}

// The named rules, exposed for the project secret guard. Kept read-only in
// spirit: consumers build fresh RegExps from these so shared lastIndex state
// never leaks between scans.
export const SECRET_RULES = RULES;
