import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeToken, startConsole, checkRequest, escapeHtml, statusSummary } from '../src/lib/web.js';

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-web-'));
  process.env.RAPHAEL_HOME = dir;
  return dir;
}
function cleanup(home) {
  rmSync(home, { recursive: true, force: true });
  delete process.env.RAPHAEL_HOME;
}

function fakeReq({ host = '127.0.0.1:4321', origin, url = '/api/health', token } = {}) {
  const headers = { host };
  if (origin) headers.origin = origin;
  if (token) headers['x-raphael-token'] = token;
  return { headers, url, method: 'GET' };
}

// --- the gate, unit level -------------------------------------------------------

test('checkRequest: loopback + token passes; everything hostile is refused', () => {
  const t = makeToken();
  assert.equal(checkRequest(fakeReq({ token: t }), t).ok, true);
  assert.equal(checkRequest(fakeReq({ url: `/?token=${t}` }), t).ok, true); // query form

  // wrong/missing token -> 401
  assert.equal(checkRequest(fakeReq({}), t).code, 401);
  assert.equal(checkRequest(fakeReq({ token: 'nope' }), t).code, 401);

  // foreign Host header (DNS rebinding) -> 403 even WITH the token
  assert.equal(checkRequest(fakeReq({ host: 'evil.example:4321', token: t }), t).code, 403);
  assert.equal(checkRequest(fakeReq({ host: '', token: t }), t).code, 403);

  // cross-origin fetch (CSRF) -> 403 even WITH the token
  assert.equal(checkRequest(fakeReq({ origin: 'https://evil.example', token: t }), t).code, 403);
  assert.equal(checkRequest(fakeReq({ origin: ':::garbage', token: t }), t).code, 403);

  // our own origin is fine
  assert.equal(checkRequest(fakeReq({ origin: 'http://127.0.0.1:4321', token: t }), t).ok, true);
  assert.equal(checkRequest(fakeReq({ origin: 'http://localhost:4321', token: t }), t).ok, true);
});

test('escapeHtml neutralizes markup from untrusted lesson text', () => {
  assert.equal(escapeHtml(`<script>x()</script>&"'`), '&lt;script&gt;x()&lt;/script&gt;&amp;&quot;&#39;');
});

// --- the server, end to end ------------------------------------------------------

test('console server: guard page without token, data only with it, hardened headers', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port, url } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.ok(url.includes(token));

    // bare / -> 401 guard page, no data
    const bare = await fetch(`${base}/`);
    assert.equal(bare.status, 401);
    assert.ok((await bare.text()).includes('token-guarded'));

    // /api without token -> 401 json
    const noTok = await fetch(`${base}/api/status`);
    assert.equal(noTok.status, 401);

    // with token -> the shell + the data, with the hardening headers
    const shell = await fetch(`${base}/?token=${token}`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(shell.headers.get('cache-control'), 'no-store');
    assert.ok((await shell.text()).includes('Raphael console'));

    const st = await fetch(`${base}/api/status`, { headers: { 'x-raphael-token': token } });
    assert.equal(st.status, 200);
    const body = await st.json();
    assert.equal(typeof body.lessons.active, 'number');
    assert.equal(body.autoApprove.level, 'off'); // fresh sandbox defaults closed
    assert.equal(body.queue.pending, 0);

    // cross-origin browser fetch is refused even with the token
    const evil = await fetch(`${base}/api/status`, { headers: { 'x-raphael-token': token, origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);

    // unknown route -> 404 json, still gated
    const nf = await fetch(`${base}/api/nope`, { headers: { 'x-raphael-token': token } });
    assert.equal(nf.status, 404);
  } finally {
    server.close();
    cleanup(home);
  }
});

test('statusSummary shape stays CLI-derived (same lib, no web-only logic)', () => {
  const home = sandbox();
  try {
    const s = statusSummary();
    assert.deepEqual(Object.keys(s.queue).sort(), ['pending', 'quarantined', 'security']);
    assert.deepEqual(Object.keys(s.adoptions).sort(), ['blocked', 'revoked', 'total']);
    assert.equal(s.mode, 'curator');
  } finally {
    cleanup(home);
  }
});
