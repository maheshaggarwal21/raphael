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
import { loadConfig, saveConfig, isInjectionEnabled, setInjectionEnabled, setProjectConsent, getMode } from './config.js';
import { dialLevel, dialCaps, applyDial, countAutoTier, autoApproveStaged, DIAL_LEVELS } from './autoapprove.js';
import { contributionEnabled, setContribution, listBundles, eligibleForBundle } from './contribute.js';
import { scanTracked, scanFile, hookStatus, installPreCommitHook, uninstallPreCommitHook, loadAllowlist, gitTopLevel, ALLOWLIST_FILE } from './guard.js';
import { listCandidates, resolveRef, needsConfirmation } from './queue.js';
import { approveRefs, rejectRefs } from './review.js';
import { listAdoptions } from './provenance.js';
import { loadSource, adoptSource, revokeAdoption, adoptConfig, estimateAdoptTokens } from './adopt.js';
import { getModelCaller } from './provider.js';
import { scrubSecrets } from './scrub.js';
import { parseLessonFile } from './frontmatter.js';
import { readEvents } from './events.js';
import { readPortfolio } from './portfolio.js';
import { readWeekly, DEFAULT_DAYS } from './report.js';
import { loadIndex } from './compile.js';
import { computeStats } from './stats.js';
import { rank, extractPaths } from './match.js';
import { detectStacks } from './stacks.js';
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
  const { lessons } = loadIndex();
  return computeStats(readEvents(), lessons);
}

// Lessons browser data. With a query it runs the EXACT scorer the hooks and
// `raph search` use (same threshold); without one it lists the whole index.
export function lessonsView(q, { audience } = {}) {
  const { lessons } = loadIndex();
  if (!q || !q.trim()) {
    return lessons.map((l) => ({
      id: l.id, slug: l.slug, title: l.title, category: l.category,
      severity: l.severity, headline: l.injection?.headline ?? l.title
    }));
  }
  const ctx = {
    text: q,
    paths: extractPaths(q),
    stacks: detectStacks(process.cwd()),
    project: path.basename(process.cwd()),
    agent: audience || undefined,
    injected: new Set()
  };
  return rank(lessons, ctx, 0.5).map((r) => ({
    id: r.entry.id, slug: r.entry.slug, title: r.entry.title,
    category: r.entry.category, severity: r.entry.severity,
    headline: r.entry.injection?.headline ?? r.entry.title,
    score: Number(r.score.toFixed(2)), reasons: r.reasons
  }));
}

// One ACTIVE lesson in full (the browser's detail view = `raph show` for
// active lessons): every frontmatter field plus the body.
export function lessonItem(ref) {
  const stack = [p.lessons()];
  while (stack.length) {
    const dir = stack.pop();
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) {
        try {
          const { data, body } = parseLessonFile(readFileSync(full, 'utf8'));
          if (data.slug === ref || data.id === ref) return { data, body };
        } catch { /* unreadable lesson — doctor's problem */ }
      }
    }
  }
  throw new Error(`E-NOTFOUND: no active lesson "${ref}"`);
}

// The last N injections, exactly what `raph why` prints (audit-log truth).
export function whySummary(last = 10) {
  const injections = readEvents().filter((e) => e.event === 'injected');
  return { total: injections.length, shown: injections.slice(-Math.max(1, last)) };
}

// Activity feed: the newest N audit-log events, newest first.
export function eventsFeed(limit = 50) {
  return readEvents().slice(-Math.max(1, limit)).reverse();
}

// Settings page data: the dial, the injection switch, and the consent registry
// — all read through the same config the CLI reads.
export function settingsView() {
  const cfg = loadConfig();
  return {
    mode: getMode(cfg),
    autoApprove: { level: dialLevel(cfg), ...dialCaps(cfg), autoTier: countAutoTier(), levels: DIAL_LEVELS },
    injectionEnabled: isInjectionEnabled(cfg),
    modelProvider: cfg.model?.provider ?? 'auto',
    contribution: {
      enabled: contributionEnabled(cfg),
      granted: cfg.contribute?.granted ?? null,
      stagedBundles: listBundles().length,
      eligible: contributionEnabled(cfg) ? eligibleForBundle().length : 0
    },
    consent: Object.entries(cfg.projects ?? {}).map(([project, v]) => ({
      project, consent: v?.consent === true, registered: v?.registered ?? null
    }))
  };
}

// Guard page data for the directory `raph web` was launched from — the same
// repo `raph guard scan` would act on there.
export function guardView() {
  const cwd = process.cwd();
  const hook = hookStatus(cwd);
  return {
    dir: cwd,
    isRepo: hook.isRepo,
    hookInstalled: hook.installed,
    foreignHook: hook.foreign === true,
    allowlistFile: ALLOWLIST_FILE,
    // patterns only — the scan itself runs on demand (it reads every tracked file)
    allowlist: hook.isRepo ? loadAllowlist(gitTopLevel(cwd) || cwd).patterns : []
  };
}

// The provenance ledger for display. Reviewer summaries/risks derive from
// EXTERNAL material, so everything passes the scrubber again before rendering
// (defense in depth — the pipeline scrubbed the material, not the verdict).
export function adoptionsView() {
  return listAdoptions().map((a) => JSON.parse(scrubSecrets(JSON.stringify(a)).text));
}

// A full adopt run for the console's inbox — the SAME pipeline as `raph adopt`
// (provider, gauntlet, dial), with log lines captured for the result card.
export async function runAdopt({ src, dryRun = false, skill = false }) {
  const kindHint = skill ? 'skill' : null;
  const cfg = loadConfig();
  const config = adoptConfig(cfg);

  if (dryRun) {
    const material = await loadSource(src, { kindHint });
    return {
      outcome: 'dry-run',
      kind: material.kind,
      source: material.source,
      chars: material.text.length,
      truncated: material.truncated ?? false,
      license: material.license,
      estimateTokens: estimateAdoptTokens(material),
      model: config.adopt_model
    };
  }

  const log = [];
  const provider = getModelCaller(cfg);
  log.push(`MODEL provider=${provider.provider} (${provider.reason})`);
  const result = await adoptSource(src, { callModel: provider.callModel, config, log: (s) => log.push(s), kindHint });

  if (result.outcome === 'blocked') {
    return { outcome: 'blocked', adoption: result.adoption, verdict: JSON.parse(scrubSecrets(JSON.stringify(result.verdict)).text), log };
  }

  // the dial at 'wide' may activate reviewer-passed, non-security adoptions
  let autoActivated = 0;
  const eligible = result.staged.filter((s) => !s.quarantined);
  if (eligible.length > 0) {
    const auto = autoApproveStaged(eligible, { origin: 'adopted', config: cfg, adoption: result.adoption, log: (s) => log.push(s) });
    autoActivated = auto.activated.length;
    for (const sk of auto.skipped) log.push(`[held] ${sk.slug} — ${sk.why}`);
  }
  return {
    outcome: 'adopted',
    adoption: result.adoption,
    truncated: result.truncated ?? false,
    staged: result.staged.map((s) => ({ slug: s.slug, quarantined: !!s.quarantined })),
    skills: result.skills,
    dropped: result.dropped,
    autoActivated,
    log
  };
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
  <button id="tab-lessons">Lessons</button>
  <button id="tab-adopt">Adopt</button>
  <button id="tab-activity">Activity</button>
  <button id="tab-company">Company</button>
  <button id="tab-guard">Guard</button>
  <button id="tab-settings">Settings</button>
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
var TABS = ['dash', 'queue', 'lessons', 'adopt', 'activity', 'company', 'guard', 'settings'];

function flash(lines, isErr) {
  msg.innerHTML = '<div class="card ' + (isErr ? 'err' : 'ok') + '">' +
    lines.map(function (l) { return esc(l); }).join('<br>') + '</div>';
  setTimeout(function () { msg.innerHTML = ''; }, 6000);
}
function setTab(t) {
  tab = t;
  TABS.forEach(function (x) {
    document.getElementById('tab-' + x).className = t === x ? 'on' : '';
  });
  render();
}
TABS.forEach(function (x) {
  document.getElementById('tab-' + x).onclick = function () { setTab(x); };
});

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
      '<tr><th>Auto-approve</th><td>' + esc(s.autoApprove.level) + ' (cap ' + esc(s.autoApprove.cap) + ', daily ' + esc(s.autoApprove.dailyCap) + ') — ' + (s.mode === 'autopilot' ? 'security activates via the machine curator; quarantined content never does' : 'security always needs a human') + '</td></tr>' +
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

// ---- lessons browser ----
function renderLessons() {
  api('/api/status').then(function (s) {
    var h = '<div class="actions">' +
      '<input type="text" id="lq" placeholder="search the way the hooks rank" size="34">' +
      '<button class="act" id="lsearch">Search</button>' +
      '<button class="act" id="lall">All lessons</button>' +
      '<button class="act ' + (s.injectionEnabled ? 'danger' : 'primary') + '" id="ltoggle">' +
      (s.injectionEnabled ? 'Turn injection OFF' : 'Turn injection ON') + '</button>' +
      '</div><div id="lres" class="muted">…</div><h2>Recent injections (raph why)</h2><div id="lwhy" class="muted">…</div>';
    view.innerHTML = h;
    document.getElementById('lsearch').onclick = function () { loadLessons(document.getElementById('lq').value); };
    document.getElementById('lq').onkeydown = function (e) { if (e.key === 'Enter') loadLessons(document.getElementById('lq').value); };
    document.getElementById('lall').onclick = function () { loadLessons(''); };
    document.getElementById('ltoggle').onclick = function () {
      api('/api/injection', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !s.injectionEnabled }) })
        .then(function () { flash(['injection turned ' + (s.injectionEnabled ? 'OFF' : 'ON')]); renderLessons(); })
        .catch(function (e) { flash([e.message], true); });
    };
    loadLessons('');
    api('/api/why?last=10').then(function (w) {
      if (!w.shown.length) { document.getElementById('lwhy').textContent = 'no injections recorded yet'; return; }
      var rows = w.shown.map(function (e) {
        var ls = (e.lessons || []).map(function (l) { return esc(l.slug) + ' (' + esc(l.score) + ')'; }).join(', ');
        return '<div>' + esc((e.ts || '').slice(0, 16)) + ' · ' + esc(e.hook) + ' · ~' + esc(e.tokens) + ' tokens · ' + ls + '</div>';
      });
      document.getElementById('lwhy').innerHTML = rows.join('');
    });
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}
function loadLessons(q) {
  var box = document.getElementById('lres');
  box.textContent = 'loading…';
  api('/api/lessons' + (q && q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '')).then(function (r) {
    if (!r.items.length) { box.innerHTML = '<p class="muted">no matches</p>'; return; }
    var h = '';
    r.items.forEach(function (it) {
      h += '<div class="card" data-slug="' + esc(it.slug) + '">' +
        '<div class="row"><span class="title">' + esc(it.title) + '</span>' +
        badge(it.severity) + badge(it.category) +
        (it.score != null ? '<span class="muted">score ' + esc(it.score) + '</span>' : '') + '</div>' +
        '<div class="muted">' + esc(it.headline) + '</div>' +
        (it.reasons ? '<div class="muted">matched: ' + esc(it.reasons.join(', ')) + '</div>' : '') +
        '<div class="actions"><button class="act" data-lshow="' + esc(it.slug) + '">Full text</button>' +
        '<span class="muted">' + esc(it.slug) + '</span></div><div class="full" hidden></div></div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('[data-lshow]').forEach(function (b) {
      b.onclick = function () {
        var card = box.querySelector('[data-slug="' + b.dataset.lshow + '"] .full');
        if (!card.hidden) { card.hidden = true; return; }
        api('/api/lessons/item?ref=' + encodeURIComponent(b.dataset.lshow)).then(function (it) {
          var h2 = '<pre>' + esc(JSON.stringify(it.data, null, 2)) + '</pre>';
          if (it.body && it.body.trim()) h2 += '<pre>' + esc(it.body) + '</pre>';
          card.innerHTML = h2;
          card.hidden = false;
        }).catch(function (e) { flash([e.message], true); });
      };
    });
  }).catch(function (e) { box.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

// ---- adopt inbox ----
function renderAdopt() {
  var h = '<div class="actions">' +
    '<input type="text" id="asrc" placeholder="https url, file path, repo dir, or SKILL.md" size="42">' +
    '<label><input type="checkbox" id="askill"> skill file</label>' +
    '<button class="act" id="adry">Dry run</button>' +
    '<button class="act primary" id="ago">Adopt</button></div>' +
    '<p class="muted">Read-only, user-initiated fetch: https GET, no credentials, size/time capped — ' +
    'content is scanned, never executed. The gauntlet stages candidates for YOUR review; ' +
    'security lessons always wait for a human.</p>' +
    '<div id="ares"></div><h2>Adoption history</h2><div id="ahist" class="muted">…</div>';
  view.innerHTML = h;
  var busy = false;
  function run(dry) {
    var src = document.getElementById('asrc').value.trim();
    if (!src) return flash(['enter a URL or path first'], true);
    if (busy) return;
    busy = true;
    var ares = document.getElementById('ares');
    ares.innerHTML = '<div class="card muted">' + (dry ? 'reading + license check…' :
      'running the six-layer gauntlet — model review + extraction can take a few minutes…') + '</div>';
    api('/api/adopt', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ src: src, dryRun: dry, skill: document.getElementById('askill').checked }) })
      .then(function (r) {
        busy = false;
        if (r.outcome === 'dry-run') {
          ares.innerHTML = '<div class="card"><b>PLAN</b> ' + esc(r.kind) + ': ' + esc(r.source) +
            '<br>' + esc(r.chars) + ' chars' + (r.truncated ? ' (truncated at the adopt cap)' : '') +
            ' -> ~' + esc(Math.round(r.estimateTokens / 100) / 10) + 'k tokens on ' + esc(r.model) +
            '<br>license: ' + esc(r.license && r.license.detected ? r.license.id + ' (' + r.license.family + ')' : 'unknown') +
            '<br><span class="muted">dry run — no model calls, nothing written</span></div>';
          return;
        }
        if (r.outcome === 'blocked') {
          var risks = (r.verdict.risks || []).map(function (x) { return '[' + esc(x.kind) + '] ' + esc(x.detail); }).join('<br>');
          ares.innerHTML = '<div class="card err"><b>BLOCKED</b> ' + esc(r.adoption) + ' — ' + esc(r.verdict.summary) +
            (risks ? '<br>' + risks : '') + '<br><span class="muted">nothing was staged; the block is recorded below</span></div>';
          loadAdoptions();
          return;
        }
        var lines = ['ADOPTED ' + r.adoption,
          'FUNNEL ' + r.staged.length + ' lesson candidate(s) staged, ' + r.skills.length + ' skill draft(s), ' + r.dropped.length + ' dropped'];
        r.dropped.forEach(function (d) { lines.push('[dropped] ' + d.title + ' — ' + d.why); });
        if (r.autoActivated > 0) lines.push('AUTO ' + r.autoActivated + ' activated into the auto tier (undo: revoke below)');
        if (r.staged.length - r.autoActivated > 0) lines.push('NEXT review them in the Review queue tab — nothing activates without approval');
        if (r.skills.length > 0) lines.push('DRAFTS staged/skills/ — a skill instructs agents; review before installing');
        ares.innerHTML = '<div class="card ok">' + lines.map(esc).join('<br>') + '</div>' +
          '<pre>' + esc((r.log || []).join('\\n')) + '</pre>';
        loadAdoptions();
      })
      .catch(function (e) { busy = false; ares.innerHTML = '<div class="card err">' + esc(e.message) + '</div>'; });
  }
  document.getElementById('adry').onclick = function () { run(true); };
  document.getElementById('ago').onclick = function () { run(false); };
  loadAdoptions();
}
function loadAdoptions() {
  api('/api/adoptions').then(function (r) {
    var box = document.getElementById('ahist');
    if (!box) return;
    if (!r.items.length) { box.textContent = 'no adoptions yet'; return; }
    var h = '';
    r.items.forEach(function (a) {
      var lessons = (a.taken || []).filter(function (t) { return t.type === 'lesson'; }).length;
      var skills = (a.taken || []).filter(function (t) { return t.type === 'skill-draft'; }).length;
      h += '<div class="card"><div class="row">' +
        badge(a.status, a.status === 'blocked' || a.status === 'revoked' ? 'critical' : 'ok') +
        '<span class="title">' + esc(a.source) + '</span><span class="muted">' + esc(a.kind) + '</span></div>' +
        '<div class="muted">' + esc((a.ts || '').slice(0, 16)) + ' · license ' +
        esc(a.license && a.license.detected ? a.license.id : 'unknown') + ' · ' +
        lessons + ' lesson(s), ' + skills + ' skill draft(s)</div>' +
        (a.status === 'adopted'
          ? '<div class="actions"><button class="act danger" data-revoke="' + esc(a.id) + '">Revoke (undo everything)</button></div>'
          : '') + '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('[data-revoke]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Revoke this adoption? Staged candidates are removed and activated lessons retired. The ledger keeps the history.')) return;
        api('/api/adopt/revoke', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ref: b.dataset.revoke }) })
          .then(function (r2) { flash(['REVOKED ' + r2.adoption + ' — ' + (r2.removed ? r2.removed.length : 0) + ' item(s) undone']); loadAdoptions(); })
          .catch(function (e) { flash([e.message], true); });
      };
    });
  }).catch(function (e) { flash([e.message], true); });
}

// ---- activity feed ----
function renderActivity() {
  api('/api/events?limit=100').then(function (r) {
    if (!r.items.length) { view.innerHTML = '<p class="muted">nothing in the audit log yet</p>'; return; }
    var h = '<table>';
    r.items.forEach(function (e) {
      var what = e.slug || e.adoption || e.source || (e.lessons && e.lessons.length ? e.lessons.length + ' lesson(s)' : '') || '';
      var extra = [];
      if (e.reason) extra.push('reason: ' + e.reason);
      if (e.tokens != null) extra.push('~' + e.tokens + ' tokens');
      if (e.hook) extra.push(e.hook);
      if (e.origin) extra.push(e.origin);
      h += '<tr><td class="muted">' + esc((e.ts || '').slice(0, 16)) + '</td>' +
        '<td><b>' + esc(e.event) + '</b></td><td>' + esc(String(what)) + '</td>' +
        '<td class="muted">' + esc(extra.join(' · ')) + '</td></tr>';
    });
    view.innerHTML = h + '</table>';
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

// ---- guard page ----
function renderGuard() {
  api('/api/guard').then(function (g) {
    if (!g.isRepo) {
      view.innerHTML = '<p class="muted">' + esc(g.dir) + ' is not a git repository — the guard is per-repo. ' +
        'Start the console from a project directory to scan it.</p>';
      return;
    }
    var hookLine = g.hookInstalled ? '<span class="ok">pre-commit guard installed</span>'
      : g.foreignHook ? '<span class="err">a different pre-commit hook is present — raphael leaves it alone (install from the CLI with --force after backing it up)</span>'
      : '<span class="muted">pre-commit guard not installed</span>';
    var h = '<h2>Secret guard — ' + esc(g.dir) + '</h2>' +
      '<div class="card">' + hookLine + '<div class="actions">' +
      (g.hookInstalled
        ? '<button class="act danger" id="ghook" data-install="no">Uninstall hook</button>'
        : (g.foreignHook ? '' : '<button class="act primary" id="ghook" data-install="yes">Install pre-commit hook</button>')) +
      '</div></div>' +
      (g.allowlist.length
        ? '<div class="card"><b>Allowlist active</b> (' + esc(g.allowlistFile) + ') — matching files are skipped:<br>' +
          '<span class="muted">' + g.allowlist.map(esc).join(' · ') + '</span></div>'
        : '<div class="card muted">no ' + esc(g.allowlistFile) + ' allowlist — every tracked file is scanned</div>') +
      '<div class="actions"><button class="act primary" id="gscan">Scan every tracked file</button>' +
      '<label><input type="checkbox" id="gentropy"> include the noisier high-entropy pass</label></div>' +
      '<div id="gres"></div>';
    view.innerHTML = h;
    var hookBtn = document.getElementById('ghook');
    if (hookBtn) hookBtn.onclick = function () {
      api('/api/guard/hook', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install: hookBtn.dataset.install === 'yes' }) })
        .then(function () { flash([hookBtn.dataset.install === 'yes' ? 'guard installed — commits are now scanned' : 'guard removed']); renderGuard(); })
        .catch(function (e) { flash([e.message], true); });
    };
    document.getElementById('gscan').onclick = function () {
      var res = document.getElementById('gres');
      res.innerHTML = '<div class="card muted">scanning every tracked file…</div>';
      api('/api/guard/scan', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entropy: document.getElementById('gentropy').checked }) })
        .then(function (r) {
          if (!r.results.length) { res.innerHTML = '<div class="card ok">clean — no secrets found in tracked files</div>'; return; }
          var rows = '';
          r.results.forEach(function (f) {
            f.findings.forEach(function (x) {
              rows += '<tr><td>' + esc(f.file) + ':' + esc(x.line) + '</td><td>' + esc(x.type) + '</td></tr>';
            });
          });
          res.innerHTML = '<div class="card err"><b>secrets detected</b> — move them to env vars or a secrets manager. ' +
            'Genuine fixtures/detector sources belong in ' + esc('.raphallow') + '.</div><table>' + rows + '</table>';
        })
        .catch(function (e) { res.innerHTML = '<div class="card err">' + esc(e.message) + '</div>'; });
    };
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

// ---- company (portfolio + weekly report; same engines as raph portfolio / raph report weekly) ----
function renderCompany() {
  Promise.all([api('/api/portfolio'), api('/api/report')]).then(function (rs) {
    var pf = rs[0], r = rs[1];
    var h = '<h2>Portfolio (raph portfolio)</h2>';
    if (!pf.projects.length) {
      h += '<div class="card muted">no academy projects yet</div>';
    } else {
      h += '<table><tr><th>project</th><th>status</th><th>prog</th><th>tests</th><th>lessons</th><th>recall</th><th>updated</th></tr>';
      pf.projects.forEach(function (x) {
        h += '<tr><td><b>' + esc(x.project) + '</b></td><td>' + esc(x.status) + '</td>' +
          '<td>' + esc(x.milestones.done + '/' + x.milestones.total) + '</td>' +
          '<td>' + esc(x.tests == null ? '—' : x.tests) + '</td>' +
          '<td>' + esc(x.lessonsWritten == null ? '—' : x.lessonsWritten) + '</td>' +
          '<td>' + esc(x.recall.injections ? x.recall.tokens + ' tok / ' + x.recall.injections + 'x' : '—') + '</td>' +
          '<td>' + esc((x.updated_at || '').slice(0, 10)) + '</td></tr>';
        if (x.boundary) h += '<tr><td></td><td colspan="6" class="err">OWNER: ' + esc(x.boundary) + '</td></tr>';
        if (x.next) h += '<tr><td></td><td colspan="6" class="muted">next: ' + esc(x.next) + '</td></tr>';
      });
      h += '</table><p class="muted">' + esc(pf.totals.projects) + ' project(s) — ' + esc(pf.totals.done) +
        ' done · ' + esc(pf.totals.tests) + ' green tests recorded · ' + esc(pf.totals.lessonsWritten) +
        ' lessons written back · ' + esc(pf.totals.recallTokens) + ' recall tokens spent in builds</p>';
    }

    h += '<h2>Weekly report (raph report weekly)</h2>' +
      '<div class="muted">' + esc(r.window.from.slice(0, 10)) + ' to ' + esc(r.window.to.slice(0, 10)) + '</div>';
    h += '<h3>Build activity</h3><div class="card">';
    if (r.builds.length) {
      r.builds.forEach(function (b) {
        h += '<div class="row"><span class="title">' + esc(b.project) + '</span> [' + esc(b.status) + '] ' +
          esc(b.notesInWindow) + ' checkpoint note(s)' +
          (b.latestNote ? ' <span class="muted">latest: ' + esc(b.latestNote) + '</span>' : '') + '</div>';
      });
    } else { h += '<span class="muted">no academy checkpoints this window</span>'; }
    h += '</div>';

    h += '<h3>Brain changes</h3><div class="card">' +
      'activated ' + esc(r.brain.approved) + ' by hand + ' + esc(r.brain.autoApproved) + ' auto (dial) · ' +
      'rejected ' + esc(r.brain.rejected) + ' (+' + esc(r.brain.suppressed) + ' suppressed) · ' +
      'adopt: ' + esc(r.brain.adopted) + ' run(s), ' + esc(r.brain.adoptBlocked) + ' blocked, ' + esc(r.brain.adoptRevoked) + ' revoked</div>';

    h += '<h3>Recall cost</h3><div class="card">' +
      (r.recall.injections
        ? esc(r.recall.injections) + ' injection(s) across ' + esc(r.recall.sessions) + ' session(s) — ' +
          esc(r.recall.tokens) + ' tokens, ' + esc(r.recall.capHits) + ' cap hit(s)'
        : '<span class="muted">no injections this window</span>') + '</div>';

    h += '<h3>Retrieval miss (all-time)</h3><div class="card">' +
      esc(r.misses.neverFired) + '/' + esc(r.misses.active) + ' active lessons have never fired' +
      (r.misses.sample.length ? ' <span class="muted">e.g. ' + esc(r.misses.sample.join(', ')) + '</span>' : '') + '</div>';

    if (r.adoptions.length) {
      h += '<h3>Adoptions this window</h3><div class="card">';
      r.adoptions.forEach(function (a) {
        h += '<div class="row">' + esc(a.kind) + ' ' + esc(a.status) + ' — ' + esc(a.lessons) +
          ' lesson(s) + ' + esc(a.skills) + ' skill draft(s) <span class="muted">' + esc(a.source) + '</span></div>';
      });
      h += '</div>';
    }

    h += '<h3>Next / waiting on the owner</h3><div class="card">';
    if (r.next.length) {
      r.next.forEach(function (n) {
        h += '<div class="row"><span class="title">' + esc(n.project) + '</span> [' + esc(n.status) + '] ' +
          (n.boundary ? '<span class="err">OWNER: ' + esc(n.boundary) + '</span>' : esc(n.next || '')) + '</div>';
      });
    } else { h += '<span class="muted">all academy projects are done — pick the next build</span>'; }
    h += '</div>';

    view.innerHTML = h;
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

// ---- settings ----
function renderSettings() {
  api('/api/settings').then(function (s) {
    var a = s.autoApprove;
    var onAuto = s.mode === 'autopilot';
    var h = '<h2>Mode (raph auto full / manual)</h2><div class="card">' +
      'Raphael is in <b>' + (onAuto ? 'AUTOPILOT' : 'manual (curator)') + '</b> mode. <span class="muted">' +
      (onAuto
        ? 'After each session it mines, distills, and curates on its own; the machine curator (reviewer screen + canary gate, rollback on failure) approves — security included. Quarantined content never activates.'
        : 'Everything waits in the Review queue for you; security lessons take the heavyweight one-at-a-time confirm path.') +
      '</span><div class="actions"><button class="act primary" id="smode">' +
      (onAuto ? 'Switch to manual — review everything yourself' : 'Switch to autopilot — it runs itself') +
      '</button></div></div>';
    var radios = a.levels.map(function (lv) {
      var desc = lv === 'off' ? 'nothing activates without you (curator default)'
        : lv === 'standard' ? 'your own MINED lessons that pass every gate activate into the capped auto tier'
        : lv === 'wide' ? 'plus ADOPTED lessons that passed the reviewer agent (daily-capped, revocable by source)'
        : 'AUTOPILOT: plus SECURITY lessons via the machine curator (reviewer screen + canary gate + probation) — selecting this switches the mode too';
      return '<label style="display:block;margin:.25rem 0"><input type="radio" name="dial" value="' + esc(lv) + '"' +
        (a.level === lv ? ' checked' : '') + '> <b>' + esc(lv) + '</b> — <span class="muted">' + esc(desc) + '</span></label>';
    }).join('');
    h += '<h2>Auto-approve dial (raph auto)</h2><div class="card">' + radios +
      '<div class="actions">auto-tier cap <input type="text" id="scap" size="5" value="' + esc(a.cap) + '">' +
      'adopted daily cap <input type="text" id="sdaily" size="5" value="' + esc(a.dailyCap) + '">' +
      '<button class="act primary" id="ssave">Save</button>' +
      '<span class="muted">auto tier now: ' + esc(a.autoTier) + '/' + esc(a.cap) + '</span></div>' +
      '<p class="muted">At off/standard/wide, security-category lessons always wait for you (E-AUTOSEC). ' +
      'At full (autopilot) they activate only through the machine curator. Quarantined (injection-suspect) ' +
      'content never machine-activates at ANY level — that floor is enforced in code and is not configurable.</p></div>';
    var c = s.contribution;
    h += '<h2>Community sharing (raph contribute)</h2><div class="card">' +
      'contribution is <b>' + (c.enabled ? 'GRANTED' : 'not granted') + '</b>' +
      (c.enabled && c.granted ? ' <span class="muted">since ' + esc(c.granted) + '</span>' : '') +
      '<div class="muted">' + (c.enabled
        ? 'New local lessons are stripped, re-scrubbed, re-validated, and STAGED as bundles on this machine (' +
          esc(c.stagedBundles) + ' bundle(s) staged, ' + esc(c.eligible) + ' lesson(s) eligible). ' +
          'Sending a bundle is always your own action: raph contribute send.'
        : 'Nothing leaves this machine. Granting only stages scrubbed bundles locally — sending still needs your own click.') +
      '</div><div class="actions"><button class="act" id="sshare">' +
      (c.enabled ? 'Withdraw sharing' : 'Grant sharing') + '</button></div></div>';
    h += '<h2>Injection</h2><div class="card">recall is <b>' + (s.injectionEnabled ? 'ON' : 'OFF') +
      '</b> <span class="muted">(toggle on the Lessons tab, or raph on/off)</span> · model provider: ' + esc(s.modelProvider) + '</div>' +
      '<h2>Mining consent (per project)</h2><div class="card" id="sconsent">' +
      (s.consent.length ? '' : '<span class="muted">no projects registered — "raph mine" registers them with your consent</span>');
    s.consent.forEach(function (c) {
      h += '<div class="row"><span class="title">' + esc(c.project) + '</span>' +
        '<span class="' + (c.consent ? 'ok' : 'err') + '">' + (c.consent ? 'allowed' : 'denied') + '</span>' +
        '<button class="act" data-consent="' + esc(c.project) + '" data-next="' + (c.consent ? 'false' : 'true') + '">' +
        (c.consent ? 'Withdraw consent' : 'Allow mining') + '</button></div>';
    });
    h += '</div>';
    view.innerHTML = h;

    document.getElementById('smode').onclick = function () {
      api('/api/auto', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: onAuto ? 'manual' : 'full' }) })
        .then(function (r) {
          flash(['mode: ' + (r.mode === 'autopilot' ? 'AUTOPILOT — Raphael runs itself after each session' : 'manual (curator) — everything waits for your review')]);
          renderSettings();
        })
        .catch(function (e) { flash([e.message], true); });
    };
    document.getElementById('sshare').onclick = function () {
      api('/api/contribute', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !c.enabled }) })
        .then(function () {
          flash([c.enabled ? 'sharing withdrawn — nothing leaves this machine'
            : 'sharing granted — bundles stage locally; sending is always your click']);
          renderSettings();
        })
        .catch(function (e) { flash([e.message], true); });
    };
    document.getElementById('ssave').onclick = function () {
      var lv = view.querySelector('input[name="dial"]:checked');
      var payload = { level: lv ? lv.value : undefined,
        cap: parseInt(document.getElementById('scap').value, 10),
        dailyCap: parseInt(document.getElementById('sdaily').value, 10) };
      if (isNaN(payload.cap)) delete payload.cap;
      if (isNaN(payload.dailyCap)) delete payload.dailyCap;
      api('/api/auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) {
          flash(['auto-approve: ' + r.level + ' (cap ' + r.cap + ', daily ' + r.dailyCap + ')' +
            (r.level === 'wide' ? ' — adopted lessons that pass the reviewer now activate without you; security still waits' : '')]);
          renderSettings();
        })
        .catch(function (e) { flash([e.message], true); });
    };
    view.querySelectorAll('[data-consent]').forEach(function (b) {
      b.onclick = function () {
        api('/api/consent', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: b.dataset.consent, consent: b.dataset.next === 'true' }) })
          .then(function () { flash(['consent updated']); renderSettings(); })
          .catch(function (e) { flash([e.message], true); });
      };
    });
  }).catch(function (e) { view.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}

function render() {
  if (tab === 'dash') renderDash();
  else if (tab === 'queue') renderQueue();
  else if (tab === 'lessons') renderLessons();
  else if (tab === 'adopt') renderAdopt();
  else if (tab === 'activity') renderActivity();
  else if (tab === 'company') renderCompany();
  else if (tab === 'guard') renderGuard();
  else renderSettings();
}
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
    if (url.pathname === '/api/lessons') {
      return sendJson(res, 200, { items: lessonsView(url.searchParams.get('q'), { audience: url.searchParams.get('audience') }) });
    }
    if (url.pathname === '/api/lessons/item') {
      const ref = url.searchParams.get('ref');
      if (!ref) return sendJson(res, 400, { error: 'E-WEB: ?ref= is required' });
      try {
        return sendJson(res, 200, lessonItem(ref));
      } catch (err) {
        return sendJson(res, 404, { error: err.message });
      }
    }
    if (url.pathname === '/api/why') return sendJson(res, 200, whySummary(Number(url.searchParams.get('last')) || 10));
    if (url.pathname === '/api/events') return sendJson(res, 200, { items: eventsFeed(Number(url.searchParams.get('limit')) || 50) });
    if (url.pathname === '/api/adoptions') return sendJson(res, 200, { items: adoptionsView() });
    if (url.pathname === '/api/settings') return sendJson(res, 200, settingsView());
    if (url.pathname === '/api/guard') return sendJson(res, 200, guardView());
    if (url.pathname === '/api/portfolio') return sendJson(res, 200, readPortfolio());
    if (url.pathname === '/api/report') {
      const raw = url.searchParams.get('days');
      let days = DEFAULT_DAYS;
      if (raw !== null) {
        days = Number(raw);
        if (!Number.isInteger(days) || days < 1) return sendJson(res, 400, { error: 'E-WEB: days must be a positive integer' });
      }
      return sendJson(res, 200, readWeekly({ days }));
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    // Mutations go through the SAME engine as `raph approve` / `raph reject` —
    // including the no-batch + --confirmed rules for security/quarantined,
    // which live in review.js, not here.
    if (url.pathname === '/api/approve' || url.pathname === '/api/reject') {
      const refs = Array.isArray(body.refs) ? body.refs.filter((r) => typeof r === 'string' && r.trim()) : [];
      if (refs.length === 0) return sendJson(res, 400, { error: 'E-WEB: body.refs must be a non-empty array of candidate refs' });
      if (url.pathname === '/api/approve') {
        return sendJson(res, 200, approveRefs(refs, { confirmed: body.confirmed === true }));
      }
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
      return sendJson(res, 200, rejectRefs(refs, { reason }));
    }

    // `raph on` / `raph off` — the injection master switch.
    if (url.pathname === '/api/injection') {
      if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: 'E-WEB: body.enabled must be true or false' });
      setInjectionEnabled(body.enabled);
      return sendJson(res, 200, { enabled: body.enabled });
    }

    // `raph adopt <src>` — user-initiated by this click (invariant #5b holds:
    // the console never fetches in the background; only this handler, only now).
    if (url.pathname === '/api/adopt') {
      if (typeof body.src !== 'string' || !body.src.trim()) return sendJson(res, 400, { error: 'E-WEB: body.src must be a URL or path' });
      try {
        return sendJson(res, 200, await runAdopt({ src: body.src.trim(), dryRun: body.dryRun === true, skill: body.skill === true }));
      } catch (err) {
        if (err.code === 'E-LIMIT') return sendJson(res, 429, { error: err.message, code: 'E-LIMIT' });
        return sendJson(res, 400, { error: String(err.message ?? err) });
      }
    }

    // `raph adopt revoke <ref>` — the one-click undo.
    if (url.pathname === '/api/adopt/revoke') {
      if (typeof body.ref !== 'string' || !body.ref.trim()) return sendJson(res, 400, { error: 'E-WEB: body.ref must be an adoption id or source' });
      try {
        const r = revokeAdoption(body.ref.trim(), { log: () => {} });
        return sendJson(res, 200, r);
      } catch (err) {
        return sendJson(res, 404, { error: String(err.message ?? err) });
      }
    }

    // `raph auto [level|full|manual] [--cap] [--daily-cap]` — the SAME applyDial
    // the CLI uses, so the mode coupling (full = autopilot) is identical here.
    if (url.pathname === '/api/auto') {
      const cfg = loadConfig();
      try {
        const r = applyDial(cfg, { level: body.level, cap: body.cap, dailyCap: body.dailyCap });
        if (r.changed) saveConfig(cfg);
        return sendJson(res, 200, { ...r, autoTier: countAutoTier() });
      } catch (err) {
        return sendJson(res, 400, { error: String(err.message ?? err) });
      }
    }

    // `raph contribute on|off` — the SAME setContribution. Granting only lets
    // bundles STAGE locally; sending stays a human action (invariant #6).
    if (url.pathname === '/api/contribute') {
      if (typeof body.enabled !== 'boolean') {
        return sendJson(res, 400, { error: 'E-WEB: body needs enabled (boolean)' });
      }
      setContribution(body.enabled);
      return sendJson(res, 200, settingsView());
    }

    // The consent registry — the same setProjectConsent `raph mine` records.
    if (url.pathname === '/api/consent') {
      if (typeof body.project !== 'string' || !body.project.trim() || typeof body.consent !== 'boolean') {
        return sendJson(res, 400, { error: 'E-WEB: body needs project (string) and consent (boolean)' });
      }
      setProjectConsent(body.project.trim(), body.consent);
      return sendJson(res, 200, settingsView());
    }

    // `raph guard scan` — --all over the launch repo, or explicit paths
    // (explicit paths are always scanned in full, allowlist or not — same rule
    // as the CLI).
    if (url.pathname === '/api/guard/scan') {
      const entropy = body.entropy === true;
      if (Array.isArray(body.paths) && body.paths.length) {
        const results = body.paths
          .filter((f) => typeof f === 'string' && f.trim())
          .map((f) => ({ file: f, findings: scanFile(path.resolve(f), { entropy }) }))
          .filter((r) => r.findings.length);
        return sendJson(res, 200, { mode: 'paths', results });
      }
      const scan = scanTracked(process.cwd(), { entropy });
      return sendJson(res, 200, { mode: 'all', allowlist: scan.allowlist, results: scan.results });
    }

    // `raph guard install|uninstall` on the launch repo.
    if (url.pathname === '/api/guard/hook') {
      if (body.install === true) {
        const r = installPreCommitHook(process.cwd(), { force: false });
        return sendJson(res, r.ok ? 200 : 409, r);
      }
      if (body.install === false) {
        const r = uninstallPreCommitHook(process.cwd());
        return sendJson(res, r.ok ? 200 : 409, r);
      }
      return sendJson(res, 400, { error: 'E-WEB: body.install must be true or false' });
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
