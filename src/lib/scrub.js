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
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g],
  // Underscore-aware boundaries: `\b` treats `_` as a word char, so a `\b`-walled
  // keyword would MISS the archetypal env-var leak `DB_PASSWORD=...` /
  // `SESSION_SECRET=...` / `AUTH_TOKEN=...` (keyword fenced by underscores). The
  // lookarounds below exclude only alphanumerics, so `_` (and `=`, quotes, space)
  // count as boundaries — while `<` stays excluded on the left so this rule never
  // re-matches our own <SECRET:...> placeholders.
  ['kv-secret', /(?<![a-z0-9<])(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)(?![a-z0-9])\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi]
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
// exempting them is safe.
const RAPHAEL_ID_RE = /^(?:les_|ev_|prj_|mch_|adp_)[0-9A-HJKMNP-TV-Z]{26}$/;

// True when a single token looks like a high-entropy secret. Shared by the
// scrubber (below) and the guard's opt-in --entropy pass, so both agree.
export function isHighEntropyToken(tok) {
  if (tok.length < ENTROPY_MIN_LEN) return false;
  if (tok.includes('<SECRET:')) return false;
  const bare = tok.replace(/^[[('"]+|[\])>,'"]+$/g, '');
  if (RAPHAEL_ID_RE.test(bare)) return false;
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
