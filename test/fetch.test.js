import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkUrl, htmlToText, mainRegion, fetchUrl } from '../src/lib/fetch.js';

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
