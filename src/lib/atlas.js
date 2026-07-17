// Project atlas (Phase 16, docs/atlas-upgrade-plan.md) — a knowledge graph of a
// project built DETERMINISTICALLY: files, exported symbols, imports, call sites,
// tests, and error codes, extracted with a pure scan. Zero model tokens to build,
// zero to query. This is the engine behind both faces of the awareness feature:
// the owner asks `raph atlas where "<error>"` to learn where to look; agents get
// the same answer injected instead of re-exploring the repo.
//
// Design ported from the graphify research (2026-07): every edge carries a
// confidence tag — EXTRACTED (explicit in source), INFERRED (derived, with a
// discrete score rubric), AMBIGUOUS (uncertain, surfaced for review, never
// silently trusted). Degree = importance ("god nodes"). SHA256 per-file cache
// makes rebuilds incremental. The graph is advisory data about a project; like
// lessons, nothing in it may command an agent.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Bump whenever extraction semantics change — a cached extraction from an older
// extractor is stale even if the file content is identical.
export const ATLAS_VERSION = 2;

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out',
  '.venv', '__pycache__', 'vendor', '.raphael', 'graphify-out'
]);

// Files we extract structure from vs files we only scan for mentions.
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.jsx', '.tsx', '.py']);
const DOC_EXTS = new Set(['.md', '.markdown', '.txt']);

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 512 * 1024;

// Identifiers too generic to resolve as call edges — matching them would produce
// noise, and a noisy edge is worse than a missing one.
const COMMON_NAMES = new Set([
  'main', 'test', 'run', 'get', 'set', 'init', 'start', 'stop', 'help', 'error',
  'data', 'value', 'name', 'file', 'path', 'read', 'write', 'load', 'save',
  'render', 'parse', 'format', 'check', 'update', 'create', 'push', 'log'
]);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Walk the project and return relative paths of files worth scanning, bounded.
export function collectFiles(root, { maxFiles = MAX_FILES } = {}) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (out.length >= maxFiles || depth > 8) return;
    for (const entry of safeReaddir(dir)) {
      if (out.length >= maxFiles) return;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(full, relPath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTS.has(ext) || DOC_EXTS.has(ext)) out.push(relPath);
      }
    }
  };
  walk(root, '', 0);
  return out.sort();
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

// Extract one file's structure. Pure: (relPath, content) -> extraction dict.
// Never throws on weird content; extraction is best-effort and bounded.
export function extractFile(relPath, content) {
  const ext = path.extname(relPath).toLowerCase();
  const ex = {
    hash: sha256(content),
    kind: CODE_EXTS.has(ext) ? 'code' : 'doc',
    exports: [], // {name, line}
    imports: [], // {spec, line}
    callCandidates: [], // identifiers used as calls: name(
    errorCodes: [], // {code, line, raises: bool}
    isTest: /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\.[a-z]+$/.test(relPath)
  };
  if (ex.kind === 'code') {
    // Exports: ES modules, CommonJS, and Python defs at top level.
    const exportRes = [
      /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      /export\s+const\s+([A-Za-z_$][\w$]*)/g,
      /module\.exports\.([A-Za-z_$][\w$]*)\s*=/g,
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm,
      /^class\s+([A-Za-z_]\w*)/gm
    ];
    for (const re of exportRes) {
      let m;
      while ((m = re.exec(content)) !== null) {
        ex.exports.push({ name: m[1], line: lineOf(content, m.index) });
      }
    }
    // Imports: import-from, require, dynamic import, python import.
    const importRes = [
      /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\(\s*['"]([^'"]+)['"]\s*\)/g,
      /^from\s+([\w.]+)\s+import\s/gm,
      /^import\s+([\w.]+)\s*$/gm
    ];
    const seenImports = new Set();
    for (const re of importRes) {
      let m;
      while ((m = re.exec(content)) !== null) {
        if (!seenImports.has(m[1])) {
          seenImports.add(m[1]);
          ex.imports.push({ spec: m[1], line: lineOf(content, m.index) });
        }
      }
    }
    // Call candidates: identifiers used as name( — deduped, generic names dropped.
    const seenCalls = new Set();
    let cm;
    const callRe = /\b([A-Za-z_$][\w$]{3,})\s*\(/g;
    while ((cm = callRe.exec(content)) !== null) {
      const name = cm[1];
      if (COMMON_NAMES.has(name.toLowerCase()) || seenCalls.has(name)) continue;
      seenCalls.add(name);
      ex.callCandidates.push(name);
    }
  }
  // Error codes (raphael convention E-NAME) in code AND docs. In a code file, a
  // code inside a string literal is an ORIGIN site (that is where the error text
  // comes from — throw lines, errors.push({code: ...}), console.error), whether
  // or not `throw` shares the line. Bare occurrences (comments) and docs are
  // mentions.
  const codeRe = /\bE-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/g;
  const seenCodes = new Set();
  let em;
  while ((em = codeRe.exec(content)) !== null) {
    const code = em[0];
    const lineStart = content.lastIndexOf('\n', em.index) + 1;
    const lineEnd = content.indexOf('\n', em.index);
    const lineText = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    const col = em.index - lineStart;
    const inString = /['"`]/.test(lineText.slice(0, col));
    const throwLike = /\b(throw|raise|Error\()/i.test(lineText);
    const raises = ex.kind === 'code' && (inString || throwLike);
    const key = `${code}:${raises}`;
    if (seenCodes.has(key)) continue;
    seenCodes.add(key);
    ex.errorCodes.push({ code, line: lineOf(content, em.index), raises });
  }
  return ex;
}

// Resolve a JS-style relative import spec to a known project file, or null.
function resolveImport(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null; // bare specifier = external package
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const candidates = [
    base,
    `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.py`,
    `${base}/index.js`, `${base}/index.ts`
  ];
  for (const c of candidates) if (fileSet.has(c)) return c;
  return null;
}

// The INFERRED confidence rubric (ported from graphify's discrete scale).
const CONF = { certain: 0.95, strong: 0.85, reasonable: 0.75, weak: 0.65 };

// Build the graph from per-file extractions: {relPath: extraction}.
export function buildAtlas(extractions, { project = 'project', generated = '(undated)' } = {}) {
  const files = Object.keys(extractions).sort();
  const fileSet = new Set(files);
  const nodes = new Map(); // id -> node
  const edges = [];

  const addNode = (id, node) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...node });
    return nodes.get(id);
  };
  const addEdge = (source, target, relation, confidence, score) => {
    edges.push({ source, target, relation, confidence, ...(score != null ? { score } : {}) });
  };

  // Symbol name -> exporting files (for call resolution and ambiguity detection).
  const exporters = new Map();
  for (const f of files) {
    for (const e of extractions[f].exports) {
      if (!exporters.has(e.name)) exporters.set(e.name, []);
      exporters.get(e.name).push(f);
    }
  }

  for (const f of files) {
    const ex = extractions[f];
    addNode(`file:${f}`, { type: 'file', label: f, kind: ex.kind, isTest: ex.isTest });

    for (const e of ex.exports) {
      const id = `sym:${f}#${e.name}`;
      addNode(id, { type: 'symbol', label: e.name, source: `${f}:${e.line}` });
      addEdge(`file:${f}`, id, 'defines', 'EXTRACTED');
    }

    for (const imp of ex.imports) {
      const resolved = resolveImport(f, imp.spec, fileSet);
      if (resolved) {
        addEdge(`file:${f}`, `file:${resolved}`, ex.isTest ? 'tests' : 'imports', 'EXTRACTED');
      } else if (!imp.spec.startsWith('.')) {
        const pkg = imp.spec.split('/')[0].startsWith('@')
          ? imp.spec.split('/').slice(0, 2).join('/')
          : imp.spec.split('/')[0];
        addNode(`pkg:${pkg}`, { type: 'package', label: pkg });
        addEdge(`file:${f}`, `pkg:${pkg}`, 'uses', 'EXTRACTED');
      }
    }

    for (const ec of ex.errorCodes) {
      addNode(`err:${ec.code}`, { type: 'error-code', label: ec.code });
      addEdge(`file:${f}`, `err:${ec.code}`, ec.raises ? 'raises' : 'mentions', 'EXTRACTED');
    }
  }

  // Call edges, resolved against exported names. Confidence by evidence:
  // import exists + unique exporter = certain; import exists + several = strong
  // (edge to the imported one); no import + unique exporter = weak INFERRED;
  // no import + several exporters = AMBIGUOUS (one edge per exporter, flagged).
  for (const f of files) {
    const ex = extractions[f];
    if (ex.kind !== 'code') continue;
    const importedFiles = new Set(
      ex.imports.map((i) => resolveImport(f, i.spec, fileSet)).filter(Boolean)
    );
    for (const name of ex.callCandidates) {
      const exps = (exporters.get(name) || []).filter((t) => t !== f);
      if (!exps.length) continue;
      const importedExps = exps.filter((t) => importedFiles.has(t));
      if (importedExps.length === 1) {
        addEdge(`file:${f}`, `sym:${importedExps[0]}#${name}`, 'calls', 'INFERRED', CONF.certain);
      } else if (importedExps.length > 1) {
        for (const t of importedExps) addEdge(`file:${f}`, `sym:${t}#${name}`, 'calls', 'INFERRED', CONF.strong);
      } else if (exps.length === 1) {
        addEdge(`file:${f}`, `sym:${exps[0]}#${name}`, 'calls', 'INFERRED', CONF.weak);
      } else {
        for (const t of exps) addEdge(`file:${f}`, `sym:${t}#${name}`, 'calls', 'AMBIGUOUS');
      }
    }
  }

  // Degree (importance) and groups (top-level directory — simple and honest).
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  for (const n of nodes.values()) {
    n.degree = degree.get(n.id) || 0;
    if (n.type === 'file') n.group = n.label.includes('/') ? n.label.split('/')[0] : '(root)';
  }

  return {
    version: ATLAS_VERSION,
    project,
    generated,
    counts: { files: files.length, nodes: nodes.size, edges: edges.length },
    nodes: [...nodes.values()],
    edges
  };
}

// Scan a project directory into extractions, reusing a previous atlas's cached
// per-file extractions when the content hash is unchanged. Returns
// {extractions, reused, extracted} so callers can report incrementality.
export function scanProject(root, { previous = null, maxFiles } = {}) {
  // A cache written by a different extractor version is unusable — same bytes,
  // different meaning. (Found live: a --refresh after an extractor fix happily
  // reused every stale extraction.)
  const usable = previous && previous.version === ATLAS_VERSION;
  const prevFiles = usable ? previous.fileExtractions || {} : {};
  const extractions = {};
  let reused = 0;
  let extracted = 0;
  for (const rel of collectFiles(root, { maxFiles })) {
    let content;
    try {
      const full = path.join(root, rel);
      content = readFileSync(full, 'utf8');
    } catch {
      continue; // unreadable = skipped, never fatal
    }
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) continue;
    const hash = sha256(content);
    if (prevFiles[rel]?.hash === hash) {
      extractions[rel] = prevFiles[rel];
      reused++;
    } else {
      extractions[rel] = extractFile(rel, content);
      extracted++;
    }
  }
  return { extractions, reused, extracted };
}

// --- Queries (the 16.2 error router) -------------------------------------

const nodeById = (atlas) => new Map(atlas.nodes.map((n) => [n.id, n]));

function neighborIndex(atlas) {
  const idx = new Map();
  const push = (a, b, e, dir) => {
    if (!idx.has(a)) idx.set(a, []);
    idx.get(a).push({ id: b, edge: e, dir });
  };
  for (const e of atlas.edges) {
    push(e.source, e.target, e, 'out');
    push(e.target, e.source, e, 'in');
  }
  return idx;
}

// Owning file of any node (files own themselves, symbols/errors map back).
function owningFiles(atlas, nid, nbr) {
  if (nid.startsWith('file:')) return [nid];
  return (nbr.get(nid) || [])
    .filter((n) => n.id.startsWith('file:') && (n.edge.relation === 'defines' || n.edge.relation === 'raises'))
    .map((n) => n.id);
}

// Tokenize a question / error text into things we can match against the graph.
export function queryTokens(text) {
  const codes = [...String(text).matchAll(/\bE-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/g)].map((m) => m[0]);
  const paths = [...String(text).matchAll(/[\w./-]+\.(?:js|mjs|cjs|ts|tsx|py|md)\b/g)].map((m) => m[0]);
  const idents = [...String(text).matchAll(/\b[A-Za-z_$][\w$]{3,}\b/g)]
    .map((m) => m[0])
    .filter((w) => !COMMON_NAMES.has(w.toLowerCase()) && !/^E-/.test(w));
  return { codes: [...new Set(codes)], paths: [...new Set(paths)], idents: [...new Set(idents)].slice(0, 24) };
}

// "Where do I look for this?" — rank files with explainable reasons.
export function whereQuery(atlas, text, { limit = 8 } = {}) {
  const tokens = queryTokens(text);
  const nbr = neighborIndex(atlas);
  const byId = nodeById(atlas);
  const scores = new Map(); // file id -> {score, reasons: []}
  // Test files and docs rank below source: a fixture that fakes an error code
  // is not where the bug lives. The penalty is at query time — the graph itself
  // stays true to what the files contain.
  const weight = (fileId) => {
    const n = byId.get(fileId);
    if (!n) return 1;
    if (n.isTest) return 0.4;
    if (n.kind === 'doc') return 0.6;
    return 1;
  };
  const bump = (fileId, points, reason) => {
    if (!scores.has(fileId)) scores.set(fileId, { score: 0, reasons: [] });
    const s = scores.get(fileId);
    s.score += points * weight(fileId);
    if (s.reasons.length < 6 && !s.reasons.includes(reason)) s.reasons.push(reason);
  };

  for (const code of tokens.codes) {
    for (const n of nbr.get(`err:${code}`) || []) {
      if (!n.id.startsWith('file:')) continue;
      if (n.edge.relation === 'raises') {
        bump(n.id, 5, byId.get(n.id)?.isTest ? `raises ${code} (test fixture)` : `error text origin: ${code}`);
      } else if (n.edge.relation === 'mentions') bump(n.id, 1, `mentions ${code}`);
    }
  }
  for (const p2 of tokens.paths) {
    for (const node of atlas.nodes) {
      if (node.type === 'file' && (node.label === p2 || node.label.endsWith(`/${p2}`) || node.label.endsWith(p2))) {
        bump(node.id, 3, 'named in the question');
      }
    }
  }
  for (const ident of tokens.idents) {
    for (const node of atlas.nodes) {
      if (node.type === 'symbol' && node.label === ident) {
        for (const f of owningFiles(atlas, node.id, nbr)) bump(f, 4, `defines ${ident}()`);
      }
      if (node.type === 'file' && path.basename(node.label).replace(/\.[a-z]+$/, '') === ident) {
        bump(node.id, 2, `file name matches "${ident}"`);
      }
    }
  }

  // One-hop expansion from the strongest seeds: callers/importers of a hit are
  // the second place to look. Expansion never outranks a direct hit.
  const seeds = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 4);
  for (const [fileId, s] of seeds) {
    if (s.score < 3) continue;
    for (const n of nbr.get(fileId) || []) {
      if (!n.id.startsWith('file:') || scores.has(n.id)) continue;
      if (n.dir === 'in' && (n.edge.relation === 'imports' || n.edge.relation === 'tests')) {
        bump(n.id, 1, `${n.edge.relation === 'tests' ? 'tests' : 'imports'} ${fileId.slice(5)}`);
      }
    }
    // Symbols this file defines that are called elsewhere (walk file->sym->caller).
    for (const n of nbr.get(fileId) || []) {
      if (!n.id.startsWith('sym:') || n.edge.relation !== 'defines') continue;
      for (const c of nbr.get(n.id) || []) {
        if (c.edge.relation === 'calls' && c.id.startsWith('file:') && !scores.has(c.id)) {
          bump(c.id, 1, `calls ${n.id.split('#')[1]}() (defined in ${fileId.slice(5)})`);
        }
      }
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, s]) => ({
      file: id.slice(5),
      score: s.score,
      degree: byId.get(id)?.degree ?? 0,
      reasons: s.reasons
    }));
}

// Resolve a fuzzy term (symbol name, file basename, error code) to a node id.
export function resolveNode(atlas, term) {
  const t = String(term).trim();
  const exact = atlas.nodes.find((n) => n.id === t || n.label === t);
  if (exact) return exact;
  const lower = t.toLowerCase();
  return (
    atlas.nodes.find((n) => n.type === 'error-code' && n.label.toLowerCase() === lower) ||
    atlas.nodes.find((n) => n.type === 'symbol' && n.label.toLowerCase() === lower) ||
    atlas.nodes.find((n) => n.type === 'file' && path.basename(n.label).toLowerCase() === lower) ||
    atlas.nodes.find((n) => n.type === 'file' && n.label.toLowerCase().includes(lower)) ||
    null
  );
}

// Shortest connection between two things (BFS, undirected).
export function pathQuery(atlas, fromTerm, toTerm) {
  const a = resolveNode(atlas, fromTerm);
  const b = resolveNode(atlas, toTerm);
  if (!a || !b) return { error: `E-ATLAS: could not resolve "${!a ? fromTerm : toTerm}" to a node` };
  const nbr = neighborIndex(atlas);
  const prev = new Map([[a.id, null]]);
  const queue = [a.id];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === b.id) break;
    // Package nodes are hubs everything touches (node:fs, js-yaml) — a path
    // through one says nothing. They may be endpoints, never waypoints.
    if (cur.startsWith('pkg:') && cur !== a.id) continue;
    for (const n of nbr.get(cur) || []) {
      if (prev.has(n.id)) continue;
      prev.set(n.id, { from: cur, edge: n.edge });
      queue.push(n.id);
    }
  }
  if (!prev.has(b.id)) return { from: a.id, to: b.id, hops: null };
  const steps = [];
  let cur = b.id;
  while (cur !== a.id) {
    const p2 = prev.get(cur);
    steps.unshift({ from: p2.from, relation: p2.edge.relation, confidence: p2.edge.confidence, to: cur });
    cur = p2.from;
  }
  return { from: a.id, to: b.id, hops: steps.length, steps };
}

// One node and its neighborhood, grouped by relation.
export function explainQuery(atlas, term) {
  const node = resolveNode(atlas, term);
  if (!node) return { error: `E-ATLAS: could not resolve "${term}" to a node` };
  const nbr = neighborIndex(atlas);
  const relations = {};
  for (const n of nbr.get(node.id) || []) {
    const key = n.dir === 'out' ? n.edge.relation : `${n.edge.relation} (incoming)`;
    if (!relations[key]) relations[key] = [];
    if (relations[key].length < 12) relations[key].push({ id: n.id, confidence: n.edge.confidence });
  }
  return { node, relations };
}

// --- Bench (16.4): honest tokens-to-answer, graph vs grep-and-read -----------

const tokenEst = (s) => Math.ceil(String(s).length / 4);

// Auto-generate the bench questions from the graph itself: the error codes (the
// awareness use case — "where does this come from?") first, then top symbols.
export function benchQuestions(atlas, { max = 10 } = {}) {
  const codes = atlas.nodes.filter((n) => n.type === 'error-code').map((n) => n.label);
  const syms = atlas.nodes
    .filter((n) => n.type === 'symbol')
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, max)
    .map((n) => `where is ${n.label} defined?`);
  const out = [];
  for (const c of codes) { out.push(c); if (out.length >= max) return out; }
  for (const s of syms) { out.push(s); if (out.length >= max) return out; }
  return out;
}

// For each question: graph answer = the ranked where() result the agent reads;
// baseline = reading the candidate files whole (a CONSERVATIVE grep-and-read —
// it counts only the files the graph already surfaced, so the ratio is honest,
// never inflated). `tokensForFile(relPath)` is injected so this stays pure.
export function benchAtlas(atlas, { questions, tokensForFile }) {
  const rows = (questions || []).map((q) => {
    const hits = whereQuery(atlas, q, { limit: 8 });
    const answer = hits.length
      ? hits.map((h) => `${h.file}  (score ${h.score})  ${h.reasons.join('; ')}`).join('\n')
      : '(no atlas hit — the agent would fall back to a raw search)';
    const graphTokens = Math.max(1, tokenEst(answer));
    let rawTokens = 0;
    const files = [];
    for (const h of hits) {
      const t = Number(tokensForFile(h.file)) || 0;
      rawTokens += t;
      files.push({ file: h.file, tokens: t });
    }
    return {
      question: q,
      hits: hits.length,
      graphTokens,
      rawTokens,
      saved: Math.max(0, rawTokens - graphTokens),
      ratio: rawTokens > 0 ? Number((rawTokens / graphTokens).toFixed(1)) : null,
      files
    };
  });
  const totGraph = rows.reduce((a, r) => a + r.graphTokens, 0);
  const totRaw = rows.reduce((a, r) => a + r.rawTokens, 0);
  const rated = rows.filter((r) => r.ratio != null);
  return {
    questions: rows,
    totals: {
      count: rows.length,
      answered: rated.length,
      graphTokens: totGraph,
      rawTokens: totRaw,
      saved: Math.max(0, totRaw - totGraph),
      ratio: totGraph > 0 && totRaw > 0 ? Number((totRaw / totGraph).toFixed(1)) : null
    }
  };
}

export function renderBench(bench) {
  const t = bench.totals;
  const lines = [
    `Atlas token bench — ${t.count} question(s), ${t.answered} with a graph answer`,
    '',
    'question                                          graph   grep+read   ratio',
    '------------------------------------------------  ------  ----------  ------'
  ];
  for (const r of bench.questions) {
    const q = (r.question.length > 48 ? r.question.slice(0, 45) + '...' : r.question).padEnd(48);
    const g = String(r.graphTokens).padStart(6);
    const raw = String(r.rawTokens).padStart(10);
    const ratio = (r.ratio != null ? `${r.ratio}x` : '—').padStart(6);
    lines.push(`${q}  ${g}  ${raw}  ${ratio}`);
  }
  lines.push('');
  lines.push(
    t.ratio != null
      ? `TOTAL: ${t.rawTokens} grep+read tokens vs ${t.graphTokens} graph tokens = ${t.ratio}x fewer, ${t.saved} saved`
      : `TOTAL: ${t.graphTokens} graph tokens (no readable candidate files to compare against)`
  );
  lines.push('');
  lines.push('Honest caveat: the baseline reads ONLY the files the graph already');
  lines.push('surfaced, whole — a conservative grep-and-read. On a tiny repo or a');
  lines.push('one-small-file answer the ratio nears 1; the graph wins most on large');
  lines.push('files and many candidates. Zero model tokens were spent to measure this.');
  return lines.join('\n');
}

// --- Rendering -------------------------------------------------------------

export function renderAtlas(atlas) {
  const lines = [];
  lines.push(`# Atlas: ${atlas.project}`);
  lines.push(
    `_generated ${atlas.generated} by \`raph atlas\` (deterministic, zero tokens) · ` +
      `${atlas.counts.files} files · ${atlas.counts.nodes} nodes · ${atlas.counts.edges} edges_`
  );
  lines.push('');

  const gods = atlas.nodes
    .filter((n) => n.type === 'file')
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);
  lines.push('## Know these files first (most connected)');
  lines.push(gods.length ? gods.map((n) => `- ${n.label} (${n.degree} connections)`).join('\n') : '- (none)');
  lines.push('');

  const errs = atlas.nodes.filter((n) => n.type === 'error-code').sort((a, b) => a.label.localeCompare(b.label));
  lines.push('## Error codes -> where to look');
  if (errs.length) {
    const raisers = new Map();
    for (const e of atlas.edges) {
      if (e.relation === 'raises') {
        if (!raisers.has(e.target)) raisers.set(e.target, []);
        raisers.get(e.target).push(e.source.slice(5));
      }
    }
    for (const err of errs) {
      const from = raisers.get(err.id) || [];
      lines.push(`- ${err.label}: ${from.length ? from.join(', ') : '(mentioned only — no raise site found)'}`);
    }
  } else {
    lines.push('- (no E-style error codes found)');
  }
  lines.push('');

  const groups = new Map();
  for (const n of atlas.nodes) {
    if (n.type !== 'file') continue;
    groups.set(n.group, (groups.get(n.group) || 0) + 1);
  }
  lines.push('## Groups');
  lines.push([...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => `- ${g} (${c} files)`).join('\n') || '- (none)');
  lines.push('');

  const ambiguous = atlas.edges.filter((e) => e.confidence === 'AMBIGUOUS').slice(0, 20);
  lines.push('## Ambiguous connections (uncertain — verify before trusting)');
  lines.push(
    ambiguous.length
      ? ambiguous.map((e) => `- ${e.source.replace(/^file:/, '')} -${e.relation}-> ${e.target.replace(/^sym:/, '')}`).join('\n')
      : '- (none)'
  );
  lines.push('');
  return lines.join('\n');
}

// Compact digest for injection (16.3): a few lines, never more.
export function renderDigest(atlas, { maxLines = 8 } = {}) {
  const gods = atlas.nodes
    .filter((n) => n.type === 'file')
    .sort((a, b) => b.degree - a.degree)
    .slice(0, Math.max(1, maxLines - 2));
  const lines = [`Project atlas (${atlas.counts.files} files): most-connected files —`];
  for (const g of gods) lines.push(`  ${g.label} (${g.degree})`);
  lines.push('Ask `raph atlas where "<error or question>"` before wide searches.');
  return lines.join('\n');
}
