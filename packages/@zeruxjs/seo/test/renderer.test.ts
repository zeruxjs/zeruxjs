import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMetadata, renderMetadata } from '@zeruxjs/seo/composition';
import {
  createRendererRegistry,
  createZyroDocumentRenderer,
} from 'zeruxjs/renderers';

test('existing authored document layout consumes structured metadata once without changing renderer ownership', async () => {
  /** Actual structured SEO document passed to an existing authored framework layout. */
  const metadata = composeMetadata(
    { publicBase: 'https://example.test/' },
    [{ title: '<unsafe>', description: 'Content facts' }],
    { url: 'https://example.test/page', visibility: 'public' }
  );
  /** Owned existing renderer generation; close settles render ownership after output checks. */
  const registry = createRendererRegistry();
  /** Exact native renderer/filter registration handle; no global registry is implied. */
  const token = registry.register(
    createZyroDocumentRenderer({
      render: () => ({ html: '<main><h1>Authored heading</h1></main>' }),
      security: () => ({ headers: { 'x-content-type-options': 'nosniff' } }),
      layout: (view) => ({
        before:
          '<!doctype html><html><head>' +
          renderMetadata(view.metadata) +
          '</head><body>',
        after: '</body></html>',
      }),
    })
  );
  try {
    /** Rendered synthetic document; metadata must appear once without changing owner cleanup. */
    const output = await registry.render(
      token,
      { metadata },
      {
        requestId: 'seo-fixture',
        pathname: '/page',
        signal: new AbortController().signal,
      }
    );
    assert.match(output.html, /<title>&lt;unsafe&gt;<\/title>/);
    assert.equal([...output.html.matchAll(/rel="canonical"/g)].length, 1);
    assert.match(output.html, /<h1>Authored heading<\/h1>/);
    assert.equal(output.headers['cache-control'], 'no-store');
    assert.equal(registry.activeRenders, 1);
  } finally {
    await registry.close();
  }
  assert.equal(registry.activeRenders, 0);
});
