import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
  readFile,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApplicationLifecycle, buildProjectSources } from 'zeruxjs';
import { redirect } from 'zeruxjs/navigation';
import {
  createZyroDocumentRenderer,
  createRenderAssets,
} from 'zeruxjs/renderers';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { defineComponent, h } from 'zyrojs/component';
import { renderToHydratable } from 'zyrojs/server';
import {
  createBrowserRouter,
  createDocumentNavigationRenderer,
  readPublicRouteManifest,
  createPublicRouteManifest,
  matchNavigationRoute,
} from 'zeruxjs/browser-navigation';
/** Build only the explicit public route metadata fixture.
 * @param {string} id - Stable route identifier.
 * @param {string[]} [layouts] - Authored nested layout identifiers.
 * @returns {object} Public navigation metadata without private route configuration.
 */
const metadata = (id, layouts = []) => ({ navigation: { id, layouts } });
/** Explicit development response security composer used by the loopback SSR fixture. */
const policy = createSecurityPolicy({ mode: 'development' });
/** Pure authored heading component shared by synthetic server rendering fixtures. */
const Page = defineComponent((props) => () => h('h1', {}, props.name));
/** Project the authored public heading property.
 * @param {object} v - Synthetic public props.
 * @returns {{name: string}} Inert string heading data.
 */
const validateProps = (v) => ({ name: String(v.name) });
/** Render fixed synthetic navigation markup; hostile data variants are intentional rejection fixtures.
 * @param {string} id - Public route identity marker.
 * @param {string} name - Authored heading/title.
 * @param {{scope?: string, policy?: string, layouts?: string[], data?: string}} [options] - Explicit fixture boundary markers and authored content.
 * @returns {string} Synthetic document, never a general untrusted HTML renderer.
 */
const shell = (
  id,
  name,
  { scope = 'scopeA', policy = 'policy1', layouts = ['shell'], data = '' } = {}
) =>
  `<!doctype html><html><head><title>${name}</title></head><body><a id="outside" href="/app/users/1">Outside</a><div id="app" data-zerux-scope="${scope}" data-zerux-policy="${policy}" data-zerux-route="${id}">${layouts.map((id) => `<section data-zerux-layout="${id}"><nav>Persistent</nav><div data-zerux-outlet>`).join('')}<h1 id="heading">${name}</h1><a id="hash" href="#heading">Anchor</a><form><input id="field" value="untouched"></form>${data}${layouts.map(() => '</div></section>').join('')}</div></body></html>`;
/** Construct a synthetic fetch representation retaining its explicit response URL.
 * @param {BodyInit} html - Authored fixture body.
 * @param {string | URL} url - Final synthetic URL.
 * @param {number} [status] - Authored response status.
 * @returns {Response} Fixture representation with an explicitly defined URL.
 */
const response = (html, url, status = 200) => {
  /** Synthetic response whose URL is set explicitly to model navigation fetch results. */
  const res = new Response(html, {
    status,
    headers: { 'content-type': 'text/html' },
  });
  Object.defineProperty(res, 'url', { value: String(url) });
  return res;
};
/** Create an owned DOM emulator with explicit scroll receipts for navigation assertions.
 * @param {string} html - Fixed authored synthetic document.
 * @param {string} url - Initial page origin/path used by emulated history.
 * @returns {object} DOM/window/root owner and observable scroll receipts.
 */
function dom(html, url = 'http://localhost/app') {
  /** Owned DOM emulator used for history/focus fixtures, not live-browser qualification. */
  const dom = new JSDOM(html, { url });
  /** Window borrowed from the owned DOM emulator. */
  const win = dom.window;
  /** Recorded synthetic scroll operations; this does not measure real browser layout. */
  const scrolls = [];
  win.scrollTo = (x, y) => {
    scrolls.push([x, y]);
    Object.defineProperty(win, 'scrollX', { value: x, configurable: true });
    Object.defineProperty(win, 'scrollY', { value: y, configurable: true });
  };
  win.HTMLElement.prototype.scrollIntoView = function () {
    scrolls.push(this.id);
  };
  return { dom, win, root: win.document.getElementById('app'), scrolls };
}
/** Create the fixed public route manifest.
 * @returns {object} Validated mounted routes and explicit boundaries.
 */
const manifest = () =>
  createPublicRouteManifest({
    basePath: '/app',
    boundaries: { notFound: 'missing', error: 'error' },
    routes: [
      { id: 'home', pattern: '/app', layouts: ['shell'] },
      { id: 'user', pattern: '/app/users/:id', layouts: ['shell'] },
      { id: 'new', pattern: '/app/users/new', layouts: ['shell'] },
      { id: 'file', pattern: '/app/files/:rest*', layouts: ['shell', 'files'] },
      { id: 'error', pattern: '/app/error', layouts: ['shell'] },
      { id: 'missing', pattern: '/app/:rest*', layouts: ['shell'] },
    ],
  });
/** Poll a fixture predicate with a finite one-second bound, then assert settlement.
 * @param {() => boolean} check - Synchronous bounded condition to observe.
 * @returns {Promise<void>} Completes only when the condition becomes true within the fixture budget.
 */
async function wait(check) {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(check(), 'condition settled');
}
/** Create a mounted SSR/navigation runtime on an ephemeral loopback listener.
 * @returns {Promise<object>} Application/API/manifest fixture with owned close helper.
 */
async function serverFixture() {
  /** Temporary navigation project owning generated routes and local fixture assets. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx094-'));
  /** Application generation owning renderers and server-side route metadata. */
  const app = await createApplicationLifecycle({
    rootDir: root,
    config: {},
    providers: { database: async () => null, cache: async () => null },
  });
  /** Generation plugin API registering only the authored fixture routes. */
  const api = app.runtime().asPluginApi();
  /** Generation-registered document renderer emitting explicit navigation boundary markers. */
  const zyro = api.renderers().register(
    createZyroDocumentRenderer({
      security: () => policy.createResponse(),
      render: (view) => ({
        html: renderToHydratable(
          Page,
          { name: view.name },
          { validateProps, idPrefix: 'page' }
        ).html,
      }),
      layout: (view) => ({
        before: `<!doctype html><html><head><title>${view.id}</title></head><body><div id="app" data-zerux-scope="scopeA" data-zerux-policy="policy1" data-zerux-route="${view.id}"><section data-zerux-layout="shell"><nav>Persistent</nav><div data-zerux-outlet>`,
        after: '</div></section></div></body></html>',
      }),
    })
  );
  for (const [pattern, id] of [
    ['/app', 'home'],
    ['/app/users/:id', 'user'],
    ['/app/users/new', 'new'],
  ]) {
    api.addRoute({
      pattern,
      method: 'GET',
      meta: {
        ...metadata(id, ['shell']),
        password: 'PRIVATE',
        source: '/private/file.ts',
      },
      handler: (ctx) => ctx.render(zyro, { id, name: ctx.params.id ?? id }),
    });
  }
  api.addRoute({
    pattern: '/app/old',
    handler: () => redirect('/app/users/42'),
    meta: metadata('old'),
  });
  api.addRoute({
    pattern: '/app/private',
    meta: metadata('private'),
    handler: (ctx) => {
      ctx.res.writeHead(401, { 'content-type': 'text/plain' });
      ctx.res.end('denied');
    },
  });
  api.addRoute({
    pattern: '/app/error',
    meta: metadata('error', ['shell']),
    handler: (ctx) => {
      ctx.res.writeHead(500, { 'content-type': 'text/html' });
      ctx.res.end(shell('error', 'Error'));
    },
  });
  api.addRoute({
    pattern: '/app/:rest*',
    meta: metadata('missing', ['shell']),
    handler: (ctx) => {
      ctx.res.writeHead(404, { 'content-type': 'text/html' });
      ctx.res.end(shell('missing', 'Not found'));
    },
  });
  /** Public route manifest containing only explicit route/layout boundary metadata. */
  const manifest = api.navigationManifest({
    basePath: '/app',
    boundaries: { notFound: 'missing', error: 'error' },
  });
  /** Test-owned ephemeral loopback listener closed after application drain. */
  const server = createServer(
    (req, res) => void app.handle(req, res).catch(() => res.destroy())
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    root,
    app,
    api,
    manifest,
    base: `http://127.0.0.1:${server.address().port}`,
    /** Drain the generation, close native connections and remove its isolated project.
     * @returns {Promise<void>} Completes after all server fixture ownership settles.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('runtime snapshot matches real precedence and normal HTTP remains useful without JavaScript', async () => {
  /** Isolated server fixture whose close releases generation, native listener and files. */
  const f = await serverFixture();
  try {
    assert.equal(
      matchNavigationRoute(f.manifest, '/app/users/new').route.id,
      'new'
    );
    assert.equal(
      matchNavigationRoute(f.manifest, '/app/users/7').params.id,
      '7'
    );
    assert.doesNotMatch(
      JSON.stringify(f.manifest),
      /PRIVATE|source|handler|\.ts|password/
    );
    assert.equal(
      matchNavigationRoute(f.manifest, '/application/users/7'),
      null
    );
    /** Native SSR response proving initial content works without client navigation. */
    const initial = await fetch(f.base + '/app/users/7');
    assert.match(await initial.text(), />7<\/h1>/);
    assert.equal((await fetch(f.base + '/app/nothing')).status, 404);
  } finally {
    await f.close();
  }
});
test('non-root navigation, server redirects/denial, reused layout, focus and actual Back/Forward', async () => {
  /** Isolated server fixture whose close releases generation, native listener and files. */
  const f = await serverFixture();
  let ui, router;
  /** Document-navigation receipts recording rejected client transitions. */
  const fallbacks = [];
  try {
    ui = dom(await (await fetch(f.base + '/app')).text(), f.base + '/app');
    router = createBrowserRouter({
      manifest: f.manifest,
      root: ui.root,
      scope: () => 'scopeA',
      fetch,
      documentNavigate: (url) => fallbacks.push(url),
    });
    /** Original shared layout node retained across a compatible navigation commit. */
    const layout = ui.root.querySelector('section');
    assert.equal(await router.navigate('/app/users/new'), 'committed');
    assert.equal(ui.root.querySelector('section'), layout);
    assert.equal(ui.win.document.activeElement.tagName, 'H1');
    ui.win.scrollTo(0, 250);
    assert.equal(await router.navigate('/app/old'), 'committed');
    assert.equal(ui.win.location.pathname, '/app/users/42');
    ui.win.history.back();
    await wait(
      () =>
        ui.win.location.pathname === '/app/users/new' && router.pending === 0
    );
    assert.deepEqual(ui.scrolls.at(-1), [0, 250]);
    ui.win.history.forward();
    await wait(
      () => ui.win.location.pathname === '/app/users/42' && router.pending === 0
    );
    assert.equal(await router.navigate('/app/nothing'), 'committed');
    assert.match(ui.root.textContent, /Not found/);
    assert.equal(await router.navigate('/app/private'), 'document');
    assert.equal(fallbacks.at(-1), f.base + '/app/private');
    assert.match(ui.root.textContent, /Not found/);
    assert.equal(await router.navigate('/app/error'), 'committed');
    assert.match(ui.root.textContent, /Error/);
    await router.close();
    assert.equal(ui.win.document.querySelector('[role=status]'), null);
  } finally {
    await router?.close();
    ui?.dom.window.close();
    await f.close();
  }
});
test('link eligibility, keyboard click, hash anchors and forms retain progressive behavior', async () => {
  /** Owned DOM-emulated page closed after the browser router drains. */
  const ui = dom(shell('home', 'Home'));
  /** Injected fetch receipts used to assert link eligibility and hash-only behavior. */
  const calls = [];
  /** Document-navigation receipts recording rejected client transitions. */
  const fallbacks = [];
  /** Browser navigation owner closed before its DOM window is disposed. */
  const router = createBrowserRouter({
    manifest: manifest(),
    root: ui.root,
    scope: () => 'scopeA',
    fetch: async (url) => {
      calls.push(String(url));
      return response(shell('user', 'User'), url);
    },
    documentNavigate: (url) => fallbacks.push(url),
  });
  let intercepted;
  /** Observe default prevention then stop JSDOM from navigating.
   * @param {Event} event - Synthetic click observed after router interception.
   * @returns {void} Records interception without triggering native emulated navigation.
   */
  const stop = (event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  };
  ui.win.document.addEventListener('click', stop);
  try {
    for (const attributes of [
      'target="_blank"',
      'download',
      'rel="external"',
      'data-zerux-reload',
      'href="https://elsewhere.test/"',
    ]) {
      /** Authored anchor fixture testing whether the router may intercept its activation. */
      const a = ui.win.document.createElement('a');
      a.href = '/app/users/1';
      a.innerHTML = 'link';
      a.setAttribute(
        attributes.split('=')[0],
        attributes.includes('=')
          ? attributes.split('=')[1].replaceAll('"', '')
          : ''
      );
      ui.root.append(a);
      /** Synthetic click carrying native modifier/default semantics under test. */
      const e = new ui.win.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      a.dispatchEvent(e);
      assert.equal(intercepted, false);
      a.remove();
    }
    /** Authored anchor fixture testing whether the router may intercept its activation. */
    const a = ui.win.document.createElement('a');
    a.href = '/app/users/2';
    ui.root.append(a);
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      /** Synthetic click carrying native modifier/default semantics under test. */
      const e = new ui.win.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        [key]: true,
      });
      a.dispatchEvent(e);
      assert.equal(intercepted, false);
    }
    /** Zero-detail synthetic keyboard click required to remain keyboard-usable. */
    const keyboard = new ui.win.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 0,
    });
    a.dispatchEvent(keyboard);
    assert.equal(keyboard.defaultPrevented, true);
    await wait(() => router.pending === 0);
    assert.equal(calls.length, 1);
    /** Fetch count before hash-only navigation, which must not request another document. */
    const before = calls.length;
    await router.navigate('#heading');
    assert.equal(calls.length, before);
    assert.equal(ui.win.location.hash, '#heading');
    assert.equal(ui.win.document.activeElement.id, 'heading');
    ui.root.querySelector('#field').value = 'edited';
    ui.win.history.back();
    await wait(() => ui.win.location.hash === '' && router.pending === 0);
    assert.equal(ui.root.querySelector('#field').value, 'edited');
    assert.equal(calls.length, before);
    /** Synthetic form event that must stay on the native form submission path. */
    const submit = new ui.win.Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    ui.root.querySelector('form').dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, false);
    await assert.rejects(
      router.navigate('javascript:alert(1)'),
      (e) => e.code === 'NAVIGATION_URL_DENIED'
    );
    assert.equal(fallbacks.length, 0);
  } finally {
    await router.close();
    ui.dom.window.close();
  }
});
test('rapid navigation aborts cooperative loads and suppresses stale ignored cancellations', async () => {
  /** Owned DOM-emulated page closed after the browser router drains. */
  const ui = dom(shell('home', 'Home'));
  /** Deferred fetch completions released out of order to prove stale-response fencing. */
  const resolves = [];
  /** Request signals captured to verify cancellation does not imply forced settlement. */
  const signals = [];
  let disposed = 0;
  /** Browser navigation owner closed before its DOM window is disposed. */
  const router = createBrowserRouter({
    manifest: manifest(),
    root: ui.root,
    scope: () => 'scopeA',
    initialOwner: { dispose: () => disposed++ },
    fetch: (url, init) => {
      signals.push(init.signal);
      return new Promise((resolve) =>
        resolves.push(() =>
          resolve(response(shell('user', new URL(url).pathname), url))
        )
      );
    },
    documentNavigate: () => assert.fail('no fallback'),
  });
  try {
    /** Earlier pending navigation whose late response must not replace a newer commit. */
    const old = router.navigate('/app/users/one');
    /** Latest navigation allowed to commit before the older ignored cancellation settles. */
    const latest = router.navigate('/app/users/two');
    assert.equal(signals[0].aborted, true);
    resolves[1]();
    assert.equal(await latest, 'committed');
    resolves[0]();
    assert.equal(await old, 'cancelled');
    assert.match(ui.root.textContent, /two/);
    assert.equal(disposed, 1);
    assert.equal(router.pending, 0);
  } finally {
    await router.close();
    ui.dom.window.close();
  }
});
test('body limits, dependency failure, timeout, scope changes and cleanup fail back to normal navigation', async () => {
  for (const kind of [
    'large',
    'nodes',
    'dependency',
    'timeout',
    'scope',
    'policy',
    'unsafe',
  ]) {
    /** Owned DOM-emulated page closed after the browser router drains. */
    const ui = dom(shell('home', 'Home'));
    /** Document-navigation receipts recording rejected client transitions. */
    const fallbacks = [];
    let cancelled = 0,
      resolve;
    /** Browser navigation owner closed before its DOM window is disposed. */
    const router = createBrowserRouter({
      manifest: manifest(),
      root: ui.root,
      scope: () => 'scopeA',
      maxBytes: kind === 'large' ? 20 : 1048576,
      maxNodes: kind === 'nodes' ? 3 : 10000,
      timeoutMs: kind === 'timeout' ? 5 : 1000,
      fetch: async (url, init) => {
        if (kind === 'dependency') {
          throw Error('PRIVATE backend');
        }
        if (kind === 'timeout') {
          return new Promise((r) => {
            resolve = r;
            init.signal.addEventListener('abort', () => r(response('', url)), {
              once: true,
            });
          });
        }
        /** Select the exact invalid document for this navigation boundary. */
        const html = (() => {
          if (kind === 'scope') {
            return shell('user', 'User', { scope: 'scopeB' });
          }
          if (kind === 'policy') {
            return shell('user', 'User', { policy: 'new-policy' });
          }
          if (kind === 'unsafe') {
            return shell('user', 'User', { data: '<img onerror="alert(1)">' });
          }
          return shell('user', 'User');
        })();
        return response(
          new ReadableStream({
            /** Produce the controlled navigation document bytes, optionally leaving the source open.
             * @param {ReadableStreamDefaultController} controller - Injected response source controller.
             * @returns {void} Enqueues the authored document and closes only the finite fixture source.
             */
            start(controller) {
              controller.enqueue(new TextEncoder().encode(html));
              if (kind !== 'large') {
                controller.close();
              }
            },
            /** Record cancellation of the deliberately oversized document source.
             * @returns {void} Increments the fixture response cleanup receipt.
             */
            cancel() {
              cancelled++;
            },
          }),
          url
        );
      },
      onError: (code) => assert.doesNotMatch(code, /PRIVATE/),
      documentNavigate: (url) => fallbacks.push(url),
    });
    try {
      assert.equal(await router.navigate('/app/users/1'), 'document');
      assert.equal(fallbacks.length, 1);
      assert.match(ui.root.textContent, /Home/);
      assert.equal(router.pending, 0);
    } finally {
      resolve?.(response('', ui.win.location.href));
      await router.close();
      ui.dom.window.close();
    }
    if (kind === 'large') {
      assert.equal(cancelled, 1);
    }
  }
});
test('nested layouts and catch-all parameters match the shared server grammar; malformed manifests reject', async () => {
  /** Validated public route snapshot used for nested-layout and malformed-input cases. */
  const m = manifest();
  assert.equal(matchNavigationRoute(m, '/app/files/a/b').params.rest, 'a/b');
  for (const input of [
    { ...m, basePath: '/app/' },
    { ...m, routes: [{ id: 'bad', pattern: '/app/:__proto__', layouts: [] }] },
    { ...m, routes: [{ id: 'bad', pattern: '/app/:id*/x', layouts: [] }] },
  ]) {
    assert.throws(() => readPublicRouteManifest(input));
  }
  /** Owned DOM-emulated page closed after the browser router drains. */
  const ui = dom(shell('home', 'Home'));
  /** Browser navigation owner closed before its DOM window is disposed. */
  const router = createBrowserRouter({
    manifest: m,
    root: ui.root,
    scope: () => 'scopeA',
    fetch: async (url) =>
      response(shell('file', 'Files', { layouts: ['shell', 'files'] }), url),
    documentNavigate: () => assert.fail('no fallback'),
  });
  try {
    /** Original parent layout node checked for identity across nested page replacement. */
    const parent = ui.root.querySelector('section');
    await router.navigate('/app/files/a/b');
    /** Original child layout node retained when only the matching nested page changes. */
    const nested = ui.root.querySelector('[data-zerux-layout="files"]');
    await router.navigate('/app/files/c');
    assert.equal(ui.root.querySelector('section'), parent);
    assert.equal(ui.root.querySelector('[data-zerux-layout="files"]'), nested);
  } finally {
    await router.close();
    ui.dom.window.close();
  }
});
test('manifest-selected built Zyro module hydrates each page, prefetches bounded assets and disposes on exit', async () => {
  /** Isolated server fixture whose close releases generation, native listener and files. */
  const f = await serverFixture();
  /** Temporary client-asset project built only for the isolated hydration fixture. */
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zx094-client-'));
  let ui, router;
  /** Exact prior DOM globals restored after importing the locally authored client bundle. */
  const globals = {};
  try {
    await mkdir(path.join(directory, 'node_modules'));
    await symlink(
      path.resolve('../../node_modules/typescript'),
      path.join(directory, 'node_modules/typescript'),
      'dir'
    );
    await mkdir(path.join(directory, 'public'));
    /** Installed bundler used to emit the fixed browser fixture without external services. */
    const { build } = await import('esbuild');
    await build({
      stdin: {
        contents: `import {defineComponent,h,signal} from 'zyrojs/component';import {hydrate} from 'zyrojs/hydrate';const Counter=defineComponent(props=>{const count=signal(props.count);return()=>h('button',{id:'counter',onClick:()=>count.value++},count.value);});export function prepare(root,context){const state=root.querySelector('#zyro-root-data'),container=root.querySelector('#zyro-root');return hydrate(Counter,container,{data:state.textContent,validateProps:value=>({count:value.count}),signal:context.signal});}`,
        resolveDir: path.resolve('../..'),
        sourcefile: 'counter-route.js',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      banner: { js: "'use client';" },
      outfile: path.join(directory, 'public/route.js'),
    });
    await buildProjectSources({
      rootDir: directory,
      clientEntries: { counter: '/route.js' },
    });
    /** Validated emitted asset manifest supplying local URL and integrity metadata. */
    const publicAssets = createRenderAssets(
      JSON.parse(
        await readFile(
          path.join(directory, '.zerux/build/public-assets.json'),
          'utf8'
        )
      )
    );
    /** Selected registered client entry; no model or user URL is loaded dynamically. */
    const asset = publicAssets.entry('counter');
    /** Locally bundled authored hydration module imported only by this isolated test. */
    const source = await readFile(
      path.join(directory, '.zerux/build/public/route.js'),
      'utf8'
    );
    f.api.addRoute({
      pattern: '/route.js',
      method: 'GET',
      handler: (ctx) => {
        ctx.res.setHeader('content-type', 'text/javascript');
        ctx.res.end(source);
      },
    });
    /** Pure authored server counterpart of the generated client counter component. */
    const Counter = defineComponent(
      (props) => () => h('button', { id: 'counter' }, props.count)
    );
    f.api.addRoute({
      pattern: '/app/counter/:id',
      method: 'GET',
      meta: {
        navigation: {
          id: 'counter',
          layouts: ['shell'],
          clientEntry: 'counter',
        },
      },
      handler: (ctx) => {
        /** Versioned SSR markup/public data for the fixed synthetic counter route. */
        const rendered = renderToHydratable(
          Counter,
          { count: Number(ctx.params.id) },
          {
            validateProps: (value) => ({ count: value.count }),
            idPrefix: 'count',
          }
        );
        ctx.res.setHeader('content-type', 'text/html');
        ctx.res.end(
          shell('counter', 'Counter', {
            data: `<div id="zyro-root">${rendered.html}</div><script type="application/json" id="zyro-root-data">${rendered.data}</script>`,
          })
        );
      },
    });
    /** Public route snapshot enriched only with registered emitted client assets. */
    const publicRoutes = f.api.navigationManifest({
      basePath: '/app',
      assets: publicAssets,
      boundaries: { notFound: 'missing', error: 'error' },
    });
    assert.deepEqual(
      publicRoutes.routes.find((route) => route.id === 'counter').asset,
      asset
    );
    ui = dom(await (await fetch(f.base + '/app')).text(), f.base + '/app');
    for (const key of [
      'window',
      'document',
      'Node',
      'Element',
      'HTMLElement',
      'Text',
      'Comment',
    ]) {
      globals[key] = globalThis[key];
      globalThis[key] = ui.win[key];
    }
    let moduleLoads = 0,
      prefetchCalls = 0;
    /** Document-navigation receipts checked after rejected or overloaded transitions. */
    const fallback = [];
    router = createBrowserRouter({
      manifest: publicRoutes,
      root: ui.root,
      scope: () => 'scopeA',
      prefetch: true,
      maxPrefetch: 1,
      fetch: (url, init) => {
        if (init.integrity) {
          prefetchCalls++;
          assert.equal(init.credentials, 'omit');
        }
        return fetch(url, init);
      },
      renderer: createDocumentNavigationRenderer({
        loadModule: async (found, signal) => {
          moduleLoads++;
          assert.equal(found.url, asset.url);
          signal.throwIfAborted();
          return import(
            'data:text/javascript;base64,' +
              Buffer.from(source).toString('base64')
          );
        },
      }),
      documentNavigate: (url) => fallback.push(url),
    });
    assert.equal(await router.prefetch('/app/counter/1'), true);
    assert.equal(await router.prefetch('/app/counter/2'), true);
    assert.equal(prefetchCalls, 1);
    assert.equal(moduleLoads, 0);
    await router.navigate('/app/counter/1');
    /** Detached prior counter element used to prove its event owner was disposed. */
    const previous = ui.root.querySelector('button');
    previous.click();
    assert.equal(previous.textContent, '2');
    /** Original parent layout node checked for identity across nested page replacement. */
    const parent = ui.root.querySelector('section');
    await router.navigate('/app/counter/3');
    assert.equal(ui.root.querySelector('section'), parent);
    assert.equal(ui.root.querySelector('button').textContent, '3');
    /** Last prior-node value that must remain unchanged after disposal. */
    const disposedText = previous.textContent;
    previous.click();
    assert.equal(previous.textContent, disposedText);
    await router.navigate('/app');
    assert.equal(moduleLoads, 2);
    assert.equal(fallback.length, 0);
  } finally {
    await router?.close();
    ui?.dom.window.close();
    for (const [key, value] of Object.entries(globals)) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('loader cache is operation/scope-local, errors roll back resources and startup/close release ownership', async () => {
  /** Owned DOM-emulated page closed after the browser router drains. */
  const ui = dom(shell('home', 'Home'));
  let producers = 0,
    disposed = 0,
    scope = 'scopeA';
  /** Injected page transaction owner exercising scope-local loader memoization and rollback. */
  const renderer = {
    /** Prepare a page transaction using only request/scope-local loader memoization.
     * @param {{incoming: Element, context: object, root: Element}} options - Parsed incoming page, operation context and owned current page root.
     * @returns {Promise<object>} Commit/dispose transaction; deliberate provider failure rejects before commit.
     */
    async prepare({ incoming, context, root }) {
      context.onDispose(() => disposed++);
      /** First operation-local loader promise; the second lookup must reuse it. */
      const a = context.load('record', async (signal) => {
        producers++;
        assert.equal(signal.aborted, false);
        return context.scope;
      });
      /** Second request-local loader promise required to reuse the first operation cache entry. */
      const b = context.load('record', async () => assert.fail('memoized'));
      assert.equal(a, b);
      assert.equal(await a, 'scopeA');
      if (context.url.pathname.endsWith('fail')) {
        throw Error('PRIVATE provider');
      }
      return {
        commit: () => root.replaceChildren(...incoming.childNodes),
        /** Inert page-owner callback; resource cleanup belongs to context.onDispose in this fixture.
         * @returns {void} No independent resource is acquired by this callback.
         */
        dispose() {},
      };
    },
  };
  /** Document-navigation receipts recording rejected client transitions. */
  const fallbacks = [];
  /** Browser navigation owner closed before its DOM window is disposed. */
  const router = createBrowserRouter({
    manifest: manifest(),
    root: ui.root,
    scope: () => scope,
    renderer,
    fetch: async (url) => response(shell('user', 'User'), url),
    documentNavigate: (url) => fallbacks.push(url),
  });
  try {
    await router.navigate('/app/users/1');
    await router.navigate('/app/users/2');
    assert.equal(producers, 2);
    assert.equal(disposed, 1);
    await router.navigate('/app/users/fail');
    assert.equal(disposed, 2);
    assert.equal(fallbacks.length, 1);
    scope = 'scopeB';
    await router.navigate('/app/users/3');
    assert.equal(producers, 3);
    assert.equal(fallbacks.length, 2);
    await router.close();
    await router.close();
    assert.equal(disposed, 3);
    assert.equal(router.pending, 0);
    scope = 'scopeA';
    /** New router owner proving close released the original page/history ownership. */
    const replacement = createBrowserRouter({
      manifest: manifest(),
      root: ui.root,
      scope: () => scope,
      fetch: async (url) => response(shell('user', 'User'), url),
    });
    await replacement.close();
  } finally {
    await router.close();
    ui.dom.window.close();
  }
  /** Separate DOM fixture whose unavailable history boundary must fail startup cleanly. */
  const failed = dom(shell('home', 'Home'));
  failed.win.history.replaceState = () => {
    throw Error('cannot own history');
  };
  assert.throws(
    () =>
      createBrowserRouter({
        manifest: manifest(),
        root: failed.root,
        scope: () => 'scopeA',
        fetch,
      }),
    (e) => e.code === 'NAVIGATION_HISTORY_UNAVAILABLE'
  );
  assert.equal(failed.win.document.querySelector('[role=status]'), null);
  failed.dom.window.close();
});
test('close during pending load aborts and awaits actual settlement; overload never creates unbounded jobs', async () => {
  /** Owned DOM-emulated page closed after the browser router drains. */
  const ui = dom(shell('home', 'Home'));
  /** Document-navigation receipts checked after rejected or overloaded transitions. */
  const fallback = [];
  /** Request signals captured to verify cancellation does not imply forced settlement. */
  const signals = [];
  let settle;
  /** Browser navigation owner closed before its DOM window is disposed. */
  const router = createBrowserRouter({
    manifest: manifest(),
    root: ui.root,
    scope: () => 'scopeA',
    maxActive: 1,
    fetch: (url, init) => {
      signals.push(init.signal);
      return new Promise(
        (resolve) =>
          (settle = () => resolve(response(shell('user', 'Late'), url)))
      );
    },
    documentNavigate: (url) => fallback.push(url),
  });
  /** Accepted navigation retaining the sole active slot until transport settlement. */
  const pending = router.navigate('/app/users/1');
  assert.equal(await router.navigate('/app/users/2'), 'document');
  assert.equal(router.pending, 1);
  let closed = false;
  /** Router close promise checked before the noncooperating load is released. */
  const closing = router.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  assert.equal(signals[0].aborted, true);
  settle();
  assert.equal(await pending, 'cancelled');
  await closing;
  assert.equal(router.pending, 0);
  assert.equal(fallback.length, 1);
  ui.dom.window.close();
});
test('file route metadata uses the same static/dynamic/catch-all order and public allowlist', async () => {
  /** Temporary navigation project owning generated routes and local fixture assets. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx094-files-'));
  let app, server;
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    for (const [file, id] of [
      ['app/users/[id]/page.mjs', 'user'],
      ['app/users/new.mjs', 'new'],
      ['app/files/[...rest].mjs', 'file'],
    ]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(
        path.join(root, file),
        `export const meta={navigation:{id:'${id}'},privateKey:'PRIVATE'};export function GET(ctx){return {id:'${id}',params:ctx.params};}`
      );
    }
    await writeFile(
      path.join(root, 'app/hidden.mjs'),
      'export function GET(){return "private route";}'
    );
    app = await createApplicationLifecycle({
      rootDir: root,
      config: {},
      providers: { database: async () => null, cache: async () => null },
    });
    /** Public snapshot derived from actual file routes using the shared route grammar. */
    const routes = app.runtime().asPluginApi().navigationManifest({});
    assert.equal(routes.routes.length, 3);
    assert.equal(matchNavigationRoute(routes, '/users/new').route.id, 'new');
    assert.equal(matchNavigationRoute(routes, '/files/a/b').params.rest, 'a/b');
    assert.doesNotMatch(JSON.stringify(routes), /private|PRIVATE|\.mjs|hidden/);
    server = createServer((req, res) => void app.handle(req, res));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Native route response or in-memory bundle receipt checked at its public boundary. */
    const result = await (
      await fetch(`http://127.0.0.1:${server.address().port}/users/new`)
    ).json();
    assert.equal(result.id, 'new');
  } finally {
    await app?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await rm(root, { recursive: true, force: true });
  }
});
test('browser router bundles through the installed public entry without Node runtime modules', async () => {
  /** Installed bundler used to emit the fixed browser fixture without external services. */
  const { build } = await import('esbuild');
  /** Native route response or in-memory bundle receipt checked at its public boundary. */
  const result = await build({
    stdin: {
      contents:
        "export {createBrowserRouter,createDocumentNavigationRenderer} from 'zeruxjs/browser-navigation';",
      resolveDir: path.resolve('../..'),
      sourcefile: 'navigation-entry.js',
    },
    platform: 'browser',
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
  });
  assert.ok(result.outputFiles[0].text.includes('createBrowserRouter'));
  assert.equal(
    Object.keys(result.metafile.inputs).some((name) =>
      /bootstrap\/|node:|renderers\.js/.test(name)
    ),
    false
  );
});
