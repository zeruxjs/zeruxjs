import test from 'node:test';
import assert from 'node:assert/strict';
test('existing public docs search consumer works with weighted prefix/version filtering without an app build', async () => {
  const originalDocument = globalThis.document,
    originalFetch = globalThis.fetch;
  globalThis.document = { body: { dataset: { basePath: '/zeruxjs', searchVersion: 'fixture' } } };
  let called = '';
  globalThis.fetch = async (url) => {
    called = String(url);
    return Response.json({
      schema: 2,
      pages: [
        ['Cache guide', 'Runtime', '0.0.4', '/zeruxjs/cache', 'Public cache guide', 'cache usage'],
        ['Old cache', 'Runtime', '0.0.3', '/zeruxjs/old', 'Old guide', 'cache usage'],
      ],
      sections: [[0, 'Caching', 'caching', 'cache policies']],
    });
  };
  try {
    const { searchDocs } = await import('../../../../apps/zerux-docs/public/assets/search.js');
    const results = await searchDocs('cache', '0.0.4');
    assert(called.startsWith('/zeruxjs/assets/search.json'));
    assert(results.length > 0);
    assert(results.every((r) => r.version === '0.0.4'));
    assert.equal((await searchDocs('notpresent', '0.0.4')).length, 0);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
