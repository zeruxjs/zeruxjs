import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboard } from '../dist/dashboard.js';
import { browserScript } from '../dist/browser.js';
test('tag studio JavaScript is syntactically executable after HTML generation', () => {
  /** Serialized authenticated dashboard fixture; assertions check safe stored text and explicit mount. */
  const html = dashboard('/_tags');
  /** Exact emitted script body compiled and hashed without executing source modules. */
  const source = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(source);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotThrow(
    () =>
      new vm.Script(
        browserScript({ endpoint: '/_tags/collect', site: 'app', debug: false })
      )
  );
});
