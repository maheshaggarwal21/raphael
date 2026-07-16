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
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, isInjectionEnabled } from './config.js';
import { dialLevel, dialCaps, countAutoTier } from './autoapprove.js';
import { listCandidates } from './queue.js';
import { listAdoptions } from './provenance.js';
import { parseLessonFile } from './frontmatter.js';
import { existsSync, readdirSync } from 'node:fs';
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

// ---- the shell (15.1: a guarded skeleton page; real pages land in 15.2+) ----

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shellPage() {
  // fully self-contained: no CDN, no external anything (§14). The page reads
  // the token from its own URL and sends it as a header on every API call.
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raphael console</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 2rem auto; max-width: 46rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; } code { background: rgba(127,127,127,.15); padding: .1em .3em; border-radius: 4px; }
  .card { border: 1px solid rgba(127,127,127,.35); border-radius: 8px; padding: 1rem; margin: .75rem 0; }
  .muted { opacity: .7; } .err { color: #c0392b; }
  dt { font-weight: 600; } dd { margin: 0 0 .5rem 0; }
</style>
<h1>Raphael console <span class="muted">(skeleton)</span></h1>
<div id="out" class="card">loading…</div>
<script>
  const token = new URLSearchParams(location.search).get('token');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/api/status', { headers: { 'x-raphael-token': token } })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((s) => {
      document.getElementById('out').innerHTML =
        '<dl>' +
        '<dt>Brain</dt><dd>' + esc(s.home) + ' · mode ' + esc(s.mode) + ' · v' + esc(s.version) + '</dd>' +
        '<dt>Lessons</dt><dd>' + esc(s.lessons.active) + ' active (' + esc(s.autoApprove.autoTier) + ' auto-tier)</dd>' +
        '<dt>Review queue</dt><dd>' + esc(s.queue.pending) + ' pending (' + esc(s.queue.security) + ' security, ' + esc(s.queue.quarantined) + ' quarantined)</dd>' +
        '<dt>Adoptions</dt><dd>' + esc(s.adoptions.total) + ' total · ' + esc(s.adoptions.blocked) + ' blocked · ' + esc(s.adoptions.revoked) + ' revoked</dd>' +
        '<dt>Auto-approve</dt><dd>' + esc(s.autoApprove.level) + ' (cap ' + esc(s.autoApprove.cap) + ', daily ' + esc(s.autoApprove.dailyCap) + ')</dd>' +
        '<dt>Injection</dt><dd>' + (s.injectionEnabled ? 'on' : 'off') + '</dd>' +
        '</dl><p class="muted">Dashboard, review queue, and the adopt inbox land in the next milestones.</p>';
    })
    .catch((e) => { document.getElementById('out').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
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

export function createConsoleServer({ token }) {
  if (!token) throw new Error('E-WEB: a session token is required');

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${CONSOLE_HOST}`);

    const gate = checkRequest(req, token);
    if (!gate.ok) {
      if (gate.code === 401 && url.pathname === '/' && req.method === 'GET') {
        res.writeHead(401, HTML_HEADERS);
        res.end(guardPage());
        return;
      }
      res.writeHead(gate.code, JSON_HEADERS);
      res.end(JSON.stringify({ error: gate.reason }));
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, HTML_HEADERS);
        res.end(shellPage());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify(statusSummary()));
        return;
      }
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: String(err.message ?? err) }));
    }
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
