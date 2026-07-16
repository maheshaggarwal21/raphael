import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeToken, startConsole, checkRequest, escapeHtml, statusSummary } from '../src/lib/web.js';
import { writeCandidate } from '../src/lib/candidates.js';
import { parseLessonFile } from '../src/lib/frontmatter.js';
import { p } from '../src/lib/paths.js';
import { makeLesson } from './helpers.js';

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

// --- 15.2: the review queue over HTTP, driven by the SAME engine as the CLI --

function candidateData(over = {}) {
  const { data } = parseLessonFile(makeLesson({ status: 'candidate', ...over }));
  return data;
}

test('console review flow e2e: queue, batch rules, security confirm, reject', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  const opts = (extra = {}) => ({ headers: { 'x-raphael-token': token, 'content-type': 'application/json', ...extra.headers }, ...extra });
  const post = (path, body, extra = {}) => fetch(`${base}${path}`, opts({ method: 'POST', body: JSON.stringify(body), ...extra }));
  try {
    writeCandidate(candidateData()); // normal, slug webhook-idempotency
    writeCandidate(candidateData({
      slug: 'retry-backoff', severity: 'low',
      title: 'Background retries need exponential backoff',
      lesson: 'Background jobs without retry backoff hammer downstream services during partial outages and worsen them.',
      injection: { headline: 'Background job retried without backoff and worsened the outage window.', tokens: 18 }
    }));
    writeCandidate(candidateData({
      slug: 'jwt-alg-allowlist', category: 'security',
      title: 'JWT middleware must reject alg none tokens',
      lesson: 'JWT libraries accepting the alg none header let forged tokens pass verification unless the algorithm allowlist is explicit.',
      injection: { headline: 'Forged JWT with alg none passed verification — no algorithm allowlist.', tokens: 18 }
    }), '## Notes\nFull-body context the heavyweight review must show.');

    // queue: 3 items, severity-ordered, security flagged for the heavyweight path
    const q1 = await (await fetch(`${base}/api/queue`, opts())).json();
    assert.equal(q1.items.length, 3);
    const sec = q1.items.find((i) => i.category === 'security');
    const normA = q1.items.find((i) => i.slug === 'webhook-idempotency');
    const normB = q1.items.find((i) => i.slug === 'retry-backoff');
    assert.equal(sec.needsConfirmation, true);
    assert.equal(normA.needsConfirmation, false);

    // batch containing the security item: security refused, normal approved
    const batch = await (await post('/api/approve', { refs: [normA.ref, sec.ref] })).json();
    assert.equal(batch.approved, 1);
    assert.equal(batch.failed, 1);
    assert.equal(batch.results.find((r) => r.ref === sec.ref).outcome, 'refused-batch');

    // single security, no confirmed flag -> refused
    const unconfirmed = await (await post('/api/approve', { refs: [sec.ref] })).json();
    assert.equal(unconfirmed.results[0].outcome, 'refused-unconfirmed');

    // the full-body view the confirm flow renders (same completeness as `raph show`)
    const detail = await (await fetch(`${base}/api/queue/item?ref=${sec.ref}`, opts())).json();
    assert.equal(detail.data.slug, 'jwt-alg-allowlist');
    assert.ok(detail.body.includes('heavyweight review must show'));

    // single + confirmed -> approved through the same engine as the CLI
    const ok = await (await post('/api/approve', { refs: [sec.ref], confirmed: true })).json();
    assert.equal(ok.results[0].outcome, 'approved');

    // reject with a reason -> tombstone lands in distill's rejection memory
    const rej = await (await post('/api/reject', { refs: [normB.ref], reason: 'not worth a slot' })).json();
    assert.equal(rej.rejected, 1);
    const tomb = JSON.parse(readFileSync(p.rejectedMemory(), 'utf8').trim());
    assert.equal(tomb.slug, 'retry-backoff');
    assert.equal(tomb.reason, 'not worth a slot');

    const q2 = await (await fetch(`${base}/api/queue`, opts())).json();
    assert.equal(q2.items.length, 0);
    assert.ok(existsSync(path.join(p.lessons(), 'security')));

    // malformed mutation bodies are refused before any handler runs
    assert.equal((await post('/api/approve', { refs: [] })).status, 400);
    assert.equal((await fetch(`${base}/api/approve`, opts({ method: 'POST', body: 'not json' }))).status, 400);
    assert.equal((await fetch(`${base}/api/queue/item`, opts())).status, 400);
    assert.equal((await fetch(`${base}/api/queue/item?ref=nope`, opts())).status, 404);

    // a hostile origin cannot mutate even WITH the token (CSRF defense on POST)
    const evil = await post('/api/approve', { refs: ['1'] }, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
  } finally {
    server.close();
    cleanup(home);
  }
});

test('/api/stats serves the same computation as `raph stats`', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  try {
    const st = await (await fetch(`http://127.0.0.1:${port}/api/stats`, { headers: { 'x-raphael-token': token } })).json();
    assert.equal(st.injections.total, 0);
    assert.deepEqual(Object.keys(st.review).sort(), ['approved', 'rejected', 'suppressed']);
    assert.ok(Array.isArray(st.lessons.neverFired));
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
