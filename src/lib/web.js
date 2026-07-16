// The local web console's server core (ARCHITECTURE §14). One engine, three
// faces: every route here calls the SAME src/lib functions the CLI calls — the
// web layer holds zero business logic. If a feature has no `raph` verb, this
// server must not offer it.
//
// Security model (§14, non-negotiable):
//   - binds 127.0.0.1 ONLY; never a LAN interface
//   - a per-launch random token guards every request that returns data
//   - Origin and Host headers are checked on every request — ordinary websites
//     CAN fire requests at localhost daemons (CSRF / DNS-rebinding); a foreign
//     Origin or Host is refused before any handler runs
//   - strict CSP, no external assets, nosniff, no-store: everything rendered
//     is untrusted text (mined + adopted content) and is escaped at render time

import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, isInjectionEnabled } from './config.js';
import { dialLevel, dialCaps } from './autoapprove.js';
import { listCandidates, resolveRef, needsConfirmation } from './queue.js';
import { approveRefs, rejectRefs } from './review.js';
import { listAdoptions } from './provenance.js';
import { parseLessonFile } from './frontmatter.js';
import { loadIndex } from './compile.js';
import { computeStats } from './stats.js';
import { p, raphaelHome } from './paths.js';

export const CONSOLE_HOST = '127.0.0.1';

export function makeToken() {
  return randomBytes(16).toString('hex');
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostOf(header) {
  if (!header) return null;
  // Host: "127.0.0.1:4321" (or a bare IPv6 in brackets)
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(String(header).trim());
  return m ? m[1].toLowerCase() : null;
}

// Gate every request. Returns { ok } or { ok: false, code, reason }.
export function checkRequest(req, token) {
  const host = hostOf(req.headers.host);
  if (!host || !LOOPBACK_HOSTS.has(host)) {
    return { ok: false, code: 403, reason: 'foreign Host header refused (DNS-rebinding defense)' };
  }
  const origin = req.headers.origin;
  if (origin) {
    let o;
    try {
      o = new URL(origin);
    } catch {
      return { ok: false, code: 403, reason: 'unparseable Origin refused' };
    }
    if (!LOOPBACK_HOSTS.has(o.hostname.toLowerCase())) {
      return { ok: false, code: 403, reason: 'cross-origin request refused (CSRF defense)' };
    }
  }
  const url = new URL(req.url, `http://${CONSOLE_HOST}`);
  const presented = req.headers['x-raphael-token'] ?? url.searchParams.get('token');
  if (presented !== token) {
    return { ok: false, code: 401, reason: 'missing or wrong session token — start the console with "raph web" and use the printed URL' };
  }
  return { ok: true };
}

// Read a small JSON request body. Mutating routes take arguments this way;
// anything oversized or unparseable is refused before a handler sees it.
const MAX_BODY_BYTES = 64 * 1024;

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('E-WEB-BODY: request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('E-WEB-BODY: request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---- data (thin aggregation over the same lib the CLI uses) -----------------

function countActiveLessons() {
  let total = 0;
  let autoTier = 0;
  const byCategory = {};
  const stack = [p.lessons()];
  while (stack.length) {
    const dir = stack.pop();
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) {
        try {
          const { data } = parseLessonFile(readFileSync(full, 'utf8'));
          total++;
          byCategory[data.category] = (byCategory[data.category] ?? 0) + 1;
          if (data.provenance?.tier === 'auto') autoTier++;
        } catch { /* unreadable lesson — doctor's problem */ }
      }
    }
  }
  return { total, autoTier, byCategory };
}

export function statusSummary() {
  const cfg = loadConfig();
  const lessons = countActiveLessons();
  const queue = listCandidates();
  const adoptions = listAdoptions();
  const pkg = JSON.parse(readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'
  ));
  return {
    version: pkg.version,
    home: raphaelHome(),
    mode: cfg.mode ?? 'curator',
    injectionEnabled: isInjectionEnabled(cfg),
    autoApprove: { level: dialLevel(cfg), ...dialCaps(cfg), autoTier: lessons.autoTier },
    lessons: { active: lessons.total, byCategory: lessons.byCategory },
    queue: {
      pending: queue.length,
      security: queue.filter((i) => i.data.category === 'security').length,
      quarantined: queue.filter((i) => i.quarantined).length
    },
    adoptions: {
      total: adoptions.length,
      blocked: adoptions.filter((a) => a.status === 'blocked').length,
      revoked: adoptions.filter((a) => a.status === 'revoked').length
    }
  };
}

// The review queue as the console renders it. `name` (the candidate file name)
// is the stable ref the buttons send back — queue NUMBERS shift as items leave.
export function queueSummary() {
  return listCandidates().map((item, i) => ({
    n: i + 1,
    ref: item.name,
    id: item.data.id,
    slug: item.data.slug,
    title: item.data.title,
    category: item.data.category,
    severity: item.data.severity,
    quarantined: item.quarantined,
    needsConfirmation: needsConfirmation(item),
    headline: item.data.injection?.headline ?? '',
    lesson: item.data.lesson
  }));
}

// One candidate in full — the console's heavyweight review view renders THIS
// (same completeness as `raph show`): every frontmatter field plus the body.
export function queueItem(ref) {
  const item = resolveRef(listCandidates(), ref);
  return {
    ref: item.name,
    quarantined: item.quarantined,
    needsConfirmation: needsConfirmation(item),
    data: item.data,
    body: item.body
  };
}

// The self-use report, same computation as `raph stats` (Phase 10).
export function statsSummary() {
  const events = [];
  if (existsSync(p.events())) {
    for (const line of readFileSync(p.events(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip a corrupt line */ }
    }
  }
  const { lessons } = loadIndex();
  return computeStats(events, lessons);
}

// ---- render helpers -----------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---- the console page (15.2: dashboard + review queue) -------------------------
// Fully self-contained: no CDN, no external anything (§14). The page reads the
// token from its own URL and sends it as a header on every API call. All page
// JS avoids template literals so this server-side template stays readable.

function shellPage() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raphael console</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 1.5rem auto; max-width: 52rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 1.25rem 0 .5rem; }
  nav { display: flex; gap: .5rem; margin: 1rem 0; border-bottom: 1px solid rgba(127,127,127,.35); }
  nav button { background: none; border: none; border-bottom: 2px solid transparent; padding: .4rem .8rem;
    font: inherit; cursor: pointer; color: inherit; opacity: .75; }
  nav button.on { border-bottom-color: currentColor; opacity: 1; font-weight: 600; }
  .card { border: 1px solid rgba(127,127,127,.35); border-radius: 8px; padding: .8rem 1rem; margin: .6rem 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem; }
  .kpi { font-size: 1.4rem; font-weight: 700; } .kpi small { font-size: .8rem; font-weight: 400; opacity: .7; display: block; }
  .muted { opacity: .7; } .err { color: #c0392b; } .ok { color: #27ae60; }
  .badge { display: inline-block; border-radius: 4px; padding: 0 .45em; font-size: .75rem; font-weight: 600;
    border: 1px solid rgba(127,127,127,.5); margin-right: .35rem; vertical-align: middle; }
  .badge.critical, .badge.security { border-color: #c0392b; color: #c0392b; }
  .badge.high { border-color: #d35400; color: #d35400; }
  .badge.quarantined { border-color: #8e44ad; color: #8e44ad; }
  .row { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .row .title { font-weight: 600; flex: 1; min-width: 12rem; }
  .actions { display: flex; gap: .5rem; margin-top: .5rem; flex-wrap: wrap; align-items: center; }
  button.act { font: inherit; font-size: .85rem; padding: .25rem .7rem; border-radius: 6px; cursor: pointer;
    border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.12); color: inherit; }
  button.act.primary { border-color: #27ae60; }
  button.act.danger { border-color: #c0392b; }
  button.act:disabled { opacity: .45; cursor: not-allowed; }
  input[type=text] { font: inherit; font-size: .85rem; padding: .25rem .5rem; border-radius: 6px;
    border: 1px solid rgba(127,127,127,.5); background: transparent; color: inherit; }
  pre { background: rgba(127,127,127,.12); border-radius: 6px; padding: .6rem .8rem; overflow-x: auto;
    font-size: .8rem; white-space: pre-wrap; word-break: break-word; }
  .full { border-top: 1px dashed rgba(127,127,127,.4); margin-top: .6rem; padding-top: .6rem; }
  .confirmrow { border: 1px solid #c0392b; border-radius: 6px; padding: .5rem .7rem; margin-top: .5rem; }
  #msg { position: sticky; top: 0; z-index: 2; }
  #msg .card { background: Canvas; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  code { background: rgba(127,127,127,.15); padding: .1em .3em; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  td, th { text-align: left; padding: .2rem .5rem .2rem 0; vertical-align: top; }
</style>
<h1>Raphael console</h1>
<div class="muted" id="sub">your brain, locally — every button here calls the same engine as the CLI</div>
<div id="msg"></div>
<nav>
  <button id="tab-dash" class="on">Dashboard</button>
  <button id="tab-queue">Review queue</button>
</nav>
<div id="view" class="card">loading…</div>
<script>
'use strict';
var token = new URLSearchParams(location.search).get('token');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'x-raphael-token': token }, opts.headers || {});
  return fetch(path, opts).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    });
  });
}
var view = document.getElementById('view');
var msg = document.getElementById('msg');
var tab = 'dash';

function flash(lines, isErr) {
  msg.innerHTML = '<div class="card ' + (isErr ? 'err' : 'ok') + '">' +
    lines.map(function (l) { return esc(l); }).join('<br>') + '</div>';
  setTimeout(function () { msg.innerHTML = ''; }, 6000);
}
function setTab(t) {
  tab = t;
  document.getElementById('tab-dash').className = t === 'dash' ? 'on' : '';
  document.getElementById('tab-queue').className = t === 'queue' ? 'on' : '';
  render();
}
document.getElementById('tab-dash').onclick = function () { setTab('dash'); };
document.getElementById('tab-queue').onclick = function () { setTab('queue'); };

// ---- dashboard ----
function renderDash() {
  Promise.all([api('/api/status'), api('/api/stats')]).then(function (rs) {
    var s = rs[0], st = rs[1];
    var cats = Object.keys(s.lessons.byCategory).sort().map(function (c) {
      return esc(c) + ' ' + esc(s.lessons.byCategory[c]);
    }).join(' · ') || 'none yet';
    var h = '<div class="grid">' +
      '<div class="card"><div class="kpi">' + esc(s.lessons.active) + '<small>active lessons (' + esc(s.autoApprove.autoTier) + ' auto-tier)</small></div></div>' +
      '<div class="card"><div class="kpi">' + esc(s.queue.pending) + '<small>in review queue (' + esc(s.queue.security) + ' security, ' + esc(s.queue.quarantined) + ' quarantined)</small></div></div>' +
      '<div class="card"><div class="kpi">' + esc(st.injections.total) + '<small>injections · ' + esc(st.injections.tokensTotal) + ' tokens recalled</small></div></div>' +
      '<div class="card"><div class="kpi">' + esc(s.adoptions.total) + '<small>adoptions (' + esc(s.adoptions.blocked) + ' blocked, ' + esc(s.adoptions.revoked) + ' revoked)</small></div></div>' +
      '</div>' +
      '<h2>Brain</h2><table>' +
      '<tr><th>Home</th><td>' + esc(s.home) + '</td></tr>' +
      '<tr><th>Version</th><td>' + esc(s.version) + ' · mode ' + esc(s.mode) + '</td></tr>' +
      '<tr><th>Injection</th><td>' + (s.injectionEnabled ? 'on' : 'off') + '</td></tr>' +
      '<tr><th>Auto-approve</th><td>' + esc(s.autoApprove.level) + ' (cap ' + esc(s.autoApprove.cap) + ', daily ' + esc(s.autoApprove.dailyCap) + ') — security always needs a human</td></tr>' +
      '<tr><th>By category</th><td>' + cats + '</td></tr>' +
      '</table>' +
      '<h2>Self-use (raph stats)</h2><table>' +
      '<tr><th>Review funnel</th><td>' + esc(st.review.approved) + ' approved · ' + esc(st.review.rejected) + ' rejected · ' + esc(st.review.suppressed) + ' auto-suppressed</td></tr>' +
      '<tr><th>Lessons fired</th><td>' + esc(st.lessons.firedCount) + ' of ' + esc(st.lessons.active) + ' active</td></tr>' +
      '<tr><th>Never fired</th><td>' + esc(st.lessons.neverFired.length) + ' (retrieval-miss watchlist)</td></tr>' +
      '</table>';
    view.innerHTML = h;
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

// ---- review queue ----
function badge(text, cls) { return '<span class="badge ' + esc(cls || text) + '">' + esc(text) + '</span>'; }

function renderQueue() {
  api('/api/queue').then(function (q) {
    var items = q.items;
    if (!items.length) {
      view.innerHTML = '<p class="muted">The review queue is empty — nothing waiting on you.</p>';
      return;
    }
    var h = '<div class="actions"><button class="act primary" id="batch-approve">Approve selected</button>' +
      '<button class="act danger" id="batch-reject">Reject selected</button>' +
      '<input type="text" id="batch-reason" placeholder="reject reason (optional)" size="28">' +
      '<span class="muted">security / quarantined items have no checkbox — they are reviewed one at a time</span></div>';
    items.forEach(function (it) {
      h += '<div class="card" data-ref="' + esc(it.ref) + '">' +
        '<div class="row">' +
        (it.needsConfirmation
          ? '<span class="muted" title="one-at-a-time review">&#128274;</span>'
          : '<input type="checkbox" class="pick" value="' + esc(it.ref) + '">') +
        '<span class="title">' + esc(it.title) + '</span>' +
        badge(it.severity) + badge(it.category) + (it.quarantined ? badge('quarantined') : '') +
        '</div>' +
        '<div class="muted">' + esc(it.headline || it.lesson) + '</div>' +
        '<div class="actions">' +
        (it.needsConfirmation
          ? '<button class="act" data-review="' + esc(it.ref) + '">Review to approve</button>'
          : '<button class="act primary" data-approve="' + esc(it.ref) + '">Approve</button>') +
        '<button class="act danger" data-reject="' + esc(it.ref) + '">Reject</button>' +
        '<button class="act" data-show="' + esc(it.ref) + '">Full text</button>' +
        '<span class="muted">' + esc(it.slug) + '</span>' +
        '</div><div class="full" hidden></div></div>';
    });
    view.innerHTML = h;

    document.getElementById('batch-approve').onclick = function () {
      var refs = picked();
      if (!refs.length) return flash(['select at least one candidate first'], true);
      post('/api/approve', { refs: refs });
    };
    document.getElementById('batch-reject').onclick = function () {
      var refs = picked();
      if (!refs.length) return flash(['select at least one candidate first'], true);
      post('/api/reject', { refs: refs, reason: document.getElementById('batch-reason').value || undefined });
    };
    view.querySelectorAll('[data-approve]').forEach(function (b) {
      b.onclick = function () { post('/api/approve', { refs: [b.dataset.approve] }); };
    });
    view.querySelectorAll('[data-reject]').forEach(function (b) {
      b.onclick = function () {
        var reason = prompt('Reject reason (optional — feeds the 180-day auto-suppress memory):') || undefined;
        post('/api/reject', { refs: [b.dataset.reject], reason: reason });
      };
    });
    view.querySelectorAll('[data-show]').forEach(function (b) {
      b.onclick = function () { expand(b.dataset.show, false); };
    });
    view.querySelectorAll('[data-review]').forEach(function (b) {
      b.onclick = function () { expand(b.dataset.review, true); };
    });
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}
function picked() {
  return Array.prototype.map.call(view.querySelectorAll('.pick:checked'), function (c) { return c.value; });
}
function post(path, body) {
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) {
      var lines = r.results.map(function (x) { return x.message; });
      flash(lines, r.failed > 0);
      render();
    })
    .catch(function (e) { flash([e.message], true); });
}
// The heavyweight path: render the ENTIRE candidate (every frontmatter field +
// body), and only after an explicit "I read it" check does Approve unlock.
// Mirrors "raph show" + "raph approve --confirmed", one item at a time.
function expand(ref, withConfirm) {
  var card = view.querySelector('[data-ref="' + ref + '"] .full');
  if (!card) return;
  if (!card.hidden && !withConfirm) { card.hidden = true; return; }
  api('/api/queue/item?ref=' + encodeURIComponent(ref)).then(function (it) {
    var h = '<pre>' + esc(JSON.stringify(it.data, null, 2)) + '</pre>';
    if (it.body && it.body.trim()) h += '<pre>' + esc(it.body) + '</pre>';
    if (withConfirm) {
      h += '<div class="confirmrow"><label><input type="checkbox" id="readit-' + esc(ref) + '"> ' +
        'I read the full ' + (it.quarantined ? 'quarantined' : 'security') + ' candidate above</label> ' +
        '<button class="act primary" id="confirm-' + esc(ref) + '" disabled>Approve --confirmed</button></div>';
    }
    card.innerHTML = h;
    card.hidden = false;
    if (withConfirm) {
      var box = document.getElementById('readit-' + ref);
      var btn = document.getElementById('confirm-' + ref);
      box.onchange = function () { btn.disabled = !box.checked; };
      btn.onclick = function () { post('/api/approve', { refs: [ref], confirmed: true }); };
    }
  }).catch(function (e) { flash([e.message], true); });
}

function render() { if (tab === 'dash') renderDash(); else renderQueue(); }
render();
</script>`;
}

function guardPage() {
  return `<!doctype html><meta charset="utf-8"><title>Raphael console</title>
<p style="font-family:system-ui;max-width:40rem;margin:3rem auto">This console is token-guarded.
Start it with <code>raph web</code> and open the exact URL it prints (the token is in it).</p>`;
}

// ---- the server --------------------------------------------------------------

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
};
const HTML_HEADERS = {
  ...BASE_HEADERS,
  'content-type': 'text/html; charset=utf-8',
  // inline-only by design: nothing external can load, nothing can connect out
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"
};
const JSON_HEADERS = { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' };

function sendJson(res, code, obj) {
  res.writeHead(code, JSON_HEADERS);
  res.end(JSON.stringify(obj));
}

async function handle(req, res, token) {
  const url = new URL(req.url, `http://${CONSOLE_HOST}`);

  const gate = checkRequest(req, token);
  if (!gate.ok) {
    if (gate.code === 401 && url.pathname === '/' && req.method === 'GET') {
      res.writeHead(401, HTML_HEADERS);
      res.end(guardPage());
      return;
    }
    sendJson(res, gate.code, { error: gate.reason });
    return;
  }

  if (req.method === 'GET') {
    if (url.pathname === '/') {
      res.writeHead(200, HTML_HEADERS);
      res.end(shellPage());
      return;
    }
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/api/status') return sendJson(res, 200, statusSummary());
    if (url.pathname === '/api/stats') return sendJson(res, 200, statsSummary());
    if (url.pathname === '/api/queue') return sendJson(res, 200, { items: queueSummary() });
    if (url.pathname === '/api/queue/item') {
      const ref = url.searchParams.get('ref');
      if (!ref) return sendJson(res, 400, { error: 'E-WEB: ?ref= is required' });
      try {
        return sendJson(res, 200, queueItem(ref));
      } catch (err) {
        return sendJson(res, 404, { error: err.message });
      }
    }
  }

  if (req.method === 'POST') {
    // Mutations go through the SAME engine as `raph approve` / `raph reject` —
    // including the no-batch + --confirmed rules for security/quarantined,
    // which live in review.js, not here.
    if (url.pathname === '/api/approve' || url.pathname === '/api/reject') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const refs = Array.isArray(body.refs) ? body.refs.filter((r) => typeof r === 'string' && r.trim()) : [];
      if (refs.length === 0) return sendJson(res, 400, { error: 'E-WEB: body.refs must be a non-empty array of candidate refs' });
      if (url.pathname === '/api/approve') {
        return sendJson(res, 200, approveRefs(refs, { confirmed: body.confirmed === true }));
      }
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
      return sendJson(res, 200, rejectRefs(refs, { reason }));
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

export function createConsoleServer({ token }) {
  if (!token) throw new Error('E-WEB: a session token is required');

  return http.createServer((req, res) => {
    handle(req, res, token).catch((err) => {
      try {
        sendJson(res, 500, { error: String(err.message ?? err) });
      } catch { /* response already gone */ }
    });
  });
}

// Listen on loopback with an OS-assigned (or requested) port.
export function startConsole({ token, port = 0 }) {
  const server = createConsoleServer({ token });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, CONSOLE_HOST, () => {
      resolve({ server, port: server.address().port, url: `http://${CONSOLE_HOST}:${server.address().port}/?token=${token}` });
    });
  });
}
