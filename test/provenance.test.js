import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-prov-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}

// fresh import per HOME change is unnecessary — paths.js reads the env lazily
const {
  detectLicense, detectLicenseFromDir, allowsCodeAdoption, contentHash,
  recordAdoption, updateAdoption, listAdoptions, findAdoption
} = await import('../src/lib/provenance.js');

// --- license detection ----------------------------------------------------

test('detectLicense: SPDX marker wins and maps to a family', () => {
  assert.deepEqual(
    detectLicense('// SPDX-License-Identifier: Apache-2.0\ncode'),
    { id: 'Apache-2.0', family: 'permissive', detected: true }
  );
  assert.equal(detectLicense('/* SPDX-License-Identifier: GPL-3.0-only */').family, 'copyleft');
  assert.equal(detectLicense('# SPDX-License-Identifier: MPL-2.0').family, 'weak-copyleft');
});

test('detectLicense: recognizes full license texts, AGPL/LGPL never misread as GPL', () => {
  assert.equal(detectLicense('Permission is hereby granted, free of charge, to any person obtaining a copy of this software').id, 'MIT');
  assert.equal(detectLicense('                 GNU AFFERO GENERAL PUBLIC LICENSE\n Version 3').id, 'AGPL-3.0');
  assert.equal(detectLicense('GNU LESSER GENERAL PUBLIC LICENSE Version 3').family, 'weak-copyleft');
  assert.equal(detectLicense('GNU GENERAL PUBLIC LICENSE\n Version 2, June 1991').id, 'GPL-2.0');
  assert.equal(detectLicense('This is free and unencumbered software released into the public domain.').family, 'public-domain');
});

test('detectLicense: no license means unknown, and unknown blocks code adoption', () => {
  const none = detectLicense('just a readme with no legal text at all');
  assert.deepEqual(none, { id: 'unknown', family: 'unknown', detected: false });
  assert.equal(allowsCodeAdoption(none), false);
  assert.equal(allowsCodeAdoption(detectLicense('SPDX-License-Identifier: GPL-3.0')), false);
  assert.equal(allowsCodeAdoption(detectLicense('SPDX-License-Identifier: MIT')), true);
  assert.equal(allowsCodeAdoption(detectLicense('SPDX-License-Identifier: CC0-1.0')), true);
});

test('detectLicenseFromDir: LICENSE file wins over package.json; fallback works', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-lic-'));
  try {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ license: 'GPL-3.0' }));
    writeFileSync(path.join(dir, 'LICENSE'), 'MIT License\n\nPermission is hereby granted...');
    const viaFile = detectLicenseFromDir(dir);
    assert.equal(viaFile.id, 'MIT');
    assert.equal(viaFile.source, 'LICENSE');

    rmSync(path.join(dir, 'LICENSE'));
    const viaPkg = detectLicenseFromDir(dir);
    assert.equal(viaPkg.id, 'GPL-3.0');
    assert.equal(viaPkg.family, 'copyleft');
    assert.equal(viaPkg.source, 'package.json');

    const empty = mkdtempSync(path.join(os.tmpdir(), 'raph-lic-none-'));
    assert.equal(detectLicenseFromDir(empty).family, 'unknown');
    rmSync(empty, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- ledger -----------------------------------------------------------------

test('recordAdoption + listAdoptions: append-only, last-line-wins per id', () => {
  const home = sandbox();
  try {
    const a = recordAdoption({
      source: 'https://example.com/repo',
      kind: 'url',
      license: { id: 'MIT', family: 'permissive', detected: true },
      hash: contentHash('material'),
      verdict: { safe: true }
    });
    assert.match(a.id, /^adp_[0-9A-Z]{26}$/);
    assert.equal(a.status, 'adopted');

    const b = recordAdoption({ source: 'C:/notes/tips.md', kind: 'file' });
    updateAdoption(b, { taken: [{ type: 'lesson', id: 'les_X' }] });

    const all = listAdoptions();
    assert.equal(all.length, 2); // b was updated, not duplicated
    const bNow = all.find((r) => r.id === b.id);
    assert.deepEqual(bNow.taken, [{ type: 'lesson', id: 'les_X' }]);

    // raw file really is append-only history: 3 lines for 2 adoptions
    const raw = readFileSync(path.join(home, 'state', 'adoptions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(raw.length, 3);
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.RAPHAEL_HOME;
  }
});

test('findAdoption: id, unambiguous prefix, or exact source; torn lines skipped', () => {
  const home = sandbox();
  try {
    const a = recordAdoption({ source: 'https://x.dev/a', kind: 'url' });
    recordAdoption({ source: 'https://x.dev/b', kind: 'url' });
    // simulate a crash-torn trailing line
    mkdirSync(path.join(home, 'state'), { recursive: true });
    writeFileSync(path.join(home, 'state', 'adoptions.jsonl'),
      readFileSync(path.join(home, 'state', 'adoptions.jsonl'), 'utf8') + '{"id":"adp_TORN', 'utf8');

    assert.equal(findAdoption(a.id).source, 'https://x.dev/a');
    assert.equal(findAdoption('https://x.dev/b').kind, 'url');
    // prefix must reach past the shared ULID timestamp into the random chars
    assert.equal(findAdoption(a.id.slice(0, 22))?.id, a.id);
    assert.equal(findAdoption('adp_'), null); // ambiguous prefix -> null
    assert.equal(listAdoptions().length, 2); // torn line ignored
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.RAPHAEL_HOME;
  }
});

test('revoke shape: updateAdoption records status flips as history', () => {
  const home = sandbox();
  try {
    const a = recordAdoption({ source: 'https://bad.example', kind: 'url' });
    const revoked = updateAdoption(a, { status: 'revoked' });
    assert.equal(revoked.status, 'revoked');
    assert.equal(listAdoptions()[0].status, 'revoked');
  } finally {
    rmSync(home, { recursive: true, force: true });
    delete process.env.RAPHAEL_HOME;
  }
});
