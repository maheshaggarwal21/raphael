import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVault, renderCanvas } from '../src/lib/obsidian.js';

// A hand-built atlas covering every node/edge kind the exporter handles.
function fixture() {
  const nodes = [
    { id: 'file:src/a.js', type: 'file', label: 'src/a.js', kind: 'code', isTest: false, degree: 5, group: 'src' },
    { id: 'file:src/b.js', type: 'file', label: 'src/b.js', kind: 'code', isTest: false, degree: 3, group: 'src' },
    { id: 'file:test/a.test.js', type: 'file', label: 'test/a.test.js', kind: 'code', isTest: true, degree: 1, group: 'test' },
    { id: 'sym:src/b.js#helper', type: 'symbol', label: 'helper', source: 'src/b.js:10', degree: 2 },
    { id: 'pkg:js-yaml', type: 'package', label: 'js-yaml', degree: 1 },
    { id: 'err:E-SCHEMA', type: 'error-code', label: 'E-SCHEMA', degree: 2 }
  ];
  const edges = [
    { source: 'file:src/b.js', target: 'sym:src/b.js#helper', relation: 'defines', confidence: 'EXTRACTED' },
    { source: 'file:src/a.js', target: 'file:src/b.js', relation: 'imports', confidence: 'EXTRACTED' },
    { source: 'file:test/a.test.js', target: 'file:src/a.js', relation: 'tests', confidence: 'EXTRACTED' },
    { source: 'file:src/a.js', target: 'sym:src/b.js#helper', relation: 'calls', confidence: 'INFERRED', score: 0.9 },
    { source: 'file:src/a.js', target: 'pkg:js-yaml', relation: 'uses', confidence: 'EXTRACTED' },
    { source: 'file:src/a.js', target: 'err:E-SCHEMA', relation: 'raises', confidence: 'EXTRACTED' },
    { source: 'file:src/b.js', target: 'err:E-SCHEMA', relation: 'mentions', confidence: 'EXTRACTED' }
  ];
  return { version: 2, project: 'demo', generated: '2026-07-17', counts: { files: 3, nodes: nodes.length, edges: edges.length }, nodes, edges };
}

test('renderVault emits a note per file mirroring the repo path, plus errors + index', () => {
  const { notes } = renderVault(fixture());
  const paths = notes.map((n) => n.path);
  assert.ok(paths.includes('src/a.js.md'));
  assert.ok(paths.includes('src/b.js.md'));
  assert.ok(paths.includes('test/a.test.js.md'));
  assert.ok(paths.includes('errors/E-SCHEMA.md'));
  assert.ok(paths.includes('index.md'));
  // symbols/packages do NOT get their own notes
  assert.ok(!paths.some((p) => p.includes('helper')));
});

test('a file note carries forward links, backrefs, defines, calls, errors, packages', () => {
  const { notes } = renderVault(fixture());
  const a = notes.find((n) => n.path === 'src/a.js.md').content;
  assert.match(a, /# src\/a\.js/);
  assert.match(a, /Source: `src\/a\.js`/);
  assert.match(a, /## Imports\n- \[\[src\/b\.js\|b\.js\]\]/);        // forward wikilink
  assert.match(a, /## Tested by\n- \[\[test\/a\.test\.js\|a\.test\.js\]\]/); // reverse edge = backref
  assert.match(a, /## Calls\n- \[\[src\/b\.js\|b\.js\]\] `helper` _\(inferred 0\.9\)_/); // confidence tag
  assert.match(a, /raises \[\[E-SCHEMA\]\]/);
  assert.match(a, /## Packages\n- `js-yaml`/);

  const b = notes.find((n) => n.path === 'src/b.js.md').content;
  assert.match(b, /## Defines\n- `helper`/);
  assert.match(b, /## Imported by\n- \[\[src\/a\.js\|a\.js\]\]/); // b is imported by a
});

test('an error-code note lists the files that raise and mention it', () => {
  const { notes } = renderVault(fixture());
  const e = notes.find((n) => n.path === 'errors/E-SCHEMA.md').content;
  assert.match(e, /# E-SCHEMA/);
  assert.match(e, /## Raised by\n- \[\[src\/a\.js\|a\.js\]\]/);
  assert.match(e, /## Mentioned by\n- \[\[src\/b\.js\|b\.js\]\]/);
});

test('the index MOC ranks god-nodes by degree and links the canvas', () => {
  const { notes } = renderVault(fixture());
  const idx = notes.find((n) => n.path === 'index.md').content;
  assert.match(idx, /# Atlas: demo/);
  assert.match(idx, /\[\[atlas\.canvas\]\]/);
  // src/a.js (degree 5) must appear before src/b.js (degree 3)
  assert.ok(idx.indexOf('src/a.js') < idx.indexOf('src/b.js'));
  assert.match(idx, /nothing in it can command an agent/); // advisory framing carried through
});

test('the canvas is valid JSON Canvas 1.0: file nodes on a grid + import/test edges', () => {
  const canvas = JSON.parse(renderCanvas(fixture()));
  assert.ok(Array.isArray(canvas.nodes) && Array.isArray(canvas.edges));
  const a = canvas.nodes.find((n) => n.id === 'file:src/a.js');
  assert.equal(a.type, 'file');
  assert.equal(a.file, 'src/a.js.md');       // opens the note
  assert.equal(typeof a.x, 'number');
  assert.equal(typeof a.width, 'number');
  // only import/test edges among shown file nodes; calls/defines/uses excluded
  assert.ok(canvas.edges.length >= 2);
  assert.ok(canvas.edges.every((e) => e.label === 'imports' || e.label === 'tests'));
  const t = canvas.edges.find((e) => e.label === 'tests');
  assert.equal(t.color, '4');                 // test edges tinted
});

test('deterministic: same atlas -> byte-identical vault + canvas', () => {
  const v1 = renderVault(fixture());
  const v2 = renderVault(fixture());
  assert.deepEqual(v1.notes, v2.notes);
  assert.equal(v1.canvas, v2.canvas);
});

test('maxNotes bounds file notes and the index says so', () => {
  const { notes } = renderVault(fixture(), { maxNotes: 1 });
  const fileNotes = notes.filter((n) => !n.path.startsWith('errors/') && n.path !== 'index.md');
  assert.equal(fileNotes.length, 1);
  const idx = notes.find((n) => n.path === 'index.md').content;
  assert.match(idx, /capped at 1/);
});
