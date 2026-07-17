// `raph atlas` — build and query the deterministic project knowledge graph
// (Phase 16, docs/atlas-upgrade-plan.md). Zero model tokens in every path.
//
//   raph atlas [--project <path>] [--refresh] [--json]     build/refresh + summary
//   raph atlas where "<error|question>" [--json]           where do I look?
//   raph atlas path <a> <b>                                 how are two things connected?
//   raph atlas explain <term>                               one node + its neighbors
//   raph atlas digest                                       the compact injection digest

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  scanProject,
  buildAtlas,
  renderAtlas,
  renderDigest,
  whereQuery,
  pathQuery,
  explainQuery
} from '../lib/atlas.js';
import { mapFileName } from '../lib/map.js';
import { atomicWrite } from '../lib/files.js';
import { p } from '../lib/paths.js';

function projectDirFrom(args) {
  const i = args.indexOf('--project');
  return path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : process.cwd());
}

function atlasPaths(projectDir) {
  const name = mapFileName(path.basename(projectDir));
  return {
    json: path.join(p.atlas(), `${name}.json`),
    md: path.join(p.atlas(), `${name}.md`)
  };
}

function loadAtlas(projectDir) {
  const { json } = atlasPaths(projectDir);
  if (!existsSync(json)) return null;
  try {
    return JSON.parse(readFileSync(json, 'utf8'));
  } catch {
    return null; // corrupt cache = rebuild
  }
}

function buildAndSave(projectDir, { previous = null } = {}) {
  const { extractions, reused, extracted } = scanProject(projectDir, { previous });
  const today = new Date().toISOString().slice(0, 10);
  const atlas = buildAtlas(extractions, {
    project: path.basename(projectDir),
    generated: today
  });
  const doc = { ...atlas, fileExtractions: extractions };
  const { json, md } = atlasPaths(projectDir);
  mkdirSync(p.atlas(), { recursive: true });
  atomicWrite(json, JSON.stringify(doc));
  atomicWrite(md, renderAtlas(atlas));
  return { atlas: doc, reused, extracted, json, md };
}

// Load the atlas, building it on demand (it costs nothing but a scan).
function ensureAtlas(projectDir, { refresh = false } = {}) {
  const previous = loadAtlas(projectDir);
  if (previous && !refresh) return { atlas: previous, built: false };
  const out = buildAndSave(projectDir, { previous });
  return { ...out, built: true };
}

export default async function atlas(args) {
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;
  const rest = sub ? args.slice(1) : args;
  const projectDir = projectDirFrom(rest);
  const asJson = rest.includes('--json');

  if (!existsSync(projectDir)) {
    console.error(`raph: E-ATLAS: no such directory: ${projectDir}`);
    return 1;
  }

  if (!sub) {
    const refresh = rest.includes('--refresh');
    const existing = loadAtlas(projectDir);
    if (existing && !refresh) {
      console.log(`raph: atlas exists for "${existing.project}" (${existing.counts.files} files, ${existing.counts.nodes} nodes, ${existing.counts.edges} edges) — use --refresh to rebuild`);
      return 0;
    }
    const out = buildAndSave(projectDir, { previous: existing });
    if (asJson) {
      const { fileExtractions, ...pub } = out.atlas;
      console.log(JSON.stringify({ ...pub, reused: out.reused, extracted: out.extracted }, null, 2));
      return 0;
    }
    console.log(`raph: atlas built for "${out.atlas.project}" — ${out.atlas.counts.files} files, ${out.atlas.counts.nodes} nodes, ${out.atlas.counts.edges} edges (${out.extracted} extracted, ${out.reused} reused from cache, 0 tokens)`);
    console.log(`raph: report -> ${out.md}`);
    return 0;
  }

  if (sub === 'where') {
    const text = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--project').join(' ').trim();
    if (!text) {
      console.error('raph: usage: raph atlas where "<error text | stack trace | question>"');
      return 1;
    }
    const { atlas: doc } = ensureAtlas(projectDir);
    const hits = whereQuery(doc, text);
    if (asJson) {
      console.log(JSON.stringify({ query: text, hits }, null, 2));
      return 0;
    }
    if (!hits.length) {
      console.log('raph: no matches in the atlas — try naming an error code, a function, or a file');
      return 0;
    }
    console.log(`raph: where to look for: ${text}`);
    for (const [i, h] of hits.entries()) {
      console.log(`  ${i + 1}. ${h.file}  (score ${h.score}, ${h.degree} connections)`);
      for (const r of h.reasons) console.log(`       - ${r}`);
    }
    return 0;
  }

  if (sub === 'path') {
    const terms = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--project');
    if (terms.length < 2) {
      console.error('raph: usage: raph atlas path <from> <to>');
      return 1;
    }
    const { atlas: doc } = ensureAtlas(projectDir);
    const out = pathQuery(doc, terms[0], terms[1]);
    if (out.error) {
      console.error(`raph: ${out.error}`);
      return 1;
    }
    if (asJson) {
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    if (out.hops === null) {
      console.log(`raph: no connection found between ${out.from} and ${out.to}`);
      return 0;
    }
    console.log(`raph: ${out.from} -> ${out.to} (${out.hops} hop${out.hops === 1 ? '' : 's'})`);
    for (const s of out.steps) console.log(`  ${s.from} --${s.relation}${s.confidence !== 'EXTRACTED' ? ` [${s.confidence}]` : ''}--> ${s.to}`);
    return 0;
  }

  if (sub === 'explain') {
    const term = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--project');
    if (!term) {
      console.error('raph: usage: raph atlas explain <symbol | file | error-code>');
      return 1;
    }
    const { atlas: doc } = ensureAtlas(projectDir);
    const out = explainQuery(doc, term);
    if (out.error) {
      console.error(`raph: ${out.error}`);
      return 1;
    }
    if (asJson) {
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    const n = out.node;
    console.log(`raph: ${n.id} (${n.type}${n.source ? `, ${n.source}` : ''}, ${n.degree} connections)`);
    for (const [rel, list] of Object.entries(out.relations)) {
      console.log(`  ${rel}:`);
      for (const item of list) console.log(`    - ${item.id}${item.confidence !== 'EXTRACTED' ? ` [${item.confidence}]` : ''}`);
    }
    return 0;
  }

  if (sub === 'digest') {
    const { atlas: doc } = ensureAtlas(projectDir);
    console.log(renderDigest(doc));
    return 0;
  }

  console.error('raph: usage: raph atlas [where|path|explain|digest] [--project <path>] [--refresh] [--json]');
  return 1;
}
