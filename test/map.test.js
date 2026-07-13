import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateMap, hotFiles, mapFileName } from '../src/lib/map.js';

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-map-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', main: 'index.js', bin: { demo: 'bin/cli.js' }, scripts: { dev: 'x', test: 'y' } }));
  writeFileSync(path.join(dir, 'index.js'), '// entry');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'a');
  writeFileSync(path.join(dir, 'src', 'b.js'), 'b');
  mkdirSync(path.join(dir, 'test'), { recursive: true });
  writeFileSync(path.join(dir, 'test', 'a.test.js'), 't');
  mkdirSync(path.join(dir, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'junk', 'x.js'), 'ignore me');
  return dir;
}

test('generateMap: stack, entry points, structure — node_modules excluded', async () => {
  const dir = fixture();
  try {
    const { markdown, meta } = await generateMap(dir, { today: '2026-07-13' });
    assert.ok(markdown.includes('# Project map: ' + path.basename(dir)));
    assert.ok(meta.stacks.includes('node'));
    assert.ok(markdown.includes('package.json main: index.js'));
    assert.ok(markdown.includes('bin: bin/cli.js'));
    assert.ok(markdown.includes('scripts: dev, test'));
    assert.ok(markdown.includes('src/'));
    assert.ok(markdown.includes('test/'));
    assert.ok(!markdown.includes('node_modules')); // noise excluded from structure + counts
    assert.ok(markdown.includes('deterministic map')); // no model summary by default
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hotFiles ranks by churn from an injected git runner, skips ignored dirs', () => {
  const git = () => ({
    status: 0,
    stdout: ['src/a.js', 'src/a.js', 'src/a.js', 'src/b.js', 'node_modules/junk/x.js', '', 'README.md'].join('\n')
  });
  const hot = hotFiles('/x', { git });
  assert.equal(hot[0].file, 'src/a.js');
  assert.equal(hot[0].changes, 3);
  assert.ok(!hot.some((h) => h.file.startsWith('node_modules/')));
});

test('generateMap includes a model summary when runModel is provided', async () => {
  const dir = fixture();
  try {
    const runModel = async () => '- watch src/a.js: highest churn';
    const { markdown } = await generateMap(dir, { runModel, today: '2026-07-13' });
    assert.ok(markdown.includes('watch src/a.js: highest churn'));
    assert.ok(!markdown.includes('deterministic map; run with a model'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateMap survives a runModel that throws (map still useful)', async () => {
  const dir = fixture();
  try {
    const runModel = async () => { throw new Error('boom'); };
    const { markdown } = await generateMap(dir, { runModel, today: '2026-07-13' });
    assert.ok(markdown.includes('## Notes'));
    assert.ok(markdown.includes('deterministic map')); // fell back
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mapFileName sanitizes to a safe filename', () => {
  assert.equal(mapFileName('my project/app'), 'my-project-app');
  assert.equal(mapFileName('...'), 'project');
  assert.equal(mapFileName('ok_name-1.2'), 'ok_name-1.2');
});
