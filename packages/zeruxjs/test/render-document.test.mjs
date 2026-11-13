import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationLifecycle, buildProjectSources } from 'zeruxjs';
import {
  createZyroDocumentRenderer,
  createRenderAssets,
} from 'zeruxjs/renderers';
import { stream, sendStream } from 'zeruxjs/response';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { renderToHydratable } from 'zyrojs/server';
import { defineComponent, h } from 'zyrojs/component';
import { JSDOM } from 'jsdom';
/** Explicit response security composer issuing fresh production-policy headers per render. */
const policy = createSecurityPolicy({ mode: 'production', https: true });
/** Pure authored heading component used for SSR and DOM-emulated hydration identity checks. */
const Component = defineComponent((props) => () => h('h1', {}, props.name));
/** Validate the fixture public props independently of rendering.
 * @param {unknown} value - Candidate public hydration data.
 * @returns {{name: string}} Validated inert name; invalid data throws before rendering.
 */
const validateProps = (value) => {
  if (!value || typeof value.name !== 'string') {
    throw Error('invalid props');
  }
  return { name: value.name };
};
/** Create a temporary application and loopback listener without enabling hydration implicitly.
 * @returns {Promise<object>} Fixture owner with close ordering application before sockets and files.
 */
async function fixture() {
  /** Temporary project owning synthetic server or emitted client assets. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx004-'));
  /** Application generation owning renderers, request scopes and candidate cleanup. */
  const app = await createApplicationLifecycle({
    rootDir: root,
    config: {},
    providers: { database: async () => null, cache: async () => null },
  });
  /** Ephemeral loopback listener owned and closed by this fixture. */
  const server = createServer(
    (req, res) => void app.handle(req, res).catch(() => res.destroy())
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    root,
    app,
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    /** Drain renderer/request owners before closing native connections and removing the root.
     * @returns {Promise<void>} Resolves after isolated fixture cleanup.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('Zyro initial HTML, request-local CSP and layout work without JavaScript', async () => {
  /** Isolated document fixture disposed after render and response ownership checks. */
  const f = await fixture();
  try {
    /** Generation plugin API registering only the authored fixture routes and renderers. */
    const api = f.app.runtime().asPluginApi();
    /** Registered renderer reference bound to its generation registry. */
    const token = api.renderers().register(
      createZyroDocumentRenderer({
        security: () => policy.createResponse(),
        render: (view, ctx) => ({
          html: renderToHydratable(Component, view, {
            validateProps,
            signal: ctx.signal,
            idPrefix: 'page',
          }).html,
        }),
        layout: () => ({
          before: '<!doctype html><html><body><main>',
          after: '</main></body></html>',
        }),
      })
    );
    api.addRoute({
      pattern: '/',
      handler: (ctx) => ctx.render(token, { name: '<welcome>' }, 'streaming'),
    });
    /** Independent responses proving request-local CSP metadata is not reused. */
    const [a, b] = await Promise.all([fetch(f.base), fetch(f.base)]);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('cache-control'), 'no-store, no-transform');
    assert.notEqual(
      a.headers.get('content-security-policy'),
      b.headers.get('content-security-policy')
    );
    /** Generated document checked for escaped content and explicit hydration assets. */
    const html = await a.text();
    await b.text();
    assert.match(html, /<main><div id="zyro-root">/);
    assert.match(html, /&lt;welcome&gt;/);
    assert.doesNotMatch(html, /<script/);
  } finally {
    await f.close();
  }
});
test('emitted named assets supply V1 hydration, safe data and retained DOM identity', async () => {
  /** Temporary project owning synthetic server or emitted client assets. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx004-assets-'));
  let f;
  try {
    await mkdir(path.join(root, 'node_modules'));
    await symlink(
      path.resolve('../../node_modules/typescript'),
      path.join(root, 'node_modules/typescript'),
      'dir'
    );
    await mkdir(path.join(root, 'public'));
    /** Installed browser bundler used only for an isolated authored hydration entry. */
    const { build } = await import('esbuild');
    await build({
      stdin: {
        contents: `import {hydrate} from 'zyrojs/hydrate';import {defineComponent,h} from 'zyrojs/component';const Component=defineComponent(props=>()=>h('h1',{},props.name));export const mounted=hydrate(Component,document.getElementById('zyro-root'),{data:document.getElementById('zyro-root-data').textContent,validateProps:value=>{if(!value||typeof value.name!=='string')throw Error('invalid props');return {name:value.name};}});`,
        resolveDir: path.resolve('../..'),
        sourcefile: 'hydrate-entry.js',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      banner: { js: "'use client';" },
      outfile: path.join(root, 'public/hydrate.js'),
    });
    await buildProjectSources({
      rootDir: root,
      clientEntries: { hydrate: '/hydrate.js' },
    });
    /** Last complete public asset manifest retained across failed candidate preparation. */
    const previous = await readFile(
      path.join(root, '.zerux/build/public-assets.json'),
      'utf8'
    );
    /** Validated named asset projection consumed by the document renderer. */
    const assets = createRenderAssets(JSON.parse(previous));
    assert.equal(assets.entry('hydrate').url, '/hydrate.js');
    assert.throws(() => assets.entry('missing'));
    f = await fixture();
    /** Generation plugin API registering only the authored fixture routes and renderers. */
    const api = f.app.runtime().asPluginApi();
    /** Registered renderer reference bound to its generation registry. */
    const token = api.renderers().register(
      createZyroDocumentRenderer({
        security: () => policy.createResponse(),
        assets,
        clientEntry: 'hydrate',
        render: (props, ctx) =>
          renderToHydratable(Component, props, {
            validateProps,
            signal: ctx.signal,
            idPrefix: 'same',
          }),
      })
    );
    api.addRoute({
      pattern: '/',
      handler: (ctx) =>
        ctx.render(token, { name: '</script><script>bad</script>' }),
    });
    /** Native or synthetic response whose streaming/conditional lifecycle is under test. */
    const response = await fetch(f.base);
    /** Generated document checked for escaped content and explicit hydration assets. */
    const html = await response.text();
    assert.match(html, /src="\/hydrate.js" integrity="sha256-/);
    assert.doesNotMatch(html, /<script>bad/);
    /** Owned DOM emulator; hydration execution uses only the locally authored bundled entry. */
    const dom = new JSDOM(html);
    /** Exact prior DOM globals restored after the synthetic hydration fixture. */
    const previousGlobals = {};
    for (const key of [
      'window',
      'document',
      'Node',
      'Element',
      'HTMLElement',
      'Text',
      'Comment',
    ]) {
      previousGlobals[key] = globalThis[key];
      globalThis[key] = dom.window[key];
    }
    try {
      /** SSR root adopted by the fixture hydration entry without replacing retained nodes. */
      const container = dom.window.document.getElementById('zyro-root');
      /** Original heading node whose object identity must survive hydration. */
      const heading = container.querySelector('h1');
      /** Locally generated fixture bundle imported explicitly, never remote or caller-supplied code. */
      const clientSource = await readFile(
        path.join(root, '.zerux/build/public/hydrate.js'),
        'utf8'
      );
      /** Hydration owner disposed before restoring global DOM bindings. */
      const { mounted } = await import(
        'data:text/javascript;base64,' +
          Buffer.from(clientSource).toString('base64')
      );
      try {
        assert.equal(container.querySelector('h1'), heading);
        assert.equal(heading.textContent, '</script><script>bad</script>');
      } finally {
        mounted.dispose();
      }
    } finally {
      for (const [key, value] of Object.entries(previousGlobals)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      }
      dom.window.close();
    }
    await assert.rejects(
      buildProjectSources({
        rootDir: root,
        clientEntries: { hydrate: '/missing.js' },
      })
    );
    assert.equal(
      await readFile(
        path.join(root, '.zerux/build/public-assets.json'),
        'utf8'
      ),
      previous
    );
  } finally {
    await f?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('CRLF and missing dependencies fail privately; explicit precommit boundary recovers', async () => {
  assert.throws(() =>
    createRenderAssets({
      schema: 1,
      assets: [{ url: '//evil/a.js' }],
      namedEntries: {},
    })
  );
  assert.throws(() =>
    createZyroDocumentRenderer({ security: () => policy.createResponse() })
  );
  /** Isolated document fixture disposed after render and response ownership checks. */
  const f = await fixture();
  try {
    /** Generation plugin API registering only the authored fixture routes and renderers. */
    const api = f.app.runtime().asPluginApi();
    for (const [url, options] of [
      [
        'bad',
        {
          security: () => ({ headers: { 'x-test': 'x\r\ny: z' } }),
          render: () => ({ html: 'private' }),
        },
      ],
      [
        'boundary',
        {
          security: () => policy.createResponse(),
          /** Exercise either deliberate precommit failure or cooperative request-owned streaming.
           * @returns {object | never} Authored stream descriptor or intentional private renderer failure.
           */
          render() {
            throw Error('SECRET dependency');
          },
          errorBoundary: () => ({ html: '<p>Unavailable</p>' }),
        },
      ],
    ]) {
      /** Registered renderer reference bound to its generation registry. */
      const token = api
        .renderers()
        .register({ ...createZyroDocumentRenderer(options), name: url });
      api.addRoute({
        pattern: '/' + url,
        handler: (ctx) => ctx.render(token, null),
      });
    }
    /** Sanitized invalid-header response that must omit private render data. */
    const bad = await fetch(f.base + '/bad', {
      headers: { accept: 'application/json' },
    });
    assert.equal(bad.status, 500);
    assert.doesNotMatch(await bad.text(), /private|stack/);
    /** Explicit precommit renderer recovery response containing only authored fallback HTML. */
    const boundary = await fetch(f.base + '/boundary');
    assert.equal(boundary.status, 200);
    assert.match(await boundary.text(), /Unavailable/);
  } finally {
    await f.close();
  }
});
test('independent stream fixture preserves precommit errors and terminates after commitment', async () => {
  let mutable = false,
    returned = 0;
  /** Ephemeral loopback listener owned and closed by this fixture. */
  const server = createServer(
    (req, res) =>
      void (async () => {
        try {
          await sendStream(
            res,
            stream(
              (async function* () {
                try {
                  if (req.url === '/early') {
                    throw Error('PRIVATE');
                  }
                  yield 'first';
                  await new Promise((r) => setTimeout(r, 10));
                  throw Error('PRIVATE');
                } finally {
                  returned++;
                }
              })()
            ),
            req
          );
        } catch {
          if (!res.headersSent) {
            mutable = true;
            res.statusCode = 500;
            res.end('safe');
          } else {
            res.destroy();
          }
        }
      })()
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  /** Ephemeral loopback origin for direct early/late stream-failure requests. */
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    /** Failure response before commitment, when safe status/body replacement remains possible. */
    const early = await fetch(base + '/early');
    assert.equal(early.status, 500);
    assert.equal(await early.text(), 'safe');
    assert.equal(mutable, true);
    /** Already committed stream response whose later source error must terminate the body. */
    const late = await fetch(base + '/late');
    assert.equal(late.status, 200);
    await assert.rejects(late.text());
    assert.equal(returned, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test('runtime early stream failures are sanitized; disconnect disposes renderer exactly once', async () => {
  /** Isolated document fixture disposed after render and response ownership checks. */
  const f = await fixture();
  let disposed = 0,
    ended = 0;
  try {
    /** Generation plugin API registering only the authored fixture routes and renderers. */
    const api = f.app.runtime().asPluginApi();
    api.addRoute({
      pattern: '/early',
      handler: () =>
        stream(
          // eslint-disable-next-line require-yield -- This negative fixture throws before yielding to exercise iterator failure cleanup.
          (async function* () {
            throw Error('PRIVATE');
          })()
        ),
    });
    /** Registered renderer reference bound to its generation registry. */
    const token = api.renderers().register({
      name: 'cooperative',
      capabilities: {
        staticHtml: false,
        streaming: true,
        hydration: false,
        clientOnly: false,
      },
      /** Exercise either deliberate precommit failure or cooperative request-owned streaming.
       * @param {unknown} _ - Unused fixture view.
       * @param {object} ctx - Render context supplying cancellation and disposal ownership.
       * @returns {object | never} Authored stream descriptor or intentional private renderer failure.
       */
      render(_, ctx) {
        ctx.onDispose(() => disposed++);
        return {
          kind: 'stream',
          source: (async function* () {
            try {
              yield 'first';
              await new Promise((r) =>
                ctx.signal.aborted
                  ? r()
                  : ctx.signal.addEventListener('abort', r, { once: true })
              );
            } finally {
              ended++;
            }
          })(),
        };
      },
    });
    api.addRoute({
      pattern: '/stream',
      handler: (ctx) => ctx.render(token, null, 'streaming'),
    });
    /** Failure response before commitment, when safe status/body replacement remains possible. */
    const early = await fetch(f.base + '/early', {
      headers: { accept: 'application/json' },
    });
    assert.equal(early.status, 500);
    assert.doesNotMatch(await early.text(), /PRIVATE|stack/);
    await new Promise((resolve, reject) => {
      /** Owned native streaming request whose response is deliberately disconnected. */
      const req = request(f.base + '/stream', (res) => {
        res.once('data', () => {
          res.destroy();
          resolve();
        });
        res.on('error', () => {});
      });
      req.on('error', reject);
      req.end();
    });
    for (let i = 0; i < 100 && disposed === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(disposed, 1);
    assert.equal(ended, 1);
    assert.equal(api.renderers().activeRenders, 0);
  } finally {
    await f.close();
  }
});
test('HEAD returns an unstarted source exactly once and enforces stream privacy', async () => {
  let released = 0,
    pulled = 0;
  /** Ephemeral loopback listener owned and closed by this fixture. */
  const server = createServer(
    (req, res) =>
      void sendStream(
        res,
        stream(
          {
            /** Expose a controlled source iterator for pull, return and failure ownership checks.
             * @returns {object} Iterator whose next/return outcomes are asserted by this fixture.
             */
            [Symbol.asyncIterator]() {
              return {
                /** Produce the fixture next result or deliberately throw the primary source error.
                 * @returns {Promise<object> | never} Controlled iterator result; no remote source is read.
                 */
                next() {
                  pulled++;
                  return Promise.resolve({ done: false, value: 'x' });
                },
                /** Record source return or deliberately throw its independent cleanup failure.
                 * @returns {Promise<object> | never} Terminal iterator receipt when cleanup succeeds.
                 */
                return() {
                  released++;
                  return Promise.resolve({ done: true });
                },
              };
            },
          },
          { headers: { 'Cache-Control': 'public' } }
        ),
        req
      )
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    /** Native or synthetic response fixture used to assert stream privacy and cleanup. */
    const res = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'HEAD',
    });
    assert.equal(res.headers.get('cache-control'), 'no-store, no-transform');
    assert.equal(pulled, 0);
    await new Promise((r) => setImmediate(r));
    assert.equal(released, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test('backpressure stops pulls and removes owned listeners after settlement', async () => {
  /** Native event primitive used to model response backpressure without a browser. */
  const { EventEmitter } = await import('node:events');
  /** Native or synthetic response whose streaming/conditional lifecycle is under test. */
  const response = new EventEmitter();
  let pulls = 0,
    returns = 0,
    writes = 0;
  Object.assign(response, {
    destroyed: false,
    headersSent: false,
    writableEnded: false,
    /** Ignore response headers in the minimal backpressure-only fixture.
     * @returns {void} No native header write is required.
     */
    setHeader() {},
    /** Apply first-write backpressure until the explicit drain event.
     * @returns {boolean} False on the first write and true thereafter.
     */
    write() {
      writes++;
      response.headersSent = true;
      return writes !== 1;
    },
    /** Mark synthetic response completion and invoke its optional settlement callback.
     * @param {Function} callback - Optional completion callback supplied by stream response ownership.
     * @returns {void} Completes the synthetic response without a native socket.
     */
    end(callback) {
      response.writableEnded = true;
      callback?.();
    },
  });
  /** Original response listener count used to detect leaked drain/terminal listeners. */
  const before = response.eventNames().length;
  /** Streaming operation retained until drain and source settlement complete. */
  const done = sendStream(
    response,
    stream({
      /** Expose a controlled source iterator for pull, return and failure ownership checks.
       * @returns {object} Iterator whose next/return outcomes are asserted by this fixture.
       */
      [Symbol.asyncIterator]() {
        return {
          /** Produce the fixture next result or deliberately throw the primary source error.
           * @returns {Promise<object> | never} Controlled iterator result; no remote source is read.
           */
          next() {
            pulls++;
            return Promise.resolve(
              pulls === 1 ? { done: false, value: 'chunk' } : { done: true }
            );
          },
          /** Record source return or deliberately throw its independent cleanup failure.
           * @returns {Promise<object> | never} Terminal iterator receipt when cleanup succeeds.
           */
          return() {
            returns++;
            return Promise.resolve({ done: true });
          },
        };
      },
    })
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(pulls, 1);
  assert.equal(writes, 1);
  response.emit('drain');
  await done;
  assert.equal(pulls, 2);
  assert.equal(returns, 1);
  assert.equal(response.eventNames().length, before);
});
test('direct streams retain production and cleanup errors, and reject forged asset descriptors', async () => {
  /** Native event primitive used to model response backpressure without a browser. */
  const { EventEmitter } = await import('node:events');
  /** Native or synthetic response fixture used to assert stream privacy and cleanup. */
  const res = new EventEmitter();
  Object.assign(res, {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
  });
  /** Primary source failure retained ahead of any independent cleanup failure. */
  const first = Error('first');
  /** Independent iterator-return failure that must remain visible alongside the primary cause. */
  const cleanup = Error('cleanup');
  await assert.rejects(
    sendStream(
      res,
      stream({
        /** Expose a controlled source iterator for pull, return and failure ownership checks.
         * @returns {object} Iterator whose next/return outcomes are asserted by this fixture.
         */
        [Symbol.asyncIterator]() {
          return {
            /** Produce the fixture next result or deliberately throw the primary source error.
             * @returns {Promise<object> | never} Controlled iterator result; no remote source is read.
             */
            next() {
              throw first;
            },
            /** Record source return or deliberately throw its independent cleanup failure.
             * @returns {Promise<object> | never} Terminal iterator receipt when cleanup succeeds.
             */
            return() {
              throw cleanup;
            },
          };
        },
      })
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === first &&
      error.errors[1] === cleanup
  );
  assert.equal(res.eventNames().length, 0);
  assert.throws(
    () =>
      createZyroDocumentRenderer({
        security: () => policy.createResponse(),
        render: () => ({ html: '' }),
        clientEntry: 'forged',
        assets: { entry: () => ({ url: '"><script>', integrity: 'bad' }) },
      }),
    (e) => e.code === 'RENDER_ASSET_MANIFEST_INVALID'
  );
});
test('missing candidate document asset rolls back preparation and preserves the active generation', async () => {
  /** Isolated document fixture disposed after render and response ownership checks. */
  const f = await fixture();
  try {
    /** Currently serving generation preserved when candidate asset validation rejects. */
    const original = f.app.runtime();
    original
      .asPluginApi()
      .addRoute({ pattern: '/', handler: () => ({ generation: 'good' }) });
    await mkdir(path.join(f.root, 'node_modules'));
    await symlink(
      path.resolve('.'),
      path.join(f.root, 'node_modules/zeruxjs'),
      'dir'
    );
    await mkdir(path.join(f.root, 'plugins'));
    /** Private fixture receipt path proving the rejected candidate ran its cleanup. */
    const marker = path.join(f.root, 'candidate-disposed');
    await writeFile(
      path.join(f.root, 'plugins/document.mjs'),
      `import {createRenderAssets,createZyroDocumentRenderer} from 'zeruxjs/renderers';import {writeFile} from 'node:fs/promises';export default function(api){api.onDispose(()=>writeFile(${JSON.stringify(marker)},'closed'));api.renderers().register(createZyroDocumentRenderer({security:()=>({headers:{}}),render:()=>({html:'candidate'}),assets:createRenderAssets({schema:1,assets:[],namedEntries:{}}),clientEntry:'missing'}));}`
    );
    await assert.rejects(
      f.app.reload({}),
      (e) => e.code === 'RENDER_ASSET_ENTRY_MISSING'
    );
    assert.equal(f.app.runtime(), original);
    assert.equal(f.app.status().generation, 1);
    assert.equal(await readFile(marker, 'utf8'), 'closed');
    /** Native or synthetic response whose streaming/conditional lifecycle is under test. */
    const response = await fetch(f.base);
    assert.deepEqual(await response.json(), { generation: 'good' });
  } finally {
    await f.close();
  }
});
