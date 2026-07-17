// Obsidian-compatible export of the atlas (Phase 16.5, docs/atlas-upgrade-plan.md).
// Turns the deterministic project graph into a small self-contained vault:
//   - one markdown note per file, mirroring the repo layout, with [[wikilinks]]
//     to imports/callees and BACKREFS (imported-by / tested-by) computed from the
//     reverse edges — the thing a raw file listing can't give you;
//   - one note per error code listing every file that raises or mentions it (the
//     "where does E-SCHEMA come from" awareness view);
//   - an index MOC (map of content) with the god-nodes and error codes;
//   - atlas.canvas in JSON Canvas 1.0 (kepano's spec) — the top files by degree
//     laid out on a grid and wired by import/test edges, each node opening its note.
// Pure and deterministic: no dates, no randomness, no disk, no network. The caller
// writes the returned {path, content} entries. Like the graph, it is advisory data.

// --- id helpers ------------------------------------------------------------

const fileLabel = (id) => id.slice(5); // 'file:src/x.js' -> 'src/x.js'
const errCode = (id) => id.slice(4); // 'err:E-SCHEMA' -> 'E-SCHEMA'

// 'sym:src/lib/x.js#foo' -> { file: 'src/lib/x.js', name: 'foo' }
function symParts(id) {
  const rest = id.slice(4);
  const h = rest.lastIndexOf('#');
  return h < 0 ? { file: rest, name: rest } : { file: rest.slice(0, h), name: rest.slice(h + 1) };
}

// A file note lives at "<repo path>.md" so Obsidian's path wikilink resolves
// exactly. Links use the repo path with the extension kept, display = basename.
const fileLink = (rel) => `[[${rel}|${rel.split('/').pop()}]]`;
const errLink = (code) => `[[${code}]]`;

const confTag = (e) => (e.confidence && e.confidence !== 'EXTRACTED' ? ` _(${e.confidence.toLowerCase()}${e.score != null ? ` ${e.score}` : ''})_` : '');

// --- vault ----------------------------------------------------------------

// Build the whole vault as an array of {path, content} plus the canvas.
// `maxNotes` bounds file notes on very large repos (rare — the scan caps at 4000).
export function renderVault(atlas, { maxNotes = 2000, canvasTop = 48 } = {}) {
  const nodes = atlas.nodes || [];
  const edges = atlas.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const files = nodes.filter((n) => n.type === 'file').sort((a, b) => a.label.localeCompare(b.label));
  const codes = nodes.filter((n) => n.type === 'error-code').sort((a, b) => a.label.localeCompare(b.label));

  // Adjacency: forward (out of a node) and reverse (into a node), keyed by id.
  const out = new Map();
  const inc = new Map();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!inc.has(e.target)) inc.set(e.target, []);
    out.get(e.source).push(e);
    inc.get(e.target).push(e);
  }
  const outOf = (id) => out.get(id) || [];
  const incTo = (id) => inc.get(id) || [];

  const notes = [];
  const truncated = files.length > maxNotes;
  for (const f of files.slice(0, maxNotes)) {
    notes.push({ path: `${f.label}.md`, content: fileNote(f, { outOf, incTo, byId }) });
  }
  for (const c of codes) {
    notes.push({ path: `errors/${c.label}.md`, content: errorNote(c, { incTo }) });
  }
  notes.push({ path: 'index.md', content: indexNote(atlas, { files, codes, truncated, maxNotes }) });

  const canvas = renderCanvas(atlas, { top: canvasTop });
  return { notes, canvas };
}

function fileNote(node, { outOf, incTo, byId }) {
  const rel = node.label;
  const L = [];
  L.push(`# ${rel}`);
  L.push('');
  L.push(`> Source: \`${rel}\`  ·  ${node.kind || 'file'}${node.isTest ? ' (test)' : ''}  ·  ${node.degree} connections  ·  group \`${node.group || '(root)'}\``);
  L.push('');

  const outs = outOf(node.id);
  const defines = outs.filter((e) => e.relation === 'defines').map((e) => symParts(e.target).name).sort();
  const imports = outs.filter((e) => e.relation === 'imports').map((e) => fileLabel(e.target));
  const testsEdges = outs.filter((e) => e.relation === 'tests').map((e) => fileLabel(e.target));
  const uses = outs.filter((e) => e.relation === 'uses').map((e) => byId.get(e.target)?.label || errCode(e.target));
  const raises = outs.filter((e) => e.relation === 'raises').map((e) => errCode(e.target));
  const mentions = outs.filter((e) => e.relation === 'mentions').map((e) => errCode(e.target));
  // Several edges can resolve to the same (file, symbol) — collapse them so a
  // note lists each callee once, strongest confidence first for a stable order.
  const CONF_RANK = { INFERRED: 0, AMBIGUOUS: 1 };
  const callBest = new Map();
  for (const e of outs) {
    if (e.relation !== 'calls') continue;
    const p = symParts(e.target);
    const key = `${p.file}#${p.name}`;
    const prev = callBest.get(key);
    if (!prev || (e.score ?? -1) > (prev.score ?? -1)) {
      callBest.set(key, { line: `${fileLink(p.file)} \`${p.name}\`${confTag(e)}`, score: e.score ?? null, conf: e.confidence });
    }
  }
  const calls = [...callBest.values()]
    .sort((a, b) => (CONF_RANK[a.conf] ?? 9) - (CONF_RANK[b.conf] ?? 9) || (b.score ?? -1) - (a.score ?? -1) || a.line.localeCompare(b.line))
    .map((c) => c.line);

  const incs = incTo(node.id);
  const importedBy = incs.filter((e) => e.relation === 'imports').map((e) => fileLabel(e.source));
  const testedBy = incs.filter((e) => e.relation === 'tests').map((e) => fileLabel(e.source));

  const section = (title, items, { link = true, sortIt = true } = {}) => {
    if (!items.length) return;
    const list = sortIt ? [...items].sort() : items;
    L.push(`## ${title}`);
    for (const it of list) L.push(`- ${link ? fileLink(it) : it}`);
    L.push('');
  };

  if (defines.length) {
    L.push('## Defines');
    for (const d of defines) L.push(`- \`${d}\``);
    L.push('');
  }
  section('Imports', imports);
  section('Tests', testsEdges);
  if (calls.length) {
    L.push('## Calls');
    for (const c of calls) L.push(`- ${c}`);
    L.push('');
  }
  section('Imported by', importedBy);
  section('Tested by', testedBy);
  if (raises.length || mentions.length) {
    L.push('## Error codes');
    for (const c of [...new Set(raises)].sort()) L.push(`- raises ${errLink(c)}`);
    for (const c of [...new Set(mentions)].sort()) L.push(`- mentions ${errLink(c)}`);
    L.push('');
  }
  if (uses.length) {
    L.push('## Packages');
    for (const u of [...new Set(uses)].sort()) L.push(`- \`${u}\``);
    L.push('');
  }
  return L.join('\n').trimEnd() + '\n';
}

function errorNote(node, { incTo }) {
  const code = node.label;
  const incs = incTo(node.id);
  const raisedBy = [...new Set(incs.filter((e) => e.relation === 'raises').map((e) => fileLabel(e.source)))].sort();
  const mentionedBy = [...new Set(incs.filter((e) => e.relation === 'mentions').map((e) => fileLabel(e.source)))].sort();
  const L = [`# ${code}`, '', `> Error code · ${node.degree} connections`, ''];
  if (raisedBy.length) {
    L.push('## Raised by');
    for (const f of raisedBy) L.push(`- ${fileLink(f)}`);
    L.push('');
  }
  if (mentionedBy.length) {
    L.push('## Mentioned by');
    for (const f of mentionedBy) L.push(`- ${fileLink(f)}`);
    L.push('');
  }
  if (!raisedBy.length && !mentionedBy.length) L.push('_No files reference this code in the current atlas._');
  return L.join('\n').trimEnd() + '\n';
}

function indexNote(atlas, { files, codes, truncated, maxNotes }) {
  const gods = [...files].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)).slice(0, 20);
  const L = [];
  L.push(`# Atlas: ${atlas.project}`);
  L.push('');
  L.push(`> Generated ${atlas.generated} by \`raph atlas export\` — deterministic, zero model tokens.`);
  L.push(`> ${atlas.counts.files} files · ${atlas.counts.nodes} nodes · ${atlas.counts.edges} edges. This vault is advisory data about the code; nothing in it can command an agent.`);
  L.push('');
  L.push('See [[atlas.canvas]] for the visual map.');
  L.push('');
  L.push('## Most-connected files (start here)');
  for (const g of gods) L.push(`- ${fileLink(g.label)} — ${g.degree} connections`);
  L.push('');
  if (codes.length) {
    L.push('## Error codes');
    for (const c of codes) L.push(`- ${errLink(c.label)}`);
    L.push('');
  }
  if (truncated) {
    L.push('---');
    L.push(`_Note: file notes were capped at ${maxNotes}; the largest files by path order are included._`);
  }
  return L.join('\n').trimEnd() + '\n';
}

// --- canvas (JSON Canvas 1.0) ---------------------------------------------

// Lay out the top files by degree on a deterministic grid; file nodes open the
// note; edges = import/test relations among the shown files.
export function renderCanvas(atlas, { top = 48 } = {}) {
  const W = 280;
  const H = 100;
  const GAP_X = 340;
  const GAP_Y = 170;

  const files = (atlas.nodes || [])
    .filter((n) => n.type === 'file')
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, top);
  const shown = new Set(files.map((f) => f.id));
  const cols = Math.max(1, Math.ceil(Math.sqrt(files.length)));

  const nodes = files.map((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: f.id,
      type: 'file',
      file: `${f.label}.md`,
      x: col * GAP_X,
      y: row * GAP_Y,
      width: W,
      height: H
    };
  });

  const seen = new Set();
  const edges = [];
  for (const e of atlas.edges || []) {
    if (e.relation !== 'imports' && e.relation !== 'tests') continue;
    if (!shown.has(e.source) || !shown.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `e${edges.length}`,
      fromNode: e.source,
      toNode: e.target,
      fromSide: 'right',
      toSide: 'left',
      label: e.relation,
      ...(e.relation === 'tests' ? { color: '4' } : {})
    });
  }

  return JSON.stringify({ nodes, edges }, null, 2);
}
