import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrawlerRoutes } from '../dist/fetch.js';
/** Generate one deterministic public legacy sitemap entry without source discovery.
 * @param {number} n - Synthetic fixture index.
 * @returns {object} Authored public location and fixed content-owned lastmod.
 */
const item = (n) => ({
  loc: `https://example.com/${n}`,
  lastmod: '2025-10-01',
});
test('sitemap splits into discoverable pages with proper route patterns', async () => {
  /** Inert legacy fixed route descriptors; no listener or close API is invented. */
  const routes = createCrawlerRoutes({
    origin: 'https://example.com',
    entries: [item(1), item(2), item(3)],
    maxUrlsPerSitemap: 2,
  });
  assert.deepEqual(
    routes.map((x) => x.path),
    ['/robots.txt', '/sitemap.xml', '/sitemaps/:page']
  );
  /** Borrowed inert Fetch callback mounted only by this synthetic fixture. */
  const handler = routes[1].handler;
  /** Generated sitemap index response/text, independent of an application database. */
  const index = await handler(new Request('https://example.com/sitemap.xml'));
  assert.equal(index.status, 200);
  assert.match(await index.text(), /sitemaps\/2/);
  /** One complete synthetic XML page or bodyless response assertion. */
  const page = await handler(new Request('https://example.com/sitemaps/2'));
  assert.ok(
    (await page.text())
      .split('<loc>')
      .some((value) => value.split('</loc>')[0] === 'https://example.com/3')
  );
  assert.equal(
    (await handler(new Request('https://example.com/sitemaps/3'))).status,
    404
  );
  assert.match(
    await (await handler(new Request('https://example.com/robots.txt'))).text(),
    /sitemap.xml/
  );
});
test('crawler responses support HEAD and conditional requests, strict URL size limits', async () => {
  /** Inert legacy fixed route descriptors; no listener or close API is invented. */
  const routes = createCrawlerRoutes({
    origin: 'https://example.com',
    entries: [item(1)],
  });
  /** Borrowed inert Fetch callback mounted only by this synthetic fixture. */
  const handler = routes[0].handler;
  /** First exact representation used to verify stable conditional validators. */
  const first = await handler(new Request('https://example.com/sitemap.xml'));
  assert.match(await first.text(), /urlset/);
  assert.equal(
    (
      await handler(
        new Request('https://example.com/sitemap.xml', {
          headers: { 'if-none-match': first.headers.get('etag') },
        })
      )
    ).status,
    304
  );
  assert.equal(
    (
      await handler(
        new Request('https://example.com/sitemap.xml', { method: 'HEAD' })
      )
    ).body,
    null
  );
  assert.equal(
    (
      await handler(
        new Request('https://example.com/sitemap.xml', { method: 'POST' })
      )
    ).status,
    405
  );
  assert.throws(
    () => createCrawlerRoutes({ origin: 'file:///tmp', entries: [] }),
    TypeError
  );
  assert.throws(
    () =>
      createCrawlerRoutes({
        origin: 'https://example.com',
        entries: [],
        maxXmlBytes: 100,
      }),
    RangeError
  );
});
test('sitemap page size limits split long URLs without exceeding bytes', async () => {
  /** Finite deterministic public sitemap corpus for byte/count splitting. */
  const entries = Array.from({ length: 8 }, (_, i) => ({
    loc: `https://example.com/${i}-` + 'x'.repeat(800),
  }));
  /** Borrowed inert Fetch callback mounted only by this synthetic fixture. */
  const handler = createCrawlerRoutes({
    origin: 'https://example.com',
    entries,
    maxXmlBytes: 2048,
  })[0].handler;
  /** Generated sitemap index response/text, independent of an application database. */
  const index = await handler(new Request('https://example.com/sitemap.xml'));
  /** Escaped complete synthetic XML representation, not a deployed crawler result. */
  const xml = await index.text();
  assert.match(xml, /sitemapindex/);
  /** Bounded fixed-regex extraction of generated local sitemap locations. */
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  assert.ok(matches.length >= 4);
  for (const m of matches) {
    /** One complete synthetic XML page or bodyless response assertion. */
    const page = await handler(new Request(m[1]));
    /** Complete selected synthetic representation used for byte assertions. */
    const body = await page.text();
    assert.ok(Buffer.byteLength(body) <= 2048);
  }
});

test('crawler snapshots coalesce concurrent rebuilds and allow explicit invalidation', async () => {
  /** Public legacy factory imported for compatibility caching checks; no private source alias. */
  const { createCrawlerService } = await import('../dist/fetch.js');
  let calls = 0;
  let content = [item(1)];
  /** Inert legacy cache controller; invalidate does not create an async close/drain contract. */
  const service = createCrawlerService({
    origin: 'https://example.com',
    entries: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return content;
    },
    snapshotTtlMs: 5000,
  });
  /** Borrowed inert Fetch callback mounted only by this synthetic fixture. */
  const handler = service.routes[0].handler;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      handler(new Request('https://example.com/sitemap.xml'))
    )
  );
  assert.equal(calls, 1);
  /** Pre-invalidation synthetic response baseline. */
  const before = await (
    await handler(new Request('https://example.com/sitemap.xml'))
  ).text();
  assert.ok(
    before
      .split('<loc>')
      .some((value) => value.split('</loc>')[0] === 'https://example.com/1')
  );
  content = [item(2)];
  assert.equal(calls, 1);
  service.invalidate();
  /** Post-invalidation response proving current source facts are reflected. */
  const after = await (
    await handler(new Request('https://example.com/sitemap.xml'))
  ).text();
  assert.ok(
    after
      .split('<loc>')
      .some((value) => value.split('</loc>')[0] === 'https://example.com/2')
  );
  assert.equal(calls, 2);
});
