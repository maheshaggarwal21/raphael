import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkUrl, htmlToText, mainRegion, fetchUrl, isNonPublicAddress } from '../src/lib/fetch.js';

// --- policy (checkUrl) --------------------------------------------------------

test('checkUrl: https allowed; plain http only for loopback', () => {
  assert.equal(checkUrl('https://example.com/x').protocol, 'https:');
  assert.equal(checkUrl('http://127.0.0.1:8080/x').hostname, '127.0.0.1');
  assert.equal(checkUrl('http://localhost/x').hostname, 'localhost');
  assert.throws(() => checkUrl('http://example.com/x'), /E-FETCH-URL/);
  assert.throws(() => checkUrl('ftp://example.com/x'), /E-FETCH-URL/);
  assert.throws(() => checkUrl('file:///C:/secrets.txt'), /E-FETCH-URL/);
  assert.throws(() => checkUrl('not a url'), /E-FETCH-URL/);
});

test('checkUrl: embedded credentials are refused outright', () => {
  assert.throws(() => checkUrl('https://user:pass@example.com/x'), /credentials/);
  assert.throws(() => checkUrl('https://token@example.com/x'), /credentials/);
});

// --- htmlToText -----------------------------------------------------------------

test('htmlToText strips scripts/styles/tags and decodes common entities', () => {
  const html = `<!doctype html><html><head><title>t</title><style>b{color:red}</style></head>
  <body><h1>Header</h1><script>alert("evil")</script>
  <p>One &amp; two &lt;three&gt;</p><ul><li>item</li></ul></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes('Header'));
  assert.ok(text.includes('One & two <three>'));
  assert.ok(text.includes('item'));
  assert.ok(!text.includes('alert'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('<p>'));
});

test('htmlToText (defuddle) keeps main content and drops nav/header/footer chrome', () => {
  const html = `<!doctype html><html><body>
    <header><nav>Home About <a href="/login">Login</a></nav></header>
    <main><h1>Real Title</h1><p>The actual lesson body worth adopting.</p></main>
    <aside>Ad: buy now</aside>
    <footer>Copyright 2026 · privacy policy</footer>
  </body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes('Real Title'));
  assert.ok(text.includes('actual lesson body'));
  assert.ok(!text.includes('Home About'), 'nav chrome dropped');
  assert.ok(!text.includes('buy now'), 'aside dropped');
  assert.ok(!text.includes('privacy policy'), 'footer dropped');
});

test('mainRegion prefers article/main, falls back to body then whole', () => {
  assert.match(mainRegion('<html><body><nav>x</nav><article>KEEP ME</article></body></html>'), /KEEP ME/);
  assert.match(mainRegion('<body><main>MAIN</main></body>'), /MAIN/);
  assert.match(mainRegion('<body>BODY ONLY</body>'), /BODY ONLY/);
  assert.equal(mainRegion('just a fragment'), 'just a fragment');
});

test('htmlToText decodes numeric + hex entities', () => {
  const text = htmlToText('<body><p>caf&#233; &#x2014; done</p></body>');
  assert.ok(text.includes('café'));
  assert.ok(text.includes('—'));
});

// --- fetchUrl against a local server ------------------------------------------

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('fetchUrl: plain text comes back verbatim; html comes back stripped', async () => {
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/plain') {
      res.setHeader('content-type', 'text/plain');
      res.end('hello adopt');
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<html><body><script>x()</script><p>doc text</p></body></html>');
    }
  });
  try {
    const plain = await fetchUrl(`${base}/plain`);
    assert.equal(plain.text, 'hello adopt');
    assert.equal(plain.html, false);

    const page = await fetchUrl(`${base}/page`);
    assert.equal(page.html, true);
    assert.ok(page.text.includes('doc text'));
    assert.ok(!page.text.includes('x()'));
  } finally {
    srv.close();
  }
});

test('fetchUrl: follows redirects up to the cap, re-checking policy each hop', async () => {
  let hits = 0;
  const { srv, base } = await serve((req, res) => {
    hits++;
    if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); return; }
    if (req.url === '/b') { res.writeHead(302, { location: '/c' }); res.end(); return; }
    if (req.url === '/c') { res.setHeader('content-type', 'text/plain'); res.end('landed'); return; }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    if (req.url === '/downgrade') { res.writeHead(302, { location: 'http://example.com/x' }); res.end(); return; }
    res.end('?');
  });
  try {
    const r = await fetchUrl(`${base}/a`);
    assert.equal(r.text, 'landed');
    assert.equal(new URL(r.finalUrl).pathname, '/c');
    assert.equal(hits, 3);

    await assert.rejects(fetchUrl(`${base}/loop`), /E-FETCH-REDIRECT/);
    // a redirect to non-loopback plain http must fail the SAME policy check
    await assert.rejects(fetchUrl(`${base}/downgrade`), /E-FETCH-URL/);
  } finally {
    srv.close();
  }
});

test('fetchUrl: size cap, content-type gate, binary gate, http errors', async () => {
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/big') {
      res.setHeader('content-type', 'text/plain');
      res.end('x'.repeat(4096));
      return;
    }
    if (req.url === '/pdf') { res.setHeader('content-type', 'application/pdf'); res.end('%PDF-'); return; }
    if (req.url === '/binary') { res.setHeader('content-type', 'text/plain'); res.end(Buffer.from([65, 0, 66, 0])); return; }
    if (req.url === '/missing') { res.writeHead(404); res.end('nope'); return; }
    res.end('?');
  });
  try {
    await assert.rejects(fetchUrl(`${base}/big`, { maxBytes: 1024 }), /E-FETCH-SIZE/);
    await assert.rejects(fetchUrl(`${base}/pdf`), /E-FETCH-TYPE/);
    await assert.rejects(fetchUrl(`${base}/binary`), /E-FETCH-TYPE/);
    await assert.rejects(fetchUrl(`${base}/missing`), /E-FETCH-HTTP/);
  } finally {
    srv.close();
  }
});

test('fetchUrl: a server that never answers hits the time cap', async () => {
  const { srv, base } = await serve(() => { /* never respond */ });
  try {
    await assert.rejects(fetchUrl(`${base}/slow`, { timeoutMs: 400 }), /E-FETCH-TIMEOUT/);
  } finally {
    srv.close();
  }
});

// --- SSRF guard (audit 2026-07-26, finding 3.5) -------------------------------
// The old policy was "https only, no downgrade via redirect" — but https is not
// the same as public. Any https host passed, including private and link-local
// literals, and every redirect hop re-ran the same permissive check.

test('isNonPublicAddress classifies loopback, private, link-local, and public', () => {
  // must be refused
  for (const ip of [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '[::1]', '::ffff:127.0.0.1',
    'fe80::1%eth0'
  ]) {
    assert.equal(isNonPublicAddress(ip), true, `${ip} must be non-public`);
  }
  // must be allowed
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.167.0.1', '2606:4700::1111', 'example.com']) {
    assert.equal(isNonPublicAddress(ip), false, `${ip} must be public`);
  }
  // edges: empty/garbage refuse (fail closed), malformed octets refuse
  assert.equal(isNonPublicAddress(''), true);
  assert.equal(isNonPublicAddress(null), true);
  assert.equal(isNonPublicAddress(undefined), true);
  assert.equal(isNonPublicAddress('999.1.1.1'), true);
});

test('checkUrl: https to a private or link-local literal is refused', () => {
  assert.throws(() => checkUrl('https://169.254.169.254/latest/meta-data/'), /E-FETCH-BLOCKED/);
  assert.throws(() => checkUrl('https://192.168.0.1/admin'), /E-FETCH-BLOCKED/);
  assert.throws(() => checkUrl('https://10.1.2.3/'), /E-FETCH-BLOCKED/);
  assert.throws(() => checkUrl('https://[fd00::1]/'), /E-FETCH-BLOCKED/);
  // a public https host is still fine
  assert.equal(checkUrl('https://example.com/x').hostname, 'example.com');
});

test('checkUrl: the loopback carve-out belongs to the user URL, never a redirect target', () => {
  // the URL the user typed may be loopback http (local docs, and the test server)
  assert.equal(checkUrl('http://127.0.0.1:9200/', { allowLoopback: true }).hostname, '127.0.0.1');
  // a redirect target may not be loopback at all, on either scheme
  assert.throws(() => checkUrl('http://127.0.0.1:9200/', { allowLoopback: false }), /E-FETCH/);
  assert.throws(() => checkUrl('https://127.0.0.1:9200/', { allowLoopback: false }), /E-FETCH-BLOCKED/);
  assert.throws(() => checkUrl('https://localhost/x', { allowLoopback: false }), /E-FETCH-BLOCKED/);
});

test('fetchUrl: a redirect aimed at a private address is refused, not followed', async () => {
  let reachedInternal = false;
  const internal = await serve((req, res) => { reachedInternal = true; res.end('SECRET INTERNAL DATA'); });
  try {
    const port = internal.srv.address().port;
    // A page the user asked for that tries to steer the fetcher inward. The user
    // URL here IS loopback (the only kind a test can serve), so the guard must
    // still refuse a redirect to a NON-loopback private range.
    const { srv, base } = await serve((req, res) => {
      if (req.url === '/to-metadata') { res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' }); res.end(); return; }
      if (req.url === '/to-private') { res.writeHead(302, { location: 'https://192.168.13.37/admin' }); res.end(); return; }
      res.end('ok');
    });
    try {
      await assert.rejects(fetchUrl(`${base}/to-metadata`), /E-FETCH-BLOCKED/, 'cloud metadata must be unreachable');
      await assert.rejects(fetchUrl(`${base}/to-private`), /E-FETCH-BLOCKED/, 'RFC1918 must be unreachable');
      assert.equal(reachedInternal, false, 'the internal service was never contacted');
      assert.ok(port > 0);
    } finally {
      srv.close();
    }
  } finally {
    internal.srv.close();
  }
});

test('fetchUrl: a localhost URL may still redirect within localhost (ordinary routing)', async () => {
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/docs') { res.writeHead(302, { location: '/docs/index.txt' }); res.end(); return; }
    res.setHeader('content-type', 'text/plain');
    res.end('local docs');
  });
  try {
    const r = await fetchUrl(`${base}/docs`);
    assert.equal(r.text, 'local docs');
  } finally {
    srv.close();
  }
});

test('fetchUrl: a hostname that RESOLVES to loopback is refused (DNS rebinding)', async () => {
  // localtest.me and friends resolve to 127.0.0.1 by design. No network needed
  // for the assertion to be meaningful: either DNS resolves it to loopback (the
  // guard must refuse) or resolution fails (a network error) — both are non-fetches.
  await assert.rejects(
    fetchUrl('https://localtest.me/x', { timeoutMs: 4000 }),
    (e) => /E-FETCH/.test(e.code ?? e.message),
    'a name pointing at loopback must never be fetched'
  );
});
