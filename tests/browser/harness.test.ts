import test from 'node:test';
import assert from 'node:assert/strict';
import { withBrowserFixture } from './harness.ts';
test('static browser fixture serves allowed modules and blocks arbitrary files', async () => {
  await withBrowserFixture('section78.html', async (base) => {
    /** Test fixture or local value named entry. */
    const entry = await fetch(base);
    assert.equal(entry.status, 200);
    assert.match(await entry.text(), /Frontend bridge browser fixture/);
    /** Test fixture or local value named js. */
    const js = await fetch(
      new URL('/packages/@zeruxjs/react/dist/index.js', base)
    );
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    /** Test fixture or local value named blocked. */
    const blocked = await fetch(new URL('/package.json', base));
    assert.equal(blocked.status, 403);
    /** Test fixture or local value named missing. */
    const missing = await fetch(new URL('/nonexistent.js', base));
    assert.equal(missing.status, 404);
  });
});
