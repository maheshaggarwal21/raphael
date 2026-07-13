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
