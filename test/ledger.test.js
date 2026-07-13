import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLedger, hasProcessed, appendLedger } from '../src/lib/ledger.js';
import { p } from '../src/lib/paths.js';

function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-ledger-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    return fn(dir);
  } finally {
    process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function entry(overrides = {}) {
  return {
    hash: 'a'.repeat(64),
    path: path.join(os.tmpdir(), 'sessions', 'sess-1.jsonl'),
    processed_at: '2026-07-13T10:00:00.000Z',
    episodes: 3,
    miner: 'raphael/miner@0.1.0',
    ...overrides
  };
}

test('missing ledger file loads as empty Map', () => {
  withSandbox(() => {
    const ledger = loadLedger();
    assert.ok(ledger instanceof Map);
    assert.equal(ledger.size, 0);
  });
});

test('append then load roundtrips', () => {
  withSandbox(() => {
    const e = entry();
    appendLedger([e]);
    const ledger = loadLedger();
    assert.equal(ledger.size, 1);
    assert.deepEqual(ledger.get(e.hash), e);
  });
});

test('append twice accumulates entries', () => {
  withSandbox(() => {
    const e1 = entry({ hash: '1'.repeat(64) });
    const e2 = entry({ hash: '2'.repeat(64), episodes: 7 });
    appendLedger([e1]);
    appendLedger([e2]);
    const ledger = loadLedger();
    assert.equal(ledger.size, 2);
    assert.deepEqual(ledger.get(e1.hash), e1);
    assert.deepEqual(ledger.get(e2.hash), e2);
  });
});

test('duplicate hash: later entry wins', () => {
  withSandbox(() => {
    const first = entry({ episodes: 1, processed_at: '2026-07-12T00:00:00.000Z' });
    const second = entry({ episodes: 9, processed_at: '2026-07-13T00:00:00.000Z' });
    appendLedger([first]);
    appendLedger([second]);
    const ledger = loadLedger();
    assert.equal(ledger.size, 1);
    assert.deepEqual(ledger.get(first.hash), second);
  });
});

test('malformed lines are skipped without breaking valid ones', () => {
  withSandbox(() => {
    const good = entry();
    appendLedger([good]);
    // Simulate a torn write / corruption between valid lines, CRLF included.
    appendFileSync(p.minedLedger(), 'not json at all\r\n{"truncated": \r\n42\r\n', 'utf8');
    const late = entry({ hash: 'b'.repeat(64) });
    appendLedger([late]);
    const ledger = loadLedger();
    assert.equal(ledger.size, 2);
    assert.deepEqual(ledger.get(good.hash), good);
    assert.deepEqual(ledger.get(late.hash), late);
  });
});

test('entries without a string hash are skipped on load', () => {
  withSandbox(() => {
    mkdirSync(path.dirname(p.minedLedger()), { recursive: true });
    appendFileSync(p.minedLedger(), '{"path":"x","episodes":1}\n{"hash":123}\n', 'utf8');
    const ledger = loadLedger();
    assert.equal(ledger.size, 0);
  });
});

test('hasProcessed reflects ledger contents', () => {
  withSandbox(() => {
    const e = entry();
    appendLedger([e]);
    const ledger = loadLedger();
    assert.equal(hasProcessed(ledger, e.hash), true);
    assert.equal(hasProcessed(ledger, 'f'.repeat(64)), false);
  });
});

test('appendLedger creates the state dir and writes one JSON line per entry', () => {
  withSandbox(() => {
    const e1 = entry({ hash: '1'.repeat(64) });
    const e2 = entry({ hash: '2'.repeat(64) });
    appendLedger([e1, e2]);
    const raw = readFileSync(p.minedLedger(), 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    assert.equal(lines.length, 2);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  });
});

test('appendLedger with empty array is a no-op, invalid input throws coded error', () => {
  withSandbox(() => {
    appendLedger([]);
    assert.equal(loadLedger().size, 0);
    assert.throws(() => appendLedger('nope'), /E-LEDGER/);
    assert.throws(() => appendLedger([{ path: 'x' }]), /E-LEDGER/);
  });
});
