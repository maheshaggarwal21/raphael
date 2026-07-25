// Trigram Jaccard similarity — the v1 dedupe engine. Deterministic, explainable,
// dependency-free; embeddings are a documented later upgrade, not a v1 need.

export function trigrams(text) {
  const norm = String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const set = new Set();
  if (norm.length < 3) {
    if (norm) set.add(norm);
    return set;
  }
  for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
  return set;
}

export function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const t of small) if (big.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

export function similarity(textA, textB) {
  return jaccard(trigrams(textA), trigrams(textB));
}

// --- near-duplicate shortlisting (the approve-time gate) ----------------------
//
// WHY A SECOND SIGNAL: trigram Jaccard measures WORDING, so two lessons stating the
// same rule in different words score low. Measured on a real pair that slipped
// through and had to be retired by hand ("treat an engines.node floor as a minimum"
// vs "open floor version constraint treated as hard EOL pin"): trigram = 0.295,
// far under the 0.6 dedupe threshold. Content-word overlap scored that same pair at
// 0.164, while the highest overlap between two genuinely-distinct lessons in the
// same brain was 0.127.
//
// That margin (0.164 vs 0.127) is REAL BUT NARROW, so this is deliberately NOT a
// classifier. It is a recall-tuned SHORTLIST: it surfaces "these two might be the
// same rule" for a human (or a reviewing model) to judge in a few seconds. Tuned to
// prefer a rare unnecessary prompt over a silently duplicated lesson, because a
// duplicate permanently costs injection budget on every future session.

// Function words carry no topic signal, so they'd inflate every pair's overlap.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'as', 'at', 'by', 'for',
  'from', 'in', 'into', 'of', 'on', 'to', 'with', 'not', 'no', 'does', 'do', 'did', 'can',
  'may', 'must', 'should', 'will', 'would', 'when', 'where', 'which', 'who', 'whom', 'what',
  'how', 'why', 'all', 'any', 'each', 'other', 'some', 'such', 'only', 'own', 'same', 'so',
  'too', 'very', 'just', 'now', 'because', 'while', 'after', 'before', 'both', 'more', 'most',
  'you', 'your', 'they', 'their', 'them', 'there', 'here', 'has', 'have', 'had', 'about'
]);

// The significant words of a lesson: lowercased, punctuation-stripped, stopword-free,
// and >2 chars. Keeps digits and dots so "18", "4.5" and "engines.node" survive.
export function contentWords(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().replace(/[^a-z0-9\s.-]+/g, ' ').split(/\s+/)) {
    const t = w.replace(/^[.-]+|[.-]+$/g, '');
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

export function wordOverlap(textA, textB) {
  return jaccard(contentWords(textA), contentWords(textB));
}

// Shortlist thresholds. Either signal alone is enough to ask the question.
export const DUP_WORD_THRESHOLD = 0.12;    // semantic-ish: same topic words, different phrasing
export const DUP_TRIGRAM_THRESHOLD = 0.45; // wording-similar but under the 0.6 hard-dedupe

// Rank a candidate text against a corpus of { slug, text, ...meta } entries.
// Returns the entries that clear either threshold, worst-offender first, each
// annotated with both scores and which signal fired — so the caller can explain
// itself instead of just asserting "duplicate".
export function nearDuplicates(text, corpus, {
  wordThreshold = DUP_WORD_THRESHOLD,
  trigramThreshold = DUP_TRIGRAM_THRESHOLD,
  limit = 3
} = {}) {
  const grams = trigrams(text);
  const wordsA = contentWords(text);
  const hits = [];
  for (const entry of corpus || []) {
    const tri = jaccard(grams, trigrams(entry.text));
    const word = jaccard(wordsA, contentWords(entry.text));
    if (word < wordThreshold && tri < trigramThreshold) continue;
    hits.push({
      ...entry,
      word: Number(word.toFixed(3)),
      trigram: Number(tri.toFixed(3)),
      signal: tri >= trigramThreshold ? 'wording' : 'topic-words',
      score: Math.max(word, tri)
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
