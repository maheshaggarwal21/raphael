// The bounded fetcher for `raph adopt` — the ONLY general network surface in
// Raphael, allowed by the 2026-07-16 amendment of principle §0.6 / invariant #5
// (ARCHITECTURE §13). Every property of that amendment is enforced HERE, in one
// place:
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

// Parse + policy-check a URL. Exported so the policy itself is unit-testable.
export function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw err('E-FETCH-URL', `not a valid URL: ${String(raw).slice(0, 120)}`);
  }
  if (u.username || u.password) {
    throw err('E-FETCH-URL', 'URLs with embedded credentials are refused — the fetcher never sends credentials');
  }
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && isLoopback(u.hostname)) return u; // own machine only
  throw err('E-FETCH-URL', `only https URLs are fetched (got ${u.protocol}//) — http is allowed for localhost only`);
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Basic, deterministic HTML -> text: drop script/style/head wholesale, strip
// tags, decode the common entities, collapse blank runs. Good enough to feed
// a distiller; never meant to render anything.
export function htmlToText(html) {
  let t = String(html ?? '');
  t = t.replace(/<(script|style|head|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
  t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function requestOnce(u, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
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
  let u = checkUrl(rawUrl);
  const started = Date.now();

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const remaining = limits.timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw err('E-FETCH-TIMEOUT', `${rawUrl} did not answer within ${Math.round(limits.timeoutMs / 1000)}s`);

    const r = await requestOnce(u, { timeoutMs: remaining, maxBytes: limits.maxBytes });

    if (r.redirect) {
      // relative redirects resolve against the current URL; the target must
      // pass the exact same policy — a redirect can never downgrade it
      u = checkUrl(new URL(r.redirect, u).href);
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
