import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootstrapApplication } from '../dist/bootstrap/runtime.js';
import { registerFetchRoutes, sendFetchResponse } from '../dist/fetch-route.js';
import { createFeedFetchHandler } from '../../@zeruxjs/feed/dist/fetch.js';
import { createCrawlerRoutes } from '../../@zeruxjs/seo/dist/fetch.js';
import { createSearchIndex } from '../../@zeruxjs/search/dist/index.js';
import { createSearchHandler } from '../../@zeruxjs/search/dist/http.js';
import { createFontRegistry } from '../../@zeruxjs/font/dist/index.js';
import { createFontStylesheetHandler } from '../../@zeruxjs/font/dist/http.js';
/** Bind the owned fixture to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Test-owned server.
 * @returns {Promise<number>} Assigned local port after listening.
 */
const listen = (server) =>
  new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => ok(server.address().port))
  );
/** Await closure of the owned test server.
 * @param {import("node:http").Server} server - Test-owned listening server.
 * @returns {Promise<void>} Native server close completion.
 */
const stop = (server) => new Promise((ok) => server.close(ok));
/** Issue one synthetic loopback request and collect response bytes for assertions.
 * @param {number} port - Ephemeral fixture port.
 * @param {string} pathname - Fixed fixture path and query.
 * @param {object} options - Optional request settings.
 * @param {string} options.method - Native request method, default GET.
 * @param {object} options.headers - Fixed synthetic request headers.
 * @param {Uint8Array | string} options.body - Optional synthetic request body.
 * @returns {Promise<object>} Native status, headers and bounded fixture response bytes.
 */
async function request(
  port,
  pathname,
  { method = 'GET', headers = {}, body } = {}
) {
  return await new Promise((resolve, reject) => {
    /** Owned native fixture request; transport errors reject the surrounding assertion. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: { host: 'localhost', ...headers },
      },
      (res) => {
        /** Response chunks buffered only for these bounded synthetic fixtures. */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}
test('real ZeruxJS routes serve searchable docs, dynamic sitemap, feed and font CSS', async () => {
  /** Owned empty runtime directory removed after protocol/server cleanup. */
  const dir = await mkdtemp(path.join(tmpdir(), 'zerux-fetch-'));
  /** Explicit empty project structure preventing discovery of operator files. */
  const structure = {
    mode: 'fix',
    rootDir: dir,
    serviceName: 'app',
    entryPointName: 'index',
    appDir: null,
    middlewareDirs: [],
    controllerDirs: [],
    composableDirs: [],
    pluginDirs: [],
    envFiles: [],
    publicDirs: [],
    outputDir: dir,
    raw: {},
  };
  /** Isolated runtime prepared only from the synthetic fixture configuration. */
  const { runtime } = await bootstrapApplication(
    dir,
    'start',
    { server: { allowedDomains: ['localhost'] } },
    structure
  );
  /** Local search index containing one synthetic public document. */
  const search = createSearchIndex();
  search.add({ id: 'doc', text: 'Hello Zerux ecosystem' });
  /** In-memory font registry; generation never fetches the declared font URL. */
  const fonts = createFontRegistry();
  fonts.add('ui', { family: 'Inter', sources: [{ url: '/inter.woff2' }] });
  registerFetchRoutes(runtime.asPluginApi(), [
    { pattern: '/search', handler: createSearchHandler({ index: search }) },
    {
      pattern: '/feed',
      handler: createFeedFetchHandler({
        feed: {
          title: 'News',
          description: 'News feed',
          siteUrl: 'https://example.com',
          items: [{ id: '1', title: 'Post', url: 'https://example.com/post' }],
        },
      }),
    },
    ...createCrawlerRoutes({
      origin: 'https://example.com',
      entries: [
        { loc: 'https://example.com/post' },
        { loc: 'https://example.com/other' },
      ],
      maxUrlsPerSitemap: 1,
    }),
    {
      pattern: '/fonts.css',
      handler: createFontStylesheetHandler({ registry: fonts }),
    },
    {
      pattern: '/download',
      handler: () =>
        new Response(
          new ReadableStream({
            /** Enqueue the fixed synthetic download and finish its source.
             * @param {ReadableStreamDefaultController} c - Fixture controller.
             * @returns {void} Synthetic source completion.
             */
            start(c) {
              c.enqueue(new TextEncoder().encode('abc'));
              c.enqueue(new TextEncoder().encode('def'));
              c.close();
            },
          }),
          { headers: { 'content-type': 'application/octet-stream' } }
        ),
    },
    {
      pattern: '/upload',
      handler: async (request) =>
        new Response(
          JSON.stringify({ bytes: (await request.arrayBuffer()).byteLength }),
          { headers: { 'content-type': 'application/json' } }
        ),
    },
  ]);
  /** Owned ephemeral HTTP server for this isolated transport fixture. */
  const server = http.createServer(runtime.createHandler());
  /** Assigned loopback port, never a user-managed listener. */
  const port = await listen(server);
  try {
    /** Search response used to verify result identity and validators. */
    const found = await request(port, '/search?q=hello');
    assert.equal(found.status, 200);
    assert.equal(JSON.parse(found.body).results[0].document.id, 'doc');
    /** Representation validator returned by the initial search request. */
    const etag = found.headers.etag;
    assert.equal(
      (
        await request(port, '/search?q=hello', {
          headers: { 'if-none-match': etag },
        })
      ).status,
      304
    );
    assert.equal(
      (await request(port, '/search?q=hello', { method: 'HEAD' })).body.length,
      0
    );
    /** Generated RSS response from fixed synthetic feed facts. */
    const feed = await request(port, '/feed');
    assert.match(feed.headers['content-type'], /rss\+xml/);
    assert.match(feed.body.toString(), /News/);
    /** Sitemap index response forced by the one-URL page budget. */
    const site = await request(port, '/sitemap.xml');
    assert.match(site.body.toString(), /sitemapindex/);
    /** First bounded sitemap page returned through the Fetch bridge. */
    const sub = await request(port, '/sitemaps/1');
    assert.match(sub.body.toString(), /urlset/);
    /** Public robots response using the fixed configured origin. */
    const robots = await request(port, '/robots.txt');
    assert.match(robots.body.toString(), /sitemap.xml/);
    /** Deterministic registry CSS response; no font bytes are downloaded. */
    const font = await request(port, '/fonts.css');
    assert.match(font.body.toString(), /@font-face/);
    /** Streamed two-chunk response gathered by the bounded fixture client. */
    const down = await request(port, '/download');
    assert.equal(down.body.toString(), 'abcdef');
    assert.equal(
      (await request(port, '/feed', { method: 'POST' })).status,
      405
    );
    /** Echoed length of a synthetic request larger than the historical one-megabyte default. */
    const upload = await request(port, '/upload', {
      method: 'POST',
      body: Buffer.alloc(1024 * 1024 + 67),
    });
    assert.deepEqual(JSON.parse(upload.body), { bytes: 1024 * 1024 + 67 });
    assert.ok(runtime.getLoadStatus().statusFamilies['2xx'] >= 7);
  } finally {
    runtime.closeProtocols();
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'Fetch destination adapter applies pressure and cancels its source on downstream close',
  { timeout: 5000 },
  async () => {
    let pulls = 0,
      cancelled = false,
      notifyCancel;
    /** Fixture completion signal resolved by the source cancellation callback. */
    const cancellation = new Promise((resolve) => {
      notifyCancel = resolve;
    });
    /** Reusable fixed-size chunk for exercising downstream backpressure. */
    const bytes = new Uint8Array(65536);
    /** Owned ephemeral HTTP server for this isolated transport fixture. */
    const server = http.createServer((req, res) => {
      /** Owned cooperative stream; cancellation must stop further chunk production. */
      const source = new ReadableStream({
        /** Yield cooperatively before bounded production, honoring cancellation.
         * @param {ReadableStreamDefaultController} controller - Owned source controller.
         * @returns {Promise<void>} One cooperative pull attempt.
         */
        async pull(controller) {
          await new Promise(setImmediate);
          if (cancelled) {
            return;
          }
          if (++pulls > 128) {
            controller.close();
            return;
          }
          controller.enqueue(bytes);
        },
        /** Notify the waiting test that the adapter relinquished its source.
         * @returns {void} Fixture cancellation signal completion.
         */
        cancel() {
          cancelled = true;
          notifyCancel();
        },
      });
      void sendFetchResponse(req, res, new Response(source)).catch(() =>
        res.destroy()
      );
    });
    /** Assigned loopback port, never a user-managed listener. */
    const port = await listen(server);
    let client, response;
    try {
      await new Promise((resolve, reject) => {
        client = http.get(`http://127.0.0.1:${port}/`, (res) => {
          response = res;
          res.pause();
          resolve();
        });
        client.on('error', reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.ok(pulls < 128, 'paused destination must stop source pulls');
      response.destroy();
      let timer;
      try {
        await Promise.race([
          cancellation,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error('Source was not cancelled; pulls=' + pulls)),
              1000
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(cancelled, true);
    } finally {
      client?.destroy();
      server.closeAllConnections();
      await stop(server);
    }
  }
);
