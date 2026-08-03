// The bounded fetcher for `raph adopt` — the only general network surface in
// Raphael, allowed by the §0.6 / invariant #5 amendment (ARCHITECTURE §13).
// Every property of that amendment is enforced here, in one place:
//
//   - user-initiated only: this module exposes a function; nothing schedules it
//   - read-only: GET, nothing else
//   - https only — plain http is allowed solely for loopback (the user's own
//     machine; also what makes this testable without TLS fixtures)
//   - no credentials: no auth headers or cookies are ever sent, and URLs that
//     EMBED credentials (user:pass@host) are rejected outright
//   - bounded: size cap enforced while streaming, total-time cap, ≤3 redirects
//     (each re-checked against the same policy — no downgrade via redirect)
//   - content is DATA: text comes back as a string to be scanned; nothing is
//     ever executed or rendered
//
// Errors are coded (E-FETCH-*) so callers can report precisely.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';

export const FETCH_LIMITS = {
  maxBytes: 2 * 1024 * 1024, // 2 MB
  timeoutMs: 20000,
  maxRedirects: 3
};

const TEXTUAL_TYPES = /^(text\/|application\/(json|xml|javascript|ecmascript|x?html\+xml|x-yaml|yaml|toml|markdown|x-sh))/i;

function err(code, msg) {
  const e = new Error(`${code}: ${msg}`);
  e.code = code;
  return e;
}

function isLoopback(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

// ---- SSRF guard ------------------------------------------------------------
//
// The §13 policy said "https only, no downgrade via redirect", which the code
// enforced — but "https" is not the same as "public". Any https host was allowed,
// including private and link-local literals, and every redirect hop re-ran the
// same permissive check, so a benign public page could 302 an adopt fetch into
// http://127.0.0.1:9200/ or https://169.254.169.254/latest/meta-data/ and reflect
// an internal service's response back to be scanned.
//
// Two layers, because they catch different things:
//   1. checkUrl rejects non-public IP LITERALS (no DNS involved).
//   2. a guarded `lookup` rejects non-public RESOLUTIONS, and because the
//      connection uses the address the guard returned, it also closes DNS
//      rebinding (a name that resolves public once, then to 127.0.0.1).

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// True for addresses that must never be reached by an adopt fetch.
export function isNonPublicAddress(address) {
  let h = String(address ?? '').trim().toLowerCase();
  if (!h) return true;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.split('%')[0]; // drop any zone id (fe80::1%eth0)

  // IPv4-mapped / -embedded IPv6 (::ffff:127.0.0.1) is judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return isNonPublicAddress(mapped[1]);

  const m = V4.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (m.slice(1).some((o) => Number(o) > 255)) return true; // malformed = refuse
    if (a === 0 || a === 127) return true;                    // this host / loopback
    if (a === 10) return true;                                // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;          // RFC1918
    if (a === 192 && b === 168) return true;                   // RFC1918
    if (a === 169 && b === 254) return true;                   // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;         // CGNAT
    if (a === 192 && b === 0) return true;                      // 192.0.0.0/24 + 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
    if (a >= 224) return true;                                  // multicast + broadcast
    return false;
  }

  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;                // unspecified / loopback
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;              // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;              // fe80::/10 link-local
    if (/^ff[0-9a-f]{2}:/.test(h)) return true;                 // multicast
    return false;
  }

  return false; // a hostname — layer 2 (the lookup guard) judges where it points
}

// A `lookup` for http.request that refuses non-public resolutions. The socket
// then connects to the address this returned, so nothing can swap it afterwards.
function guardedLookup(allowLoopback) {
  return function lookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (e, addresses) => {
      if (e) return callback(e);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      for (const a of list) {
        if (allowLoopback && isLoopback(a.address)) continue;
        if (isNonPublicAddress(a.address)) {
          return callback(err('E-FETCH-BLOCKED', `${hostname} resolves to the non-public address ${a.address} — refused`));
        }
      }
      if (options?.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

// Parse + policy-check a URL. Exported so the policy itself is unit-testable.
// `allowLoopback` is TRUE only for the URL the user typed (so `raph adopt` can
// read docs served on their own machine, and so the tests can use a loopback
// server). A REDIRECT never gets it: an external page must not be able to steer
// the fetcher at localhost.
export function checkUrl(raw, { allowLoopback = true } = {}) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw err('E-FETCH-URL', `not a valid URL: ${String(raw).slice(0, 120)}`);
  }
  if (u.username || u.password) {
    throw err('E-FETCH-URL', 'URLs with embedded credentials are refused — the fetcher never sends credentials');
  }
  const loopback = isLoopback(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback && allowLoopback)) {
    throw err(
      'E-FETCH-URL',
      `only https URLs are fetched (got ${u.protocol}//) — http is allowed for the localhost URL you pass in, never for a redirect target`
    );
  }
  if (loopback && !allowLoopback) {
    throw err('E-FETCH-BLOCKED', `refusing to follow a redirect to the loopback address ${u.hostname}`);
  }
  if (!loopback && isNonPublicAddress(u.hostname)) {
    throw err('E-FETCH-BLOCKED', `${u.hostname} is a private, loopback or link-local address — refused`);
  }
  return u;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const clampCodePoint = (cp) => {
  try {
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
  } catch {
    return ' ';
  }
};

// Defuddle-style (16.7) main-content extraction: prefer the largest <article> or
// <main> (or a role="main" region), then <body>, then the whole string. Cuts the
// chrome — nav/header/footer — before it ever reaches the distiller, so the
// reviewer spends fewer tokens on boilerplate. Deterministic bounded regex, no DOM.
export function mainRegion(html) {
  const largest = (re) => {
    let best = '';
    let m;
    const g = new RegExp(re, 'gi');
    while ((m = g.exec(html)) !== null) if (m[1] && m[1].length > best.length) best = m[1];
    return best;
  };
  const article = largest('<article\\b[^>]*>([\\s\\S]*?)<\\/article\\s*>');
  if (article) return article;
  const main = largest('<main\\b[^>]*>([\\s\\S]*?)<\\/main\\s*>');
  if (main) return main;
  const roleMain = largest('<(?:div|section)\\b[^>]*\\brole=["\']main["\'][^>]*>([\\s\\S]*?)<\\/(?:div|section)\\s*>');
  if (roleMain) return roleMain;
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  return body ? body[1] : html;
}

// Deterministic HTML -> text: pull the main region, drop non-content elements
// wholesale, strip remaining tags, decode entities (named + numeric), collapse
// blank runs. Good enough to feed a distiller; never meant to render anything.
export function htmlToText(html) {
  let t = mainRegion(String(html ?? ''));
  t = t.replace(/<(script|style|head|noscript|template|svg|nav|header|footer|aside|form|button|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => clampCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => clampCodePoint(parseInt(h, 16)));
  t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function requestOnce(u, { timeoutMs, maxBytes, allowLoopback = false }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        // layer 2 of the SSRF guard: the socket connects to the address this
        // returns, so a name cannot resolve public here and private at connect
        lookup: guardedLookup(allowLoopback),
        headers: {
          // identify honestly; send nothing else — no cookies, no auth
          'user-agent': 'raphael-adopt/1 (+local, read-only)',
          accept: 'text/html, text/plain, text/markdown, application/json, text/*;q=0.8'
        }
      },
      (res) => {
        const { statusCode = 0, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume(); // drain
          resolve({ redirect: headers.location, status: statusCode });
          return;
        }
        if (statusCode >= 400) {
          res.resume();
          reject(err('E-FETCH-HTTP', `${u.href} answered ${statusCode}`));
          return;
        }

        const ctype = String(headers['content-type'] ?? '').split(';')[0].trim();
        if (ctype && !TEXTUAL_TYPES.test(ctype)) {
          req.destroy();
          reject(err('E-FETCH-TYPE', `unsupported content type "${ctype}" — only textual content is adopted`));
          return;
        }

        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            req.destroy();
            reject(err('E-FETCH-SIZE', `response exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB adopt cap`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (looksBinary(buf)) {
            reject(err('E-FETCH-TYPE', 'response body is binary — only textual content is adopted'));
            return;
          }
          resolve({ status: statusCode, contentType: ctype || null, buf });
        });
        res.on('error', (e) => reject(err('E-FETCH-NET', e.message)));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(err('E-FETCH-TIMEOUT', `${u.href} did not answer within ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', (e) => reject(err('E-FETCH-NET', `${u.href}: ${e.message}`)));
    req.end();
  });
}

// Fetch one URL under the §13 policy. Returns
//   { url, finalUrl, status, contentType, text, bytes, html }
// where `text` is already html-stripped when the payload was HTML.
export async function fetchUrl(rawUrl, overrides = {}) {
  const limits = { ...FETCH_LIMITS, ...overrides };
  // The loopback carve-out belongs to the URL the USER supplied, and to nothing
  // downstream of it.
  let u = checkUrl(rawUrl, { allowLoopback: true });
  const userAskedForLoopback = isLoopback(u.hostname);
  const started = Date.now();

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const remaining = limits.timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw err('E-FETCH-TIMEOUT', `${rawUrl} did not answer within ${Math.round(limits.timeoutMs / 1000)}s`);

    const r = await requestOnce(u, { timeoutMs: remaining, maxBytes: limits.maxBytes, allowLoopback: userAskedForLoopback });

    if (r.redirect) {
      // Relative redirects resolve against the current URL, and the target must
      // pass the same policy. The carve-out follows the ORIGIN, not the hop: a
      // localhost URL may redirect within localhost (ordinary docs routing), but
      // a PUBLIC page can never steer the fetcher at loopback or a private range.
      u = checkUrl(new URL(r.redirect, u).href, { allowLoopback: userAskedForLoopback });
      continue;
    }

    const raw = r.buf.toString('utf8');
    const isHtml = /html/i.test(r.contentType ?? '') || /^\s*(?:<!doctype html|<html)/i.test(raw);
    return {
      url: String(rawUrl),
      finalUrl: u.href,
      status: r.status,
      contentType: r.contentType,
      html: isHtml,
      bytes: r.buf.length,
      text: isHtml ? htmlToText(raw) : raw
    };
  }
  throw err('E-FETCH-REDIRECT', `more than ${limits.maxRedirects} redirects — refusing to follow further`);
}
