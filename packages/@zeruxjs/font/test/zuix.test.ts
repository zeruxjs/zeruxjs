import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFontRegistry,
  createFontLoadScope,
  loadFont,
} from '../dist/index.js';
import { createFontZuixAdapter } from '../dist/zuix.js';
import { createFontStylesheetHandler } from '../dist/http.js';
import { createZuix } from 'zuixs';
/** Create matching synthetic registry/build records for actual local compiler integration checks.
 * @returns {object} Detached fixture config with explicit selected faces/icons and non-root URLs.
 */
function fixture() {
  /** Synthetic source-face registry; no native font or DOM resource is acquired. */
  const registry = createFontRegistry();
  registry.add('body', {
    family: 'Brand Sans',
    weight: 400,
    display: 'swap',
    sources: [{ url: '/shop/fonts/a.woff2', format: 'woff2' }],
  });
  registry.add('unused', {
    family: 'Unused',
    weight: 700,
    sources: [{ url: '/shop/fonts/b.woff2' }],
  });
  /** Synthetic attribution for injected asset records, not a real font license grant. */
  const license = {
    id: 'MIT',
    source: 'local:test',
    attribution: 'Synthetic',
    redistributionAllowed: true,
  };
  /** Synthetic matching build manifest used for actual local Zuixs compilation. */
  const assets = {
    schema: 1,
    digest: 'fixture',
    css: { file: 'font.css', url: '/shop/fonts/font.css', sha256: 'fixture' },
    fonts: registry.entries().map(([key, face]) => ({
      key,
      family: face.family,
      weight: String(face.weight),
      style: 'normal',
      url: face.sources[0].url,
      file: key + '.woff2',
      bytes: 64,
      format: 'woff2',
      sha256: 'fixture',
      sourceSha256: 'fixture',
      license,
      axes: [],
    })),
    icons: [
      { key: 'star', kind: 'font', fontKey: 'body', codePoint: 9733 },
      {
        key: 'mark',
        kind: 'svg',
        url: '/shop/fonts/mark.svg',
        file: 'mark.svg',
        bytes: 24,
        sha256: 'fixture',
        license,
      },
    ],
    preloads: [],
  };
  return {
    registry,
    assets,
    fonts: [{ token: 'body', key: 'body' }],
    icons: [
      { token: 'star', key: 'star' },
      { token: 'mark', key: 'mark' },
    ],
  };
}
test('explicit font/theme/icon adapter emits selected deterministic mounted assets and honors user overrides', () => {
  /** Detached fixture inputs; later mutations must not affect adapter snapshots. */
  const input = fixture();
  /** Explicit selected-face theme/asset adapter with no browser/network side effects. */
  const adapter = createFontZuixAdapter(input);
  /** Actual Zuixs compilation result, checked for prefix/important/theme behavior. */
  const result = createZuix({
    preflight: false,
    prefix: 'ui-',
    important: true,
    theme: adapter.theme,
    plugins: [adapter.plugin],
  }).generate(['ui-font-family-body', 'ui-font-weight-body', 'ui-icon-star']);
  assert.deepEqual(result.unmatched, []);
  assert.match(result.css, /font-family:var\(--zx-font-body\) !important/);
  assert.match(result.css, /font-weight:400 !important/);
  assert.match(
    result.css,
    /--zx-font-body:"Brand Sans", system-ui, sans-serif/
  );
  assert.doesNotMatch(adapter.css, /Unused|b\.woff2/);
  assert.match(adapter.css, /\/shop\/fonts\/a\.woff2/);
  assert.equal(adapter.manifest.icons[1].kind, 'font');
  assert.deepEqual(adapter.preloads([]), []);
  assert.equal(adapter.preloads([['body'], ['body']]).length, 1);
  assert.throws(
    () => adapter.preloads([['body']], { maxCount: 0, maxBytes: 100 }),
    /budget/
  );
  assert.throws(() => adapter.preloads([['missing']]), /Unknown/);
  /** Actual host-override compilation expected to win over adapter defaults. */
  const overridden = createZuix({
    preflight: false,
    theme: adapter.theme,
    extend: { fontFamily: { body: 'serif' }, fontWeight: { body: 500 } },
    plugins: [adapter.plugin],
  }).generate(['font-family-body', 'font-weight-body']);
  assert.match(overridden.css, /font-family:serif/);
  assert.match(overridden.css, /font-weight:500/);
  input.assets.fonts[0].url = '/changed';
  input.fonts[0].key = 'unused';
  assert.equal(adapter.preloads([['body']])[0].url, '/shop/fonts/a.woff2');
  /** Independent adapter over identical synthetic inputs, proving deterministic output. */
  const again = createFontZuixAdapter(fixture());
  assert.equal(adapter.css, again.css);
  /** In-memory public stylesheet handler borrowing the selected registry. */
  const handler = createFontStylesheetHandler({
    registry: adapter.registry,
    preloadKeys: ['body'],
  });
  /** Initial selected-registry CSS representation before the explicit mutation. */
  const first = handler(new Request('https://test/fonts.css'));
  assert.match(first.headers.get('link'), /\/shop\/fonts\/a.woff2/);
  adapter.registry.add('new', {
    family: 'New',
    sources: [{ url: '/shop/fonts/new.woff2' }],
  });
  assert.notEqual(
    handler(new Request('https://test/fonts.css')).headers.get('etag'),
    first.headers.get('etag')
  );
});
test('collisions, mismatched manifest, unsafe fallbacks and missing assets reject before compilation', () => {
  // Mutate one independent input contract at a time; each must fail before compilation.
  for (const mutate of [
    (i) => i.fonts.push({ token: 'body', key: 'unused' }),
    (i) => i.icons.push({ token: 'body', key: 'mark' }),
    (i) => (i.fonts[0].token = 'x;}'),
    (i) => (i.fonts[0].key = 'missing'),
    (i) => (i.assets.fonts[0].url = 'https://remote/font'),
    (i) => (i.fonts[0].fallback = ['bad;}']),
    (i) => i.assets.fonts.push(i.assets.fonts[0]),
  ]) {
    /** Detached fixture inputs; later mutations must not affect adapter snapshots. */
    const input = fixture();
    mutate(input);
    assert.throws(() => createFontZuixAdapter(input));
  }
});
test('font loading is optional, failure-redacted, cancelled and disposed without DOM import access', async (t) => {
  assert.equal(await loadFont('Absent'), false);
  await assert.rejects(loadFont('Bad;', {}));
  await assert.rejects(loadFont('A', { timeoutMs: Infinity }));
  let starts = 0;
  /** Owned per-mount observation scope around an injected FontFaceSet, not a real browser. */
  const scope = createFontLoadScope({
    document: {
      fonts: {
        load: () => {
          starts++;
          return new Promise(() => {});
        },
      },
    },
    maxPending: 1,
  });
  /** Held native-load observation; disposal must settle it without native network claims. */
  const pending = scope.load('Brand');
  t.after(async () => {
    scope.dispose();
    await pending.catch(() => {});
  });
  await assert.rejects(scope.load('Other'), /concurrency/);
  scope.dispose();
  scope.dispose();
  await assert.rejects(pending, /cancelled/);
  assert.equal(scope.pendingCount, 0);
  assert.equal(starts, 1);
  await assert.rejects(scope.load('Brand'), /disposed/);
  /** Owned scope with an injected private native error, expected to redact that failure. */
  const failed = createFontLoadScope({
    document: {
      fonts: { load: () => Promise.reject(new Error('secret signed URL')) },
    },
  });
  t.after(() => failed.dispose());
  await assert.rejects(
    failed.load('Brand'),
    (e) => e.message === 'Font loading failed'
  );
  failed.dispose();
  await assert.rejects(
    loadFont('Brand', {
      document: {
        fonts: {
          load() {
            throw new Error('private source');
          },
        },
      },
    }),
    (e) => e.message === 'Font loading failed'
  );
  /** Already-aborted caller controller; no native load should begin. */
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadFont('Brand', { signal: controller.signal }),
    /cancelled/
  );
  await assert.rejects(
    loadFont('Brand', {
      document: { fonts: { load: () => new Promise(() => {}) } },
      timeoutMs: 1,
    }),
    /timed out/
  );
  /** Owned scope disposed before its scheduled native observation starts. */
  const immediate = createFontLoadScope({
    document: {
      fonts: {
        load() {
          throw new Error('must not start');
        },
      },
    },
  });
  t.after(() => immediate.dispose());
  /** Scheduled observation rejected by immediate disposal, retained for settlement assertions. */
  const stopped = immediate.load('Brand');
  immediate.dispose();
  await assert.rejects(stopped, /cancelled/);
  assert.equal(
    await loadFont('Brand', {
      document: { fonts: { load: async () => [{}] } },
    }),
    true
  );
});
