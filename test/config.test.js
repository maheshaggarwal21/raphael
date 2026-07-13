import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadConfig,
  saveConfig,
  getProjectConsent,
  setProjectConsent
} from '../src/lib/config.js';
import { p } from '../src/lib/paths.js';

function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-cfg-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    return fn(dir);
  } finally {
    process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig returns defaults when file is missing', () => {
  withSandbox(() => {
    const cfg = loadConfig();
    assert.equal(cfg.schema, 'raphael/config/v1');
    assert.equal(cfg.mode, 'curator');
    assert.deepEqual(cfg.projects, {});
  });
});

test('loadConfig returns defaults for an empty file', () => {
  withSandbox((dir) => {
    writeFileSync(p.config(), '', 'utf8');
    assert.deepEqual(loadConfig(), { schema: 'raphael/config/v1', mode: 'curator', model: { provider: 'auto' }, projects: {} });
  });
});

test('loadConfig throws E-CONFIG on unparseable yaml', () => {
  withSandbox(() => {
    writeFileSync(p.config(), 'projects: [unclosed\n  bad: {', 'utf8');
    assert.throws(() => loadConfig(), /E-CONFIG/);
  });
});

test('loadConfig throws E-CONFIG when the document is not a mapping', () => {
  withSandbox(() => {
    writeFileSync(p.config(), '- just\n- a\n- list\n', 'utf8');
    assert.throws(() => loadConfig(), /E-CONFIG/);
  });
});

test('save + load roundtrip preserves unrelated keys exactly', () => {
  withSandbox(() => {
    const original = {
      schema: 'raphael/config/v1',
      mode: 'librarian',
      thresholds: { promote: 3, retire: 0.2 },
      scrub: { extra_patterns: ['FOO-\\d+'] },
      projects: {}
    };
    saveConfig(original);

    const cfg = setProjectConsent('C:\\Users\\Foo\\proj', true);
    assert.equal(cfg.mode, 'librarian');
    assert.deepEqual(cfg.thresholds, { promote: 3, retire: 0.2 });
    assert.deepEqual(cfg.scrub, { extra_patterns: ['FOO-\\d+'] });

    const back = loadConfig();
    assert.equal(back.mode, 'librarian');
    assert.deepEqual(back.thresholds, { promote: 3, retire: 0.2 });
    assert.deepEqual(back.scrub, { extra_patterns: ['FOO-\\d+'] });
    assert.equal(getProjectConsent(back, 'C:\\Users\\Foo\\proj'), true);
  });
});

test('setProjectConsent writes consent + registered date and persists', () => {
  withSandbox(() => {
    const cfg = setProjectConsent('C:\\Users\\Foo\\proj', false);
    const resolved = path.resolve('C:\\Users\\Foo\\proj');
    assert.ok(cfg.projects[resolved]);
    assert.equal(cfg.projects[resolved].consent, false);
    assert.match(cfg.projects[resolved].registered, /^\d{4}-\d{2}-\d{2}$/);

    const back = loadConfig();
    assert.equal(getProjectConsent(back, 'C:\\Users\\Foo\\proj'), false);
  });
});

test('setProjectConsent rejects non-boolean consent', () => {
  withSandbox(() => {
    assert.throws(() => setProjectConsent('C:\\x', 'yes'), /E-CONFIG/);
  });
});

test('getProjectConsent returns undefined for unregistered project', () => {
  withSandbox(() => {
    const cfg = loadConfig();
    assert.equal(getProjectConsent(cfg, 'C:\\never\\registered'), undefined);
  });
});

test('consent lookup tolerates trailing separators and forward slashes', () => {
  withSandbox(() => {
    setProjectConsent('C:\\Users\\Foo\\proj', true);
    const cfg = loadConfig();
    assert.equal(getProjectConsent(cfg, 'C:\\Users\\Foo\\proj\\'), true);
    if (process.platform === 'win32') {
      assert.equal(getProjectConsent(cfg, 'C:/Users/Foo/proj'), true);
    }
  });
});

test('consent lookup is case-insensitive on win32', { skip: process.platform !== 'win32' }, () => {
  withSandbox(() => {
    setProjectConsent('C:\\Users\\Foo\\Proj', true);
    const cfg = loadConfig();
    assert.equal(getProjectConsent(cfg, 'c:\\users\\foo\\proj'), true);
    assert.equal(getProjectConsent(cfg, 'C:\\USERS\\FOO\\PROJ'), true);
  });
});

test('setProjectConsent replaces a case-variant key instead of duplicating', { skip: process.platform !== 'win32' }, () => {
  withSandbox(() => {
    setProjectConsent('c:\\users\\foo\\proj', true);
    const cfg = setProjectConsent('C:\\Users\\Foo\\Proj', false);
    const keys = Object.keys(cfg.projects).filter(
      (k) => k.toLowerCase() === 'c:\\users\\foo\\proj'
    );
    assert.equal(keys.length, 1);
    assert.equal(getProjectConsent(cfg, 'C:\\Users\\Foo\\Proj'), false);
  });
});

test('saved config file is valid yaml on disk', () => {
  withSandbox(() => {
    setProjectConsent('C:\\Users\\Foo\\proj', true);
    const raw = readFileSync(p.config(), 'utf8');
    assert.ok(raw.includes('raphael/config/v1'));
    assert.ok(raw.includes('consent: true'));
  });
});
