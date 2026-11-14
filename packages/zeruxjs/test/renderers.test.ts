import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createApplicationLifecycle,
  buildProjectSources,
  resolveProductionStructure,
} from 'zeruxjs';
import {
  createRendererRegistry,
  createZyroRenderer,
  createReactRenderer,
  createVueRenderer,
} from 'zeruxjs/renderers';
import { h, renderToString } from 'zyrojs/dom';
/** Create an isolated application with an owned ephemeral loopback listener and temporary tree.
 * @returns {Promise<object>} Fixture exposing synthetic requests and explicit cleanup.
 */
async function fixture() {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx001-'));
  /** Owned isolated application generation using explicitly disabled database/cache providers. */
  const app = await createApplicationLifecycle({
    rootDir: root,
    config: {},
    providers: { database: async () => null, cache: async () => null },
  });
  /** Fixture server state used for transport or private build-manifest assertions. */
  const server = createServer(
    (req, res) => void app.handle(req, res).catch(() => res.destroy())
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    app,
    root,
    server,
    /** Issue and consume one bounded synthetic request to this fixture.
     * @param {string} url - Fixed fixture pathname/query.
     * @returns {Promise<object>} Status, headers and collected fixture response text.
     */
    async call(url) {
      /** Synthetic loopback response consumed before releasing its owner. */
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${url}`,
        { headers: { accept: 'application/json' } }
      );
      return {
        status: response.status,
        headers: response.headers,
        body: await response.text(),
      };
    },
    /** Close application ownership before its native listener and temporary files.
     * @returns {Promise<void>} Actual fixture cleanup settlement.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(root, { recursive: true, force: true });
    },
  };
}
/** Fixed static-only adapter capabilities reused by negative and isolation fixtures. */
const caps = {
  staticHtml: true,
  streaming: false,
  hydration: false,
  clientOnly: false,
};
/** Yield one event-loop turn so owned completion callbacks can settle.
 * @returns {Promise<void>} Scheduled immediate completion.
 */
const tick = () => new Promise((r) => setImmediate(r));
test('normal routes and actual Zyro static HTML coexist; renderer dispatch is generation scoped', async () => {
  /** Owned isolated runtime/server fixture released in the surrounding finally block. */
  const f = await fixture();
  try {
    /** Borrowed generation plugin authority used only to register synthetic routes/adapters. */
    const api = f.app.runtime().asPluginApi();
    /** Explicit renderer owner or borrowed generation registry under test. */
    const registry = api.renderers();
    /** Registry-local static renderer token using real standalone Zyro string rendering. */
    const zyro = registry.register(createZyroRenderer(renderToString));
    api.addRoute({ pattern: '/normal', handler: () => ({ normal: true }) });
    api.addRoute({
      pattern: '/render',
      handler: (ctx) => ctx.render(zyro, h('h1', {}, 'Hello <world>')),
    });
    assert.equal((await f.call('/normal')).body, '{"normal":true}');
    /** Loopback rendered response used to verify escaping and content type. */
    const rendered = await f.call('/render');
    assert.equal(rendered.status, 200);
    assert.match(rendered.headers.get('content-type'), /text\/html/);
    assert.equal(rendered.body, '<h1>Hello &lt;world&gt;</h1>');
    await tick();
    assert.equal(registry.activeRenders, 0);
    await assert.rejects(
      zyro.dispose(),
      (e) => e.code === 'RENDERER_REGISTRATION_CLOSED'
    );
    assert.throws(
      () => registry.get('missing'),
      (e) => e.code === 'RENDERER_UNKNOWN'
    );
  } finally {
    await f.close();
  }
});
test('concurrent render contexts do not share local state and dispose once', async () => {
  /** Owned isolated runtime/server fixture released in the surrounding finally block. */
  const f = await fixture();
  /** Opaque request IDs recorded to verify request-local context isolation. */
  const requests = [];
  /** Cleanup receipts recorded to verify one release per request. */
  const disposals = [];
  let adapterClosed = 0,
    arrived = 0,
    release;
  /** Barrier retaining both synthetic renders until concurrent isolation can be observed. */
  const both = new Promise((r) => (release = r));
  try {
    /** Borrowed generation plugin authority used only to register synthetic routes/adapters. */
    const api = f.app.runtime().asPluginApi();
    /** Registry-local synthetic adapter token; foreign registry dispatch must reject. */
    const token = api.renderers().register({
      name: 'isolated',
      capabilities: caps,
      /** Provide a synthetic adapter response while exercising explicit request locals and cleanup.
       * @param {unknown} view - Synthetic view input.
       * @param {import('zeruxjs/renderers').RendererContext} ctx - Borrowed request-local render scope.
       * @returns {import('zeruxjs/renderers').AdapterRenderResult | Promise<import('zeruxjs/renderers').AdapterRenderResult>} Synthetic HTML or owned stream result; negative fixtures may throw.
       */
      async render(view, ctx) {
        ctx.locals.set('view', view);
        requests.push(ctx.requestId);
        ctx.onDispose(() => disposals.push(ctx.requestId));
        if (++arrived === 2) {
          release();
        }
        await both;
        return { kind: 'html', html: `<p>${ctx.locals.get('view')}</p>` };
      },
      dispose: () => adapterClosed++,
    });
    api.addRoute({
      pattern: '/isolation',
      handler: (ctx) => ctx.render(token, ctx.query.get('name')),
    });
    /** Concurrent loopback responses checked against their distinct synthetic views. */
    const results = await Promise.all([
      f.call('/isolation?name=one'),
      f.call('/isolation?name=two'),
    ]);
    assert.deepEqual(
      results.map((x) => x.body),
      ['<p>one</p>', '<p>two</p>']
    );
    assert.equal(new Set(requests).size, 2);
    await tick();
    assert.equal(disposals.length, 2);
  } finally {
    await f.close();
  }
  assert.equal(adapterClosed, 1);
});
test('explicit factories do not install runtimes; unsupported capabilities and failures stay private', async () => {
  assert.throws(
    () => createReactRenderer(undefined),
    (e) => e.code === 'RENDERER_DEPENDENCY_REQUIRED'
  );
  /** Explicit renderer owner or borrowed generation registry under test. */
  const registry = createRendererRegistry();
  /** Fixture-owned cancellation signal for explicit registry dispatch. */
  const controller = new AbortController();
  /** Static injected-renderer token; the fixture does not install a React runtime. */
  const react = registry.register(
    createReactRenderer((view) => `<b>${view}</b>`)
  );
  registry.register(createVueRenderer(async (view) => `<i>${view}</i>`));
  await assert.rejects(
    registry.render(
      react,
      'view',
      { requestId: 'test', pathname: '/', signal: controller.signal },
      'hydration'
    ),
    (e) => e.code === 'RENDERER_FEATURE_UNSUPPORTED'
  );
  /** Separate owned registry proving token identity cannot cross generation boundaries. */
  const foreign = createRendererRegistry();
  await assert.rejects(
    foreign.render(react, 'view', {
      requestId: 'test',
      pathname: '/',
      signal: controller.signal,
    }),
    (e) => e.code === 'RENDERER_UNKNOWN_OR_FOREIGN'
  );
  await foreign.close();
  await registry.close();
  /** Owned isolated runtime/server fixture released in the surrounding finally block. */
  const f = await fixture();
  let cleaned = 0;
  try {
    /** Borrowed generation plugin authority used only to register synthetic routes/adapters. */
    const api = f.app.runtime().asPluginApi();
    /** Registry-local synthetic adapter token; foreign registry dispatch must reject. */
    const token = api.renderers().register({
      name: 'failure',
      capabilities: caps,
      /** Provide a synthetic adapter response while exercising explicit request locals and cleanup.
       * @param {unknown} _view - Unused synthetic view input.
       * @param {import('zeruxjs/renderers').RendererContext} ctx - Borrowed request-local render scope.
       * @returns {import('zeruxjs/renderers').AdapterRenderResult | Promise<import('zeruxjs/renderers').AdapterRenderResult>} Synthetic HTML or owned stream result; negative fixtures may throw.
       */
      render(_view, ctx) {
        ctx.onDispose(() => cleaned++);
        throw Error('PRIVATE dependency payload');
      },
    });
    api.addRoute({
      pattern: '/failure',
      handler: (ctx) => ctx.render(token, null),
    });
    /** Render or HTTP receipt inspected for the specific fixture outcome. */
    const result = await f.call('/failure');
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.body, /PRIVATE|payload|stack/);
    assert.equal(cleaned, 1);
  } finally {
    await f.close();
  }
});
test('stream renderer cancellation and unconsumed streams release owned resources', async () => {
  /** Explicit renderer owner or borrowed generation registry under test. */
  const registry = createRendererRegistry();
  let disposed = 0;
  /** Registry-local synthetic adapter token; foreign registry dispatch must reject. */
  const token = registry.register({
    name: 'stream',
    capabilities: { ...caps, staticHtml: false, streaming: true },
    /** Provide a synthetic adapter response while exercising explicit request locals and cleanup.
     * @param {unknown} _view - Unused synthetic view input.
     * @param {import('zeruxjs/renderers').RendererContext} ctx - Borrowed request-local render scope.
     * @returns {import('zeruxjs/renderers').AdapterRenderResult | Promise<import('zeruxjs/renderers').AdapterRenderResult>} Synthetic HTML or owned stream result; negative fixtures may throw.
     */
    render(_view, ctx) {
      ctx.onDispose(() => disposed++);
      return {
        kind: 'stream',
        source: (async function* () {
          yield '<p>first</p>';
        })(),
      };
    },
  });
  /** Fixture-owned cancellation signal for explicit registry dispatch. */
  const controller = new AbortController();
  await registry.render(
    token,
    null,
    { requestId: 'unused', pathname: '/', signal: controller.signal },
    'streaming'
  );
  await registry.close();
  assert.equal(disposed, 1);
  assert.equal(registry.activeRenders, 0);
});
/** Create an isolated authored-source fixture with the real installed TypeScript parser linked explicitly.
 * @returns {Promise<string>} Owned temporary root; the caller removes it in finally.
 */
async function project() {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx001-build-'));
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'components'));
  await mkdir(path.join(root, 'lib'));
  await mkdir(path.join(root, 'public'));
  await mkdir(path.join(root, 'node_modules'));
  await symlink(
    path.resolve('../../node_modules/typescript'),
    path.join(root, 'node_modules/typescript'),
    'dir'
  );
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(root, 'app/route.ts'),
    'export function GET(){return {normal:true};}'
  );
  return root;
}
test('client graph emits deterministic private/public manifests and executable linked ESM assets', async () => {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await project();
  try {
    await writeFile(
      path.join(root, 'components/view.client.ts'),
      `'use strict'; 'use client'; import {value} from '../lib/shared.js'; export const result:number=value+1;`
    );
    await writeFile(
      path.join(root, 'lib/shared.ts'),
      'export const value:number=41;'
    );
    await writeFile(
      path.join(root, 'app/route.ts'),
      `import {value} from '../lib/shared.js';export function GET(){return {value};}`
    );
    await writeFile(
      path.join(root, 'lib/late.ts'),
      `export const value=1; 'use client';`
    );
    await writeFile(path.join(root, 'public/site.txt'), 'public');
    await writeFile(
      path.join(root, 'app/browser.ts'),
      `'use client';export const root=document;export default function ClientOnly(){return null;}`
    );
    await buildProjectSources({ rootDir: root });
    /** Private isolated staged build directory. */
    const output = path.join(root, '.zerux/build');
    /** Initial private server manifest text retained for deterministic repeat comparison. */
    const first = await readFile(
      path.join(output, 'server-manifest.json'),
      'utf8'
    );
    /** Initial public asset manifest text checked for private-source disclosure. */
    const pub = await readFile(path.join(output, 'public-assets.json'), 'utf8');
    /** Fixture server state used for transport or private build-manifest assertions. */
    const server = JSON.parse(first);
    /** Parsed public build asset projection. */
    const assets = JSON.parse(pub);
    assert.equal(
      server.modules.find((x) => x.path === 'lib/shared.ts').environment,
      'shared'
    );
    assert.equal(
      server.modules.find((x) => x.path === 'lib/late.ts').declared,
      'neutral'
    );
    assert.equal(
      server.modules.find((x) => x.path === 'components/view.client.ts')
        .environment,
      'client'
    );
    assert.equal(
      await stat(path.join(output, 'components/view.client.js')).catch(
        () => null
      ),
      null
    );
    assert.doesNotMatch(pub, /rootDir|lib\/late|\.server|request|password/);
    /** Graph-owned emitted client asset URL selected from the private manifest. */
    const assetUrl = server.modules.find(
      (x) => x.path === 'components/view.client.ts'
    ).clientAsset;
    assert.ok(assets.entries.includes(assetUrl));
    /** Explicit client source fixture or emitted asset path used for boundary assertions. */
    const source = path.join(output, 'public', assetUrl);
    /** Imported isolated emitted client module, never operator application code. */
    const module = await import(pathToFileURL(source).href);
    assert.equal(module.result, 42);
    assert.equal(
      (await stat(path.join(output, 'server-manifest.json'))).mode & 0o777,
      0o600
    );
    await buildProjectSources({ rootDir: root });
    assert.equal(
      await readFile(path.join(output, 'server-manifest.json'), 'utf8'),
      first
    );
    assert.equal(
      await readFile(path.join(output, 'public-assets.json'), 'utf8'),
      pub
    );
    /** Production structure resolved from the isolated completed build. */
    const config = await resolveProductionStructure(root, 'zerux', {});
    /** Owned isolated application generation using explicitly disabled database/cache providers. */
    const app = await createApplicationLifecycle({
      rootDir: root,
      mode: 'start',
      config,
      providers: { database: async () => null, cache: async () => null },
    });
    /** Owned ephemeral HTTP host for the isolated compiled fixture. */
    const host = createServer((req, res) => void app.handle(req, res));
    host.listen(0, '127.0.0.1');
    await once(host, 'listening');
    try {
      /** Compiled public asset response compared with its emitted file bytes. */
      const served = await fetch(
        // codeql[js/file-access-to-http] -- This test intentionally requests the locally emitted manifest asset.
        `http://127.0.0.1:${host.address().port}${assetUrl}`
      );
      assert.equal(served.status, 200);
      assert.equal(await served.text(), await readFile(source, 'utf8'));
    } finally {
      await app.close();
      host.closeAllConnections();
      await new Promise((r) => host.close(r));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('transitive client import rejection reports its chain and preserves the prior successful build', async () => {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await project();
  try {
    await buildProjectSources({ rootDir: root });
    /** Private isolated staged build directory. */
    const output = path.join(root, '.zerux/build');
    /** Last complete build manifest retained across a failed candidate build. */
    const previous = await readFile(
      path.join(output, 'build-manifest.json'),
      'utf8'
    );
    await writeFile(
      path.join(root, 'components/page.client.ts'),
      `'use client';import {secret} from '../lib/shared.js'; export const value=secret;`
    );
    await writeFile(
      path.join(root, 'lib/shared.ts'),
      `export {secret} from './secrets.server.js';`
    );
    await writeFile(
      path.join(root, 'lib/secrets.server.ts'),
      `'use server';export const secret=1;`
    );
    await assert.rejects(
      buildProjectSources({ rootDir: root }),
      (error) =>
        error.code === 'CLIENT_IMPORTS_SERVER_MODULE' &&
        error.chain.join(' -> ') ===
          'components/page.client.ts -> lib/shared.ts -> lib/secrets.server.ts'
    );
    assert.equal(
      await readFile(path.join(output, 'build-manifest.json'), 'utf8'),
      previous
    );
    assert.equal(
      (await readdir(path.join(root, '.zerux'))).some((x) =>
        x.startsWith('.build-')
      ),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Node imports, server globals, dynamic imports and conflicting directives fail closed', async () => {
  for (const source of [
    `'use client';import 'node:fs';`,
    `'use client';export const secret=process.env.PRIVATE;`,
    `'use client';const target='./helper.js';import(target);`,
    `'use client';'use server';`,
  ]) {
    /** Owned temporary project root removed only after dependent fixture resources close. */
    const root = await project();
    try {
      await writeFile(path.join(root, 'components/bad.ts'), source);
      await assert.rejects(
        buildProjectSources({ rootDir: root }),
        (error) => error.name === 'ModuleBoundaryError'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('post-transform client imports are checked and renderer stream cancellation waits for source settlement', async () => {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await project();
  try {
    await writeFile(
      path.join(root, 'components/entry.client.ts'),
      `'use client';export const value=1;`
    );
    await assert.rejects(
      buildProjectSources({
        rootDir: root,
        transform: (source, _file, context) =>
          context?.environment === 'client'
            ? `import 'node:fs';export const value=1;`
            : source,
      }),
      (e) =>
        e.code === 'CLIENT_COMPILED_EXTERNAL_IMPORT' &&
        e.chain.includes('node:fs')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  /** Explicit renderer owner or borrowed generation registry under test. */
  const registry = createRendererRegistry();
  /** Fixture-owned cancellation signal for explicit registry dispatch. */
  const controller = new AbortController();
  let released = 0;
  /** Registry-local synthetic adapter token; foreign registry dispatch must reject. */
  const token = registry.register({
    name: 'owned-stream',
    capabilities: { ...caps, staticHtml: false, streaming: true },
    /** Provide a synthetic adapter response while exercising explicit request locals and cleanup.
     * @param {unknown} _view - Unused synthetic view input.
     * @param {import('zeruxjs/renderers').RendererContext} context - Borrowed request-local render cancellation scope.
     * @returns {import('zeruxjs/renderers').AdapterRenderResult | Promise<import('zeruxjs/renderers').AdapterRenderResult>} Synthetic HTML or owned stream result; negative fixtures may throw.
     */
    render(_view, context) {
      return {
        kind: 'stream',
        source: (async function* () {
          try {
            yield 'first';
            await new Promise((resolve) =>
              context.signal.addEventListener('abort', resolve, { once: true })
            );
          } finally {
            released++;
          }
        })(),
      };
    },
  });
  /** Render or HTTP receipt inspected for the specific fixture outcome. */
  const result = await registry.render(
    token,
    null,
    { requestId: 'stream', pathname: '/', signal: controller.signal },
    'streaming'
  );
  /** Owned returned stream iterator used to verify cancellation settlement. */
  const iterator = result.source[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, 'first');
  /** Unsettled stream pull retained until cancellation is observed. */
  const pending = iterator.next();
  /** Expected cancellation assertion attached before abort to avoid unhandled rejection. */
  const cancelled = assert.rejects(pending);
  await tick();
  controller.abort();
  await cancelled;
  await registry.close();
  assert.equal(released, 1);
  assert.equal(registry.activeRenders, 0);
});

test('development discovery skips leading-directive browser entries before Node execution', async () => {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await project();
  let app;
  try {
    await rm(path.join(root, 'app/route.ts'));
    await writeFile(
      path.join(root, 'app/route.js'),
      'export function GET(){return {normal:true};}'
    );
    await writeFile(
      path.join(root, 'app/browser.js'),
      `'use strict';'use client';export const element=document.createElement('div');export default function Browser(){return null;}`
    );
    app = await createApplicationLifecycle({
      rootDir: root,
      mode: 'dev',
      config: {},
      providers: { database: async () => null, cache: async () => null },
    });
    assert.equal(
      app.runtime().routes.some((route) => route.relativePath === 'browser.js'),
      false
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('public asset projection follows configured overlapping-directory precedence', async () => {
  /** Owned temporary project root removed only after dependent fixture resources close. */
  const root = await project();
  try {
    await mkdir(path.join(root, 'public/nested'));
    await writeFile(path.join(root, 'public/site.txt'), 'first');
    await writeFile(path.join(root, 'public/nested/site.txt'), 'second');
    await buildProjectSources({
      rootDir: root,
      config: { structure: { public: ['public', 'public/nested'] } },
    });
    /** Parsed isolated public asset manifest used to verify configured source precedence. */
    const manifest = JSON.parse(
      await readFile(path.join(root, '.zerux/build/public-assets.json'), 'utf8')
    );
    /** Selected public record; private source/priority fields must not be exposed. */
    const asset = manifest.assets.find((x) => x.url === '/site.txt');
    assert.equal(
      asset.integrity,
      'sha256-' +
        (await import('node:crypto'))
          .createHash('sha256')
          .update('second')
          .digest('base64')
    );
    assert.equal('source' in asset, false);
    assert.equal('priority' in asset, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
