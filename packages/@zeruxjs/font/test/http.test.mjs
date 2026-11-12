import test from 'node:test';
import assert from 'node:assert/strict';
import { createFontRegistry } from '../dist/index.js';
import { createFontStylesheetHandler } from '../dist/http.js';
test('font stylesheet ETag follows registry mutations, preload links and head', async () => {
  /** Inert mutable registry used to verify representation changes after a face is added. */
  const fonts = createFontRegistry();
  fonts.add('regular', {
    family: 'Inter',
    sources: [{ url: '/inter.woff2', format: 'woff2' }],
  });
  /** In-memory public Fetch handler borrowing the fixture registry, not an HTTP server. */
  const handler = createFontStylesheetHandler({
    registry: fonts,
    preloadKeys: ['regular'],
  });
  /** Initial synthetic stylesheet response used for CSS/preload/ETag assertions. */
  const first = handler(new Request('https://example.com/fonts.css'));
  assert.match(first.headers.get('link'), /rel=preload/);
  assert.match(await first.text(), /@font-face/);
  /** Initial exact CSS validator reused in the conditional request. */
  const etag = first.headers.get('etag');
  assert.equal(
    handler(
      new Request('https://example.com/fonts.css', {
        headers: { 'if-none-match': etag },
      })
    ).status,
    304
  );
  assert.equal(
    handler(new Request('https://example.com/fonts.css', { method: 'HEAD' }))
      .body,
    null
  );
  fonts.add('bold', {
    family: 'Inter',
    weight: 700,
    sources: [{ url: '/bold.woff2' }],
  });
  assert.notEqual(
    handler(new Request('https://example.com/fonts.css')).headers.get('etag'),
    etag
  );
  assert.equal(
    handler(new Request('https://example.com/fonts.css', { method: 'POST' }))
      .status,
    405
  );
});
test('stylesheet deduplicates binary preloads and rejects explicit budget overflow', () => {
  /** Synthetic two-face registry used to test binary URL deduplication. */
  const registry = createFontRegistry();
  // Two distinct faces sharing one binary must count as one preload URL.
  for (const key of ['a', 'b']) {
    registry.add(key, { family: key, sources: [{ url: '/same.woff2' }] });
  }
  /** In-memory GET request; no remote origin is contacted. */
  const request = new Request('https://test/fonts.css');
  /** In-memory public Fetch handler borrowing the fixture registry, not an HTTP server. */
  const handler = createFontStylesheetHandler({
    registry,
    preloadKeys: ['a', 'b'],
    maxPreloads: 1,
  });
  assert.equal(
    handler(request).headers.get('link').split('rel=preload').length - 1,
    1
  );
  registry.add('b', { family: 'b', sources: [{ url: '/other.woff2' }] });
  assert.throws(() => handler(request), /budget/);
  assert.throws(
    () => createFontStylesheetHandler({ registry, maxPreloads: -1 }),
    /budget/
  );
});
