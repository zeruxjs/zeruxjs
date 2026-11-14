import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicCrawlerService,
  createPublicRedirects,
  renderHtmlSitemap,
} from '@zeruxjs/seo/public';
import { createSitemapIndex } from '@zeruxjs/seo';
/** Explicit synthetic public origin/prefix/locale policy; no request header supplies it. */
const site = {
  origin: 'https://example.test',
  basePath: '/docs/',
  locales: { fr: 'https://example.test/docs/fr/' },
};
/** Generate a finite synthetic public URL/alternate/media record; public flags are not authentication.
 * @param {number} n - Synthetic fixture index.
 * @returns {object} Explicit public fixture record under the configured prefixes.
 */
const row = (n) => ({
  visibility: 'public',
  loc: `https://example.test/docs/page${n}`,
  alternates: { fr: `https://example.test/docs/fr/page${n}` },
  images: ['https://example.test/image.png'],
});
/** Create a synthetic fixed-origin Fetch request; no network or listener starts.
 * @param {string} path - Fixed fixture request path.
 * @returns {Request} Local Fetch value with no network dispatch.
 */
const request = (path) => new Request('https://example.test' + path);
test('paged source emits bounded indexed XML, content lastmod only, HEAD and weak conditional GET', async () => {
  let calls = 0;
  /** Owned strict public crawler scope; await close even on failed assertions. */
  const app = createPublicCrawlerService({
    site,
    pageSize: 2,
    maxUrlsPerFile: 1,
    source: {
      async load({ cursor, limit, signal }) {
        calls++;
        assert.equal(limit, 2);
        assert(signal instanceof AbortSignal);
        return cursor
          ? { items: [{ ...row(3), lastmod: '2025-01-02' }] }
          : { items: [row(1), row(2)], nextCursor: 'next' };
      },
    },
    snapshotTtlMs: 5000,
    trustTxt: 'contact: owner@example.test\n',
  });
  try {
    /** Independent concurrent request/result snapshots used to prove isolation/coalescing. */
    const [a, b] = await Promise.all([
      app.handler(request('/docs/sitemap.xml')),
      app.handler(request('/docs/sitemap.xml')),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(calls, 2);
    /** Generated sitemap index response/text, independent of an application database. */
    const index = await a.text();
    assert(index.includes('<sitemapindex'));
    assert(!index.includes('lastmod'));
    /** One complete synthetic XML page or bodyless response assertion. */
    const page = await app.handler(request('/docs/sitemaps/3'));
    /** Escaped complete synthetic XML representation, not a deployed crawler result. */
    const xml = await page.text();
    assert.match(xml, /<lastmod>2025-01-02<\/lastmod>/);
    assert.match(xml, /hreflang="fr"/);
    /** Representation-specific validator captured from complete selected bytes. */
    const etag = page.headers.get('etag');
    assert.equal(
      (
        await app.handler(
          new Request('https://example.test/docs/sitemaps/3', {
            method: 'HEAD',
          })
        )
      ).status,
      200
    );
    assert.equal(
      await (
        await app.handler(
          new Request('https://example.test/docs/sitemaps/3', {
            method: 'HEAD',
          })
        )
      ).text(),
      ''
    );
    assert.equal(
      (
        await app.handler(
          new Request('https://example.test/docs/sitemaps/3', {
            headers: { 'if-none-match': 'W/' + etag },
          })
        )
      ).status,
      304
    );
    assert.match(
      await (await app.handler(request('/robots.txt'))).text(),
      /https:\/\/example.test\/docs\/sitemap.xml/
    );
    assert.equal(
      await (await app.handler(request('/trust.txt'))).text(),
      'contact: owner@example.test\n'
    );
  } finally {
    await app.close();
  }
  assert.equal((await app.handler(request('/docs/sitemap.xml'))).status, 503);
});
test('private/signed URLs, hostile Host/forwarded origin, and repeated cursors fail closed', async () => {
  for (const value of [
    { ...row(1), visibility: 'private' },
    { ...row(1), images: ['https://example.test/file?signature=private'] },
    { ...row(1), loc: 'https://example.test/docs/a?token=private' },
    { ...row(1), alternates: { de: 'https://example.test/docs/a' } },
  ]) {
    /** Owned strict public crawler scope; await close even on failed assertions. */
    const app = createPublicCrawlerService({
      site,
      source: { load: async () => ({ items: [value] }) },
    });
    try {
      /** Explicit synthetic response or policy decision, checked without a live proxy/crawler. */
      const result = await app.handler(request('/docs/sitemap.xml'));
      assert.equal(result.status, 503);
      assert(!(await result.text()));
    } finally {
      await app.close();
    }
  }
  /** Owned strict public crawler scope; await close even on failed assertions. */
  const app = createPublicCrawlerService({
    site,
    source: { load: async () => ({ items: [], nextCursor: 'same' }) },
  });
  try {
    assert.equal(
      (
        await app.handler(
          new Request('https://evil.test/docs/sitemap.xml', {
            headers: { 'x-forwarded-host': 'example.test' },
          })
        )
      ).status,
      421
    );
    assert.equal(
      (
        await app.handler(
          new Request('https://example.test/docs/sitemap.xml', {
            headers: { host: 'evil.test' },
          })
        )
      ).status,
      421
    );
    assert.equal((await app.handler(request('/docs/sitemap.xml'))).status, 503);
  } finally {
    await app.close();
  }
});
test('verified direct proxy peer can admit configured internal origin without trusting forwarded headers', async () => {
  /** Owned strict public crawler scope; await close even on failed assertions. */
  const app = createPublicCrawlerService({
    site: {
      ...site,
      trustedProxy: {
        peers: ['127.0.0.1'],
        internalOrigins: ['http://internal.test'],
      },
    },
    source: { load: async () => ({ items: [row(1)] }) },
  });
  try {
    /** Synthetic internal-origin request with host-controlled direct peer passed separately. */
    const req = new Request('http://internal.test/docs/sitemap.xml', {
      headers: {
        'x-forwarded-host': 'evil.test',
        forwarded: 'host=evil.test;proto=http',
      },
    });
    assert.equal(
      (await app.handler(req, { peerAddress: '192.0.2.1' })).status,
      421
    );
    /** Explicit synthetic response or policy decision, checked without a live proxy/crawler. */
    const result = await app.handler(req, { peerAddress: '127.0.0.1' });
    assert.equal(result.status, 200);
    /** Escaped complete synthetic XML representation, not a deployed crawler result. */
    const xml = await result.text();
    assert(!xml.includes('evil.test'));
    /** Decoded locations from generated XML; all must use the configured public origin. */
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(
      (match) => new URL(match[1])
    );
    assert(locations.length > 0);
    assert(locations.every((url) => url.origin === site.origin));
  } finally {
    await app.close();
  }
});
test('deadline preserves native ownership; close drains, failures retry and iterator cleanup is bounded', async (t) => {
  let finish,
    signal,
    calls = 0;
  /** Owned strict public crawler scope; await close even on failed assertions. */
  const app = createPublicCrawlerService({
    site,
    timeoutMs: 10,
    source: {
      load: async (input) => {
        signal = input.signal;
        calls++;
        return new Promise((r) => (finish = r));
      },
    },
  });
  // A failed deadline assertion must not leave the native source fixture held forever.
  t.after(async () => {
    finish?.({ items: [] });
    await app.close();
  });
  /** Synthetic observed caller result; deadline does not prove native source completion. */
  const response = await app.handler(request('/docs/sitemap.xml'));
  assert.equal(response.status, 503);
  assert.equal(app.status().pending, true);
  assert(signal.aborted);
  let closed = false;
  /** Owned crawler drain promise retained until held source work settles. */
  const closing = app.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  finish({ items: [] });
  await closing;
  assert.equal(calls, 1);
  let failed = true;
  /** Owned public crawler with explicitly injected transient source failure, then later explicit request. */
  const retry = createPublicCrawlerService({
    site,
    source: {
      load: async () => {
        if (failed) {
          throw Error('private DB credentials');
        }
        return { items: [row(1)] };
      },
    },
  });
  try {
    assert.equal(
      (await retry.handler(request('/docs/sitemap.xml'))).status,
      503
    );
    failed = false;
    assert.equal(
      (await retry.handler(request('/docs/sitemap.xml'))).status,
      200
    );
  } finally {
    await retry.close();
  }
  let finalized = false;
  /** Generate one over-budget native-iteration fixture and record whether failure closes it.
   * @returns {Generator<object>} Synthetic sitemap records only; no external source is queried.
   */
  function* excessive() {
    try {
      for (let i = 0; i < 50001; i++) {
        yield { loc: 'https://example.test/sitemap' + i };
      }
    } finally {
      finalized = true;
    }
  }
  assert.throws(() => createSitemapIndex(excessive()), RangeError);
  assert(finalized);
});
test('fixed redirects reject cycles/open targets and never copy query/forwarded values', () => {
  assert.throws(
    () =>
      createPublicRedirects({
        site,
        rules: [
          { from: '/docs/a', to: '/docs/b', status: 308 },
          { from: '/docs/b', to: '/docs/a', status: 307 },
        ],
      }),
    /loop/
  );
  assert.throws(
    () =>
      createPublicRedirects({
        site,
        rules: [{ from: '/docs/a', to: 'https://evil.test/x', status: 302 }],
      }),
    /Open/
  );
  assert.throws(() =>
    createPublicRedirects({
      site,
      rules: [{ from: '/docs/a', to: '/docs/x/../new', status: 308 }],
    })
  );
  /** Inert fixed redirect graph; request query/forwarded data never choose Location. */
  const redirects = createPublicRedirects({
    site,
    rules: [{ from: '/docs/old', to: '/docs/new', status: 308 }],
  });
  /** Synthetic observed caller result; deadline does not prove native source completion. */
  const response = redirects.handler(
    new Request('https://example.test/docs/old?next=https://evil.test', {
      headers: { 'x-forwarded-host': 'evil.test' },
    })
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://example.test/docs/new'
  );
  assert.equal(
    redirects.handler(new Request('https://evil.test/docs/old')).status,
    421
  );
  assert.equal(
    redirects.handler(
      new Request('https://example.test/docs/old', { method: 'POST' })
    ).status,
    405
  );
});
test('HTML sitemap is a separate bounded escaped renderer with explicit public labels', () => {
  /** Generated escaped HTML fixture; tests do not run a browser or crawler. */
  const html = renderHtmlSitemap(site, [
    {
      visibility: 'public',
      loc: 'https://example.test/docs/a',
      title: '<img onerror=bad>',
    },
  ]);
  assert(html.includes('&lt;img'));
  assert(!html.includes('<img'));
  assert.throws(() =>
    renderHtmlSitemap(site, [
      {
        visibility: 'private',
        loc: 'https://example.test/docs/a',
        title: 'Secret',
      },
    ])
  );
  assert.throws(() =>
    renderHtmlSitemap(site, [
      {
        visibility: 'public',
        loc: 'https://example.test/docs/a?secret=x',
        title: 'Secret',
      },
    ])
  );
});
