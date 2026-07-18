import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { makeToken, startConsole, checkRequest, escapeHtml, statusSummary } from '../src/lib/web.js';
import { writeCandidate } from '../src/lib/candidates.js';
import { parseLessonFile } from '../src/lib/frontmatter.js';
import { buildIndex } from '../src/lib/compile.js';
import { recordAdoption } from '../src/lib/provenance.js';
import { logEvent } from '../src/lib/events.js';
import { p } from '../src/lib/paths.js';
import { makeLesson, writeActiveLesson } from './helpers.js';

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

// --- 15.3: lessons browser, adopt inbox, activity feed --------------------------

test('console 15.3 e2e: lessons browser, injection toggle, adopt dry-run + ledger + revoke, feed', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  const opts = (extra = {}) => ({ headers: { 'x-raphael-token': token, 'content-type': 'application/json', ...extra.headers }, ...extra });
  const post = (path, body) => fetch(`${base}${path}`, opts({ method: 'POST', body: JSON.stringify(body) }));
  try {
    // lessons browser: browse-all + ranked search + full detail
    writeActiveLesson();
    writeActiveLesson({
      slug: 'csv-injection', category: 'security', severity: 'high',
      title: 'CSV exports must neutralize formula-leading cells',
      lesson: 'Spreadsheet apps execute cells starting with = + - or @; exports that pass user text through unneutralized become formula injection.',
      triggers: { keywords: ['csv', 'export'], paths: [] },
      injection: { headline: 'CSV export executed a user-supplied formula cell — no neutralization.', tokens: 18 }
    });
    buildIndex();

    const all = await (await fetch(`${base}/api/lessons`, opts())).json();
    assert.equal(all.items.length, 2);

    const ranked = await (await fetch(`${base}/api/lessons?q=webhook+idempotency`, opts())).json();
    assert.ok(ranked.items.length >= 1);
    assert.equal(ranked.items[0].slug, 'webhook-idempotency');
    assert.ok(Array.isArray(ranked.items[0].reasons));

    const item = await (await fetch(`${base}/api/lessons/item?ref=csv-injection`, opts())).json();
    assert.equal(item.data.category, 'security');
    assert.equal((await fetch(`${base}/api/lessons/item?ref=nope`, opts())).status, 404);

    // injection toggle = the same switch as `raph on/off`
    await post('/api/injection', { enabled: false });
    let st = await (await fetch(`${base}/api/status`, opts())).json();
    assert.equal(st.injectionEnabled, false);
    await post('/api/injection', { enabled: true });
    st = await (await fetch(`${base}/api/status`, opts())).json();
    assert.equal(st.injectionEnabled, true);
    assert.equal((await post('/api/injection', { enabled: 'yes' })).status, 400);

    // adopt dry-run: reads + licenses, zero model calls, zero writes
    const mat = path.join(home, 'material.md');
    writeFileSync(mat, '# Notes\nRetry queues need dead-letter handling after N failures.\nMIT License\n', 'utf8');
    const dry = await (await post('/api/adopt', { src: mat, dryRun: true })).json();
    assert.equal(dry.outcome, 'dry-run');
    assert.ok(dry.estimateTokens > 2000);
    assert.equal((await (await fetch(`${base}/api/adoptions`, opts())).json()).items.length, 0);

    // ledger view scrubs verdict text that came from external material
    recordAdoption({
      source: 'https://example.com/notes', kind: 'article',
      license: { detected: true, id: 'MIT', family: 'permissive' },
      hash: 'x'.repeat(64),
      verdict: { safe: true, quality: 2, summary: 'mentions key AKIAABCDEFGHIJKLMNOP in passing', risks: [] },
      taken: []
    });
    const led = await (await fetch(`${base}/api/adoptions`, opts())).json();
    assert.equal(led.items.length, 1);
    assert.ok(!JSON.stringify(led).includes('AKIAABCDEFGHIJKLMNOP'));
    assert.ok(JSON.stringify(led).includes('<SECRET:'));

    // revoke through the console = the same revokeAdoption as the CLI
    const rev = await (await post('/api/adopt/revoke', { ref: led.items[0].id })).json();
    assert.equal(rev.adoption, led.items[0].id);
    const led2 = await (await fetch(`${base}/api/adoptions`, opts())).json();
    assert.equal(led2.items[0].status, 'revoked');
    assert.equal((await post('/api/adopt/revoke', { ref: 'adp_nope' })).status, 404);

    // activity feed reads the audit log, newest first
    logEvent({ event: 'approved', slug: 'csv-injection', category: 'security' });
    const feed = await (await fetch(`${base}/api/events?limit=10`, opts())).json();
    assert.ok(feed.items.length >= 1);
    assert.equal(feed.items[0].event, 'approved');

    // /api/why mirrors `raph why`
    const why = await (await fetch(`${base}/api/why`, opts())).json();
    assert.equal(why.total, 0);

    // bad adopt bodies are refused
    assert.equal((await post('/api/adopt', {})).status, 400);
    assert.equal((await post('/api/adopt', { src: path.join(home, 'missing.md') })).status, 400);
  } finally {
    server.close();
    cleanup(home);
  }
});

// --- 15.4: settings (dial + consent) and the guard page --------------------------

test('console 15.4 e2e: settings dial via setDial, consent registry, guard scan', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  const opts = (extra = {}) => ({ headers: { 'x-raphael-token': token, 'content-type': 'application/json', ...extra.headers }, ...extra });
  const post = (path, body) => fetch(`${base}${path}`, opts({ method: 'POST', body: JSON.stringify(body) }));
  try {
    // settings: fresh sandbox = dial off, defaults, empty consent registry
    let s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.autoApprove.level, 'off');
    assert.deepEqual(s.autoApprove.levels, ['off', 'standard', 'wide', 'full']);
    assert.deepEqual(s.consent, []);

    // the dial: same setDial as `raph auto` — set, verify, refuse junk
    const set = await (await post('/api/auto', { level: 'standard', cap: 25 })).json();
    assert.equal(set.level, 'standard');
    assert.equal(set.cap, 25);
    s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.autoApprove.level, 'standard');
    assert.equal(s.autoApprove.cap, 25);
    assert.equal((await post('/api/auto', { level: 'yolo' })).status, 400);
    assert.equal((await post('/api/auto', { cap: -3 })).status, 400);

    // consent registry: same setProjectConsent `raph mine` records
    await post('/api/consent', { project: 'C:\\fake\\projectA', consent: true });
    s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.consent.length, 1);
    assert.equal(s.consent[0].consent, true);
    await post('/api/consent', { project: 'C:\\fake\\projectA', consent: false });
    s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.consent[0].consent, false);
    assert.equal((await post('/api/consent', { project: 'x', consent: 'yes' })).status, 400);

    // guard status is shaped for the launch dir; explicit-path scan finds a
    // planted key (paths are always scanned in full, same rule as the CLI)
    const g = await (await fetch(`${base}/api/guard`, opts())).json();
    assert.equal(typeof g.isRepo, 'boolean');
    assert.ok(Array.isArray(g.allowlist));

    const hot = path.join(home, 'leaky.txt');
    writeFileSync(hot, 'aws_key = "AKIAABCDEFGHIJKLMNOP"\n', 'utf8');
    const found = await (await post('/api/guard/scan', { paths: [hot] })).json();
    assert.equal(found.mode, 'paths');
    assert.equal(found.results.length, 1);
    assert.ok(found.results[0].findings.some((f) => f.type.includes('aws')));

    const clean = path.join(home, 'clean.txt');
    writeFileSync(clean, 'nothing to see here\n', 'utf8');
    const none = await (await post('/api/guard/scan', { paths: [clean] })).json();
    assert.equal(none.results.length, 0);

    assert.equal((await post('/api/guard/hook', {})).status, 400);
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

test('console 14.3 e2e: Company tab data = the exact portfolio + weekly report engines', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  const H = { 'x-raphael-token': token };
  const get = (p) => fetch(`${base}${p}`, { headers: H });
  try {
    const { startProject, checkpoint, parseMilestones } = await import('../src/lib/academy.js');
    startProject('kit', { title: 'Kit', milestones: parseMilestones('M1:A,M2:B') });
    checkpoint('kit', { done: 'M1', tests: 19, lessons: 2, note: 'M1 complete', next: 'ship M2' });
    logEvent({ event: 'injected', project: 'kit', session_id: 's1', tokens: 250, lessons: [] });
    logEvent({ event: 'approved', id: 'x', slug: 'y' });

    // portfolio = readPortfolio verbatim
    const pf = await (await get('/api/portfolio')).json();
    assert.equal(pf.projects.length, 1);
    assert.equal(pf.projects[0].project, 'kit');
    assert.deepEqual(pf.projects[0].milestones, { done: 1, total: 2 });
    assert.equal(pf.projects[0].tests, 19);
    assert.equal(pf.projects[0].lessonsWritten, 2);
    assert.deepEqual(pf.projects[0].recall, { injections: 1, tokens: 250 });
    assert.equal(pf.projects[0].next, 'ship M2');

    // report = readWeekly verbatim; the just-logged events are in this window
    const r = await (await get('/api/report')).json();
    assert.equal(r.window.days, 7);
    assert.equal(r.builds.length, 1);
    assert.equal(r.builds[0].latestNote, 'M1 complete');
    assert.equal(r.brain.approved, 1);
    assert.deepEqual(r.recall, { injections: 1, tokens: 250, sessions: 1, capHits: 0 });
    assert.equal(r.next[0].project, 'kit');

    // custom window + junk refused
    assert.equal((await get('/api/report?days=30')).status, 200);
    assert.equal((await get('/api/report?days=abc')).status, 400);
    assert.equal((await get('/api/report?days=-2')).status, 400);

    // the page ships the Company tab
    const page = await (await get(`/?token=${token}`)).text();
    assert.ok(page.includes('tab-company'));
  } finally {
    server.close();
    cleanup(home);
  }
});

// --- 17.x follow-up: mode switch + contribution toggle live on Settings -----------

test('console settings: /api/auto full couples mode (same applyDial), /api/contribute toggles the grant', async () => {
  const home = sandbox();
  const token = makeToken();
  const { server, port } = await startConsole({ token });
  const base = `http://127.0.0.1:${port}`;
  const opts = (extra = {}) => ({ headers: { 'x-raphael-token': token, 'content-type': 'application/json', ...extra.headers }, ...extra });
  const post = (p, body) => fetch(`${base}${p}`, opts({ method: 'POST', body: JSON.stringify(body) }));
  try {
    // fresh sandbox: curator, sharing not granted
    let s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.mode, 'curator');
    assert.equal(s.contribution.enabled, false);

    // full = autopilot, via the console — the SAME applyDial as `raph auto full`
    const up = await (await post('/api/auto', { level: 'full' })).json();
    assert.equal(up.mode, 'autopilot');
    s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.mode, 'autopilot');
    assert.equal(s.autoApprove.level, 'full');

    // 'manual' steps back down: curator, dial standard
    const down = await (await post('/api/auto', { level: 'manual' })).json();
    assert.equal(down.mode, 'curator');
    assert.equal(down.level, 'standard');

    // the contribution grant: toggle on, verify, toggle off; junk refused
    s = await (await post('/api/contribute', { enabled: true })).json();
    assert.equal(s.contribution.enabled, true);
    s = await (await fetch(`${base}/api/settings`, opts())).json();
    assert.equal(s.contribution.enabled, true);
    s = await (await post('/api/contribute', { enabled: false })).json();
    assert.equal(s.contribution.enabled, false);
    assert.equal((await post('/api/contribute', { enabled: 'yes' })).status, 400);

    // the page ships the new controls
    const page = await (await fetch(`${base}/?token=${token}`, opts())).text();
    assert.ok(page.includes('smode'));
    assert.ok(page.includes('sshare'));
  } finally {
    server.close();
    cleanup(home);
  }
});
