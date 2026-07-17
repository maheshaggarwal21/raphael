import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATLAS_VERSION,
  collectFiles,
  extractFile,
  buildAtlas,
  scanProject,
  whereQuery,
  pathQuery,
  explainQuery,
  renderAtlas,
  renderDigest,
  queryTokens
} from '../src/lib/atlas.js';

// A small fixture project with the shapes the atlas must understand:
// an import chain, a raise site, a caller, a test file, and a doc mention.
function fixtureProject() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-atlas-'));
  mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
  mkdirSync(path.join(dir, 'test'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(
    path.join(dir, 'src', 'lib', 'validate.js'),
    [
      "import yaml from 'js-yaml';",
      'export function validateLesson(lesson) {',
      "  if (!lesson) throw new Error('E-SCHEMA: lesson missing');",
      '  return true;',
      '}',
      ''
    ].join('\n')
  );
  writeFileSync(
    path.join(dir, 'src', 'lib', 'candidates.js'),
    [
      "import { validateLesson } from './validate.js';",
      'export function writeCandidate(lesson) {',
      '  validateLesson(lesson);',
      '  return lesson;',
      '}',
      ''
    ].join('\n')
  );
  writeFileSync(
    path.join(dir, 'test', 'validate.test.js'),
    [
      "import { validateLesson } from '../src/lib/validate.js';",
      'validateLesson({});',
      ''
    ].join('\n')
  );
  writeFileSync(
    path.join(dir, 'README.md'),
    'Validation errors show up as E-SCHEMA. See src/lib/validate.js.\n'
  );
  writeFileSync(path.join(dir, 'node_modules', 'junk', 'x.js'), 'export function junk() {}\n');
  return dir;
}

test('atlas extraction + graph: imports EXTRACTED, calls INFERRED, raises vs mentions, tests, degree', () => {
  const dir = fixtureProject();
  try {
    const files = collectFiles(dir);
    assert.ok(files.includes('src/lib/validate.js'));
    assert.ok(!files.some((f) => f.includes('node_modules')), 'ignored dirs stay out');

    const { extractions } = scanProject(dir);
    const atlas = buildAtlas(extractions, { project: 'fixture', generated: '2026-07-17' });

    // imports edge resolved to the file node, EXTRACTED
    const imp = atlas.edges.find(
      (e) => e.source === 'file:src/lib/candidates.js' && e.target === 'file:src/lib/validate.js'
    );
    assert.equal(imp.relation, 'imports');
    assert.equal(imp.confidence, 'EXTRACTED');

    // the external package became a pkg node
    assert.ok(atlas.nodes.some((n) => n.id === 'pkg:js-yaml'));

    // call edge: candidates.js calls validateLesson — imported + unique = 0.95
    const call = atlas.edges.find(
      (e) => e.source === 'file:src/lib/candidates.js' && e.target === 'sym:src/lib/validate.js#validateLesson' && e.relation === 'calls'
    );
    assert.equal(call.confidence, 'INFERRED');
    assert.equal(call.score, 0.95);

    // E-SCHEMA: raised in validate.js, mentioned in README
    const raises = atlas.edges.find((e) => e.relation === 'raises' && e.target === 'err:E-SCHEMA');
    assert.equal(raises.source, 'file:src/lib/validate.js');
    const mentions = atlas.edges.find((e) => e.relation === 'mentions' && e.target === 'err:E-SCHEMA');
    assert.equal(mentions.source, 'file:README.md');

    // the test file relationship is 'tests', not 'imports'
    const t = atlas.edges.find((e) => e.source === 'file:test/validate.test.js' && e.target === 'file:src/lib/validate.js');
    assert.equal(t.relation, 'tests');

    // degree: validate.js is the god node of this fixture
    const god = atlas.nodes.filter((n) => n.type === 'file').sort((a, b) => b.degree - a.degree)[0];
    assert.equal(god.label, 'src/lib/validate.js');

    // renders without throwing and names the error-code route
    const md = renderAtlas(atlas);
    assert.match(md, /E-SCHEMA: src\/lib\/validate\.js/);
    assert.match(renderDigest(atlas), /raph atlas where/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('where/path/explain: the error router answers "where do I look" with reasons', () => {
  const dir = fixtureProject();
  try {
    const { extractions } = scanProject(dir);
    const atlas = buildAtlas(extractions, { project: 'fixture', generated: '2026-07-17' });

    // an error message a user would paste
    const hits = whereQuery(atlas, 'raph failed: E-SCHEMA: lesson missing');
    assert.equal(hits[0].file, 'src/lib/validate.js');
    assert.ok(hits[0].reasons.some((r) => r.includes('error text origin: E-SCHEMA')));
    // one-hop expansion pulls in the caller and the test as next places to look
    const files = hits.map((h) => h.file);
    assert.ok(files.includes('src/lib/candidates.js'));

    // symbol questions work too
    const symHits = whereQuery(atlas, 'where is writeCandidate defined?');
    assert.equal(symHits[0].file, 'src/lib/candidates.js');
    assert.ok(symHits[0].reasons.some((r) => r.includes('defines writeCandidate()')));

    // path: how does the test reach the error code?
    const p2 = pathQuery(atlas, 'validate.test.js', 'E-SCHEMA');
    assert.ok(p2.hops >= 1);
    assert.equal(p2.to, 'err:E-SCHEMA');

    // explain: the symbol node knows its callers
    const ex = explainQuery(atlas, 'validateLesson');
    assert.equal(ex.node.type, 'symbol');
    const rels = JSON.stringify(ex.relations);
    assert.match(rels, /candidates\.js/);

    // unresolvable terms error cleanly with E-ATLAS
    assert.match(pathQuery(atlas, 'nope-nothing-zzz', 'E-SCHEMA').error, /E-ATLAS/);
    assert.match(explainQuery(atlas, 'zzz-not-here').error, /E-ATLAS/);

    // queryTokens: codes, paths, identifiers separated
    const tok = queryTokens('E-SCHEMA in src/lib/validate.js via writeCandidate');
    assert.deepEqual(tok.codes, ['E-SCHEMA']);
    assert.ok(tok.paths.includes('src/lib/validate.js'));
    assert.ok(tok.idents.includes('writeCandidate'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('incremental cache: unchanged files reuse extraction, changed files re-extract', () => {
  const dir = fixtureProject();
  try {
    const first = scanProject(dir);
    assert.equal(first.reused, 0);
    assert.ok(first.extracted >= 4);

    // rebuild with the previous scan as cache: everything reused
    const atlasDoc = { version: ATLAS_VERSION, fileExtractions: first.extractions };
    const second = scanProject(dir, { previous: atlasDoc });
    assert.equal(second.extracted, 0);
    assert.equal(second.reused, first.extracted);

    // a cache from an older extractor version is ignored wholesale
    const stale = scanProject(dir, { previous: { version: ATLAS_VERSION - 1, fileExtractions: first.extractions } });
    assert.equal(stale.reused, 0);
    assert.equal(stale.extracted, first.extracted);

    // change one file: only it re-extracts
    writeFileSync(
      path.join(dir, 'src', 'lib', 'candidates.js'),
      "import { validateLesson } from './validate.js';\nexport function writeCandidate(l) { validateLesson(l); return l; }\nexport function newThing() {}\n"
    );
    const third = scanProject(dir, { previous: atlasDoc });
    assert.equal(third.extracted, 1);
    assert.equal(third.reused, first.extracted - 1);
    // and the new export shows up in a rebuilt graph
    const atlas = buildAtlas(third.extractions, { project: 'fixture' });
    assert.ok(atlas.nodes.some((n) => n.id === 'sym:src/lib/candidates.js#newThing'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live-run regressions: quoted E-codes are origins, test files rank below source, no pkg waypoints', () => {
  // errors.push({ code: 'E-SCHEMA' }) — no `throw` on the line, still an origin
  const noThrow = extractFile('src/lib/validate.js', "errors.push({ code: 'E-SCHEMA', msg: e.message });\n");
  assert.equal(noThrow.errorCodes[0].raises, true);
  // a bare comment mention in code is NOT an origin
  const comment = extractFile('src/lib/x.js', '// see E-SCHEMA for details\n');
  assert.equal(comment.errorCodes[0].raises, false);

  // a test fixture faking the same code must rank BELOW the real source origin
  const extractions = {
    'src/lib/validate.js': extractFile('src/lib/validate.js', "export function validateLesson() { errors.push({ code: 'E-SCHEMA' }); }\n"),
    'test/fake.test.js': extractFile('test/fake.test.js', "throw new Error('E-SCHEMA: fixture');\n")
  };
  const atlas = buildAtlas(extractions, { project: 'reg' });
  const hits = whereQuery(atlas, 'E-SCHEMA');
  assert.equal(hits[0].file, 'src/lib/validate.js');
  assert.ok(hits[0].score > hits.find((h) => h.file === 'test/fake.test.js').score);

  // paths never route THROUGH a shared package hub
  const ex2 = {
    'a.js': extractFile('a.js', "import fs from 'node:fs';\nexport function alpha() {}\n"),
    'b.js': extractFile('b.js', "import fs from 'node:fs';\nexport function beta() {}\n")
  };
  const atlas2 = buildAtlas(ex2, { project: 'reg2' });
  const p2 = pathQuery(atlas2, 'a.js', 'b.js');
  assert.equal(p2.hops, null, 'only shared pkg between them = no meaningful path');
  // but a package can still be an endpoint
  const p3 = pathQuery(atlas2, 'a.js', 'node:fs');
  assert.equal(p3.hops, 1);
});

test('extractFile edge details: python defs, ambiguous calls across multiple exporters', () => {
  // python file: def/class/import forms
  const py = extractFile('svc/app.py', 'import flask\nfrom util import helper\n\ndef handler(req):\n    return req\n\nclass Server:\n    pass\n');
  assert.ok(py.exports.some((e) => e.name === 'handler'));
  assert.ok(py.exports.some((e) => e.name === 'Server'));
  assert.ok(py.imports.some((i) => i.spec === 'flask'));

  // two files export the same name; a third calls it without importing either:
  // both edges must be AMBIGUOUS, never a silent guess.
  const extractions = {
    'a.js': extractFile('a.js', 'export function computeTotals() {}\n'),
    'b.js': extractFile('b.js', 'export function computeTotals() {}\n'),
    'c.js': extractFile('c.js', 'const x = computeTotals();\n')
  };
  const atlas = buildAtlas(extractions, { project: 'amb' });
  const amb = atlas.edges.filter((e) => e.source === 'file:c.js' && e.relation === 'calls');
  assert.equal(amb.length, 2);
  assert.ok(amb.every((e) => e.confidence === 'AMBIGUOUS'));
  // and the report surfaces them for review
  assert.match(renderAtlas(atlas), /Ambiguous connections[\s\S]*c\.js/);
});
