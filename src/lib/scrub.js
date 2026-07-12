// Secret scrubber. Runs BEFORE any model ever sees mined text, and again on
// pipeline output. Replacements are typed placeholders, never partial masks.

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
  // (?<!<) keeps this rule from re-matching our own <SECRET:...> placeholders
  ['kv-secret', /(?<!<)\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)\b\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi]
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
const RAPHAEL_ID_RE = /^(?:les_|ev_|prj_|mch_)[0-9A-HJKMNP-TV-Z]{26}$/;

function scrubEntropy(text, found) {
  return text.replace(/[^\s"'`]+/g, (tok) => {
    if (tok.length < ENTROPY_MIN_LEN) return tok;
    if (tok.includes('<SECRET:')) return tok;
    const bare = tok.replace(/^[[('"]+|[\])>,'"]+$/g, '');
    if (RAPHAEL_ID_RE.test(bare)) return tok;
    // require a mixed charset so long ordinary words never trip the scan
    if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) return tok;
    if (shannon(tok) < ENTROPY_THRESHOLD) return tok;
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
