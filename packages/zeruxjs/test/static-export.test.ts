import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { exportStaticSite } from 'zeruxjs/static-export';
import {
  createZyroRenderer,
  createZyroDocumentRenderer,
} from 'zeruxjs/renderers';
import { buildProjectSources } from 'zeruxjs';
import { h, renderToString } from 'zyrojs/dom';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
/** Create a pure marker-free HTML renderer for public export fixtures.
 * @returns {object} Renderer over authored heading/image data; no browser or network owner is allocated.
 */
const renderer = () =>
  createZyroRenderer((view) =>
    renderToString(
      h(
        'main',
        {},
        h('h1', {}, view.heading),
        view.image ? h('img', { src: view.image, alt: 'Logo' }) : null
      )
    )
  );
/** Describe a public mounted project with finite dynamic routes and an explicit missing page.
 * @returns {Promise<object>} Fixture options/output root and close owner; no export runs implicitly.
 */
async function fixture() {
  /** Temporary project root owning all export candidates and emitted assets. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx096-'));
  return {
    root,
    output: path.join(root, '.zerux/static'),
    options: {
      rootDir: root,
      origin: 'https://site.test',
      basePath: '/catalog',
      renderer,
      routes: [
        {
          path: '/catalog',
          access: 'public',
          view: () => ({ heading: 'Public without JavaScript' }),
        },
        {
          path: '/catalog/posts/:slug',
          access: 'public',
          params: () => [{ slug: 'first' }, { slug: 'second' }],
          view: (params) => ({ heading: params.slug }),
        },
        {
          path: '/catalog/old',
          access: 'public',
          redirect: '/catalog/',
          status: 308,
        },
      ],
      notFound: { access: 'public', view: { heading: 'Real missing page' } },
    },
    /** Remove only the isolated export fixture tree after operations settle.
     * @returns {Promise<void>} Resolves after owned temporary output is removed.
     */
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
/** Read an exported fixture tree into a deterministic path/content projection.
 * @param {string} root - Completed isolated output directory.
 * @returns {Promise<Record<string, string>>} Relative POSIX file names mapped to exact fixture text.
 */
async function tree(root) {
  /** Relative-path content snapshot used to compare complete exports deterministically. */
  const files = {};
  /** Traverse only the completed fixture output to collect comparison bytes.
   * @param {string} dir - Current descendant of the isolated snapshot root.
   * @returns {Promise<void>} Adds each leaf to the snapshot map.
   */
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      /** Current snapshot file read only beneath the completed fixture output. */
      const file = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(file);
      } else {
        files[path.relative(root, file).split(path.sep).join('/')] =
          await readFile(file, 'utf8');
      }
    }
  }
  await walk(root);
  return files;
}
test('public/finite dynamic routes export under a mount with deterministic no-JS HTML, hashes, 404 and redirect metadata', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  let server;
  try {
    /** Completed export manifest carrying page, file-integrity and hosting metadata. */
    const first = await exportStaticSite(f.options);
    assert.equal(first.pages.length, 4);
    /** Generated mounted dynamic page checked for canonical URL and no runtime serialization. */
    const html = await readFile(
      path.join(f.output, 'catalog/posts/first/index.html'),
      'utf8'
    );
    assert.match(html, /<h1>first<\/h1>/);
    assert.match(
      html,
      /rel="canonical" href="https:\/\/site.test\/catalog\/posts\/first\/"/
    );
    assert.doesNotMatch(html, /<script|cookie|session|\.zerux\/build/);
    for (const record of first.files) {
      /** Exact emitted file bytes independently hashed against the manifest record. */
      const bytes = await readFile(path.join(f.output, record.file));
      assert.equal(
        record.sha256,
        createHash('sha256').update(bytes).digest('hex')
      );
      assert.equal(record.bytes, bytes.length);
    }
    /** Last complete output tree used for deterministic rebuild equality. */
    const previous = await tree(f.output);
    assert.deepEqual(await exportStaticSite(f.options), first);
    assert.deepEqual(await tree(f.output), previous);
    server = createServer(
      (req, res) =>
        void (async () => {
          /** Parsed fixture request path; no untrusted Host or forwarded origin is used. */
          const pathname = new URL(req.url, 'http://site.test').pathname;
          /** Explicit hosting redirect record matching the current fixture path. */
          const redirect = first.hosting.redirects.find(
            (item) => item.from === pathname
          );
          if (redirect) {
            res.writeHead(redirect.status, { location: redirect.to });
            res.end();
            return;
          }
          /** Known exported page; absence selects the real 404 file instead of a universal fallback. */
          const entry = first.pages.find((item) => item.url === pathname);
          res.statusCode = entry?.status ?? 404;
          res.setHeader('content-type', 'text/html');
          res.end(
            await readFile(
              path.join(f.output, entry?.file ?? first.hosting.notFound.file)
            )
          );
        })()
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Ephemeral loopback origin of the synthetic static-host metadata consumer. */
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.match(
      await (await fetch(base + '/catalog/')).text(),
      /Public without JavaScript/
    );
    /** Unlisted private-looking path response required to return a real 404. */
    const missing = await fetch(base + '/catalog/private/');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Real missing page/);
    /** Explicit permanent redirect response inspected without automatically following it. */
    const moved = await fetch(base + '/catalog/old', { redirect: 'manual' });
    assert.equal(moved.status, 308);
    assert.equal(moved.headers.get('location'), '/catalog/');
    assert.equal(first.hosting.unlisted, '404');
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await f.close();
  }
});
test('emitted public assets use real manifest integrity and mounted URLs without copying runtime/source manifests', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, 'public'));
    await writeFile(
      path.join(f.root, 'public/logo.png'),
      Buffer.from('public image bytes')
    );
    await buildProjectSources({ rootDir: f.root });
    /** Actual framework public asset manifest supplying integrity and mounted URL facts. */
    const manifest = JSON.parse(
      await readFile(
        path.join(f.root, '.zerux/build/public-assets.json'),
        'utf8'
      )
    );
    /** Completed asset export receipt checked against emitted local file URLs. */
    const result = await exportStaticSite({
      ...f.options,
      assets: {
        directory: '.zerux/build/public',
        manifest,
        include: ['/logo.png'],
      },
      routes: [
        {
          path: '/catalog',
          access: 'public',
          view: (_params, context) => ({
            heading: 'Assets',
            image: context.asset('/logo.png'),
          }),
        },
      ],
    });
    assert.match(
      await readFile(path.join(f.output, 'catalog/index.html'), 'utf8'),
      /src="\/catalog\/logo.png"/
    );
    assert.deepEqual(
      await readFile(path.join(f.output, 'catalog/logo.png')),
      Buffer.from('public image bytes')
    );
    assert.equal(result.assets[0].url, '/catalog/logo.png');
    assert.equal(
      (await readdir(f.output)).includes('server-manifest.json'),
      false
    );
    await writeFile(
      path.join(f.root, '.zerux/build/public/logo.png'),
      'tampered'
    );
    /** Last good complete output tree that invalid candidates must preserve exactly. */
    const before = await tree(f.output);
    await assert.rejects(
      exportStaticSite({
        ...f.options,
        assets: {
          directory: '.zerux/build/public',
          manifest,
          include: ['/logo.png'],
        },
      }),
      (error) => error.code === 'STATIC_ASSET_INTEGRITY'
    );
    assert.deepEqual(await tree(f.output), before);
    /** Separate authored file used as the forbidden symlinked asset destination. */
    const target = path.join(f.root, 'private-logo.png');
    await writeFile(target, Buffer.from('public image bytes'));
    await unlink(path.join(f.root, '.zerux/build/public/logo.png'));
    await symlink(target, path.join(f.root, '.zerux/build/public/logo.png'));
    await assert.rejects(
      exportStaticSite({
        ...f.options,
        assets: {
          directory: '.zerux/build/public',
          manifest,
          include: ['/logo.png'],
        },
      }),
      (error) => error.code === 'STATIC_ASSET_INVALID'
    );
    assert.deepEqual(await tree(f.output), before);
  } finally {
    await f.close();
  }
});
test('private data, authenticated declarations, request context, functions and server action HTML reject without replacing a good export', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  try {
    await exportStaticSite(f.options);
    /** Last good complete output tree that invalid candidates must preserve exactly. */
    const before = await tree(f.output);
    /** Explicit private/request-dependent/action/script candidates that static export must reject. */
    const variants = [
      {
        routes: [
          {
            path: '/catalog',
            access: 'private',
            view: () => ({ heading: 'PRIVATE' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog',
            access: 'public',
            view: () => ({ password: 'PRIVATE' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog',
            access: 'public',
            view: () => ({ heading: () => 'private' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog',
            access: 'public',
            view: (_p, ctx) => ({ heading: ctx.request.headers }),
          },
        ],
      },
      {
        renderer: () =>
          createZyroRenderer(
            () =>
              '<form method="POST" action="&#47;_zerux/actions/forged"></form>'
          ),
      },
      { renderer: () => createZyroRenderer(() => '<script>alert(1)</script>') },
      {
        renderer: () =>
          createZyroDocumentRenderer({
            security: () =>
              createSecurityPolicy({ mode: 'development' }).createResponse(),
            render: () => ({ html: '<p>private headers</p>' }),
          }),
      },
    ];
    for (const change of variants) {
      await assert.rejects(exportStaticSite({ ...f.options, ...change }));
      assert.deepEqual(await tree(f.output), before);
    }
    assert.equal(
      (await readdir(path.join(f.root, '.zerux'))).some(
        (name) => name.includes('candidate') || name.endsWith('.lock')
      ),
      false
    );
  } finally {
    await f.close();
  }
});
test('bad/missing dynamic parameters, traversal, duplicate routes, enumeration/render failures preserve last good output and release iterators', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  let returned = 0,
    disposed = 0;
  try {
    await exportStaticSite(f.options);
    /** Last good complete output tree that invalid candidates must preserve exactly. */
    const before = await tree(f.output);
    for (const change of [
      {
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            view: () => ({ heading: 'x' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            params: () => [{ slug: '..' }],
            view: () => ({ heading: 'x' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            params: () => [{ wrong: 'a' }],
            view: () => ({ heading: 'x' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            params: () => [{ slug: 'a' }, { slug: 'a' }],
            view: () => ({ heading: 'x' }),
          },
        ],
      },
      {
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            params: () => ({
              /** Yield one finite parameter then fail, proving enumeration return/finally cleanup.
               * @returns {Generator<{slug: string}>} Authored parameter followed by the intentional dependency failure.
               */
              *[Symbol.iterator]() {
                try {
                  yield { slug: 'a' };
                  throw Error('PRIVATE dependency');
                } finally {
                  returned++;
                }
              },
            }),
            view: () => ({ heading: 'x' }),
          },
        ],
      },
      {
        renderer: () => ({
          ...renderer(),
          /** Exercise deliberate renderer failure or controlled cancellation before candidate promotion.
           * @returns {Promise<object> | never} Fixed HTML descriptor or deliberate private renderer failure.
           */
          render() {
            throw Error('PRIVATE renderer dependency');
          },
          /** Record renderer owner disposal after failed or cancelled candidate work.
           * @returns {void} Increments the fixture disposal receipt.
           */
          dispose() {
            disposed++;
          },
        }),
      },
    ]) {
      await assert.rejects(exportStaticSite({ ...f.options, ...change }));
      assert.deepEqual(await tree(f.output), before);
    }
    assert.equal(returned, 1);
    assert.equal(disposed, 1);
    await assert.rejects(
      exportStaticSite({ ...f.options, outDir: '../outside' })
    );
  } finally {
    await f.close();
  }
});
test('route/output/time budgets cancel cooperative enumeration, reject nondeterministic output and clean up ownership', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  let stopped = 0;
  try {
    for (const change of [
      { maxRoutes: 1 },
      { maxBytes: 50 },
      { renderer: () => createZyroRenderer(() => String(Math.random())) },
      {
        routeTimeoutMs: 10,
        routes: [
          {
            path: '/catalog/:slug',
            access: 'public',
            /** Cooperate with the route deadline before returning fixture parameters.
             * @param {object} ctx - Enumeration context carrying the owned cancellation signal.
             * @returns {Promise<{slug: string}[]>} Fixed finite parameters after cancellation settlement, never promoted as success.
             */
            async params(ctx) {
              await new Promise((resolve) =>
                ctx.signal.addEventListener('abort', resolve, { once: true })
              );
              stopped++;
              return [{ slug: 'a' }];
            },
            view: () => ({ heading: 'x' }),
          },
        ],
      },
    ]) {
      await assert.rejects(exportStaticSite({ ...f.options, ...change }));
      assert.equal(
        (await readdir(path.join(f.root, '.zerux'))).some(
          (name) => name.includes('candidate') || name.endsWith('.lock')
        ),
        false
      );
    }
    assert.equal(stopped, 1);
  } finally {
    await f.close();
  }
});
test('symlink input/output paths, edited output, redirect cycles and unsupported targets reject; mixed mode declares Node requirements', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  /** Independent temporary directory proving export cannot traverse linked output parents. */
  const outside = await mkdtemp(path.join(os.tmpdir(), 'zx096-outside-'));
  try {
    await mkdir(path.join(f.root, '.zerux'));
    await symlink(outside, path.join(f.root, '.zerux/linked'), 'dir');
    await assert.rejects(
      exportStaticSite({ ...f.options, outDir: '.zerux/linked/export' })
    );
    assert.deepEqual(await readdir(outside), []);
    await exportStaticSite(f.options);
    await writeFile(path.join(f.output, 'manual.txt'), 'user edit');
    await assert.rejects(
      exportStaticSite(f.options),
      (error) => error.code === 'STATIC_OUTPUT_MODIFIED'
    );
    assert.equal(
      await readFile(path.join(f.output, 'manual.txt'), 'utf8'),
      'user edit'
    );
    await assert.rejects(
      exportStaticSite({
        ...f.options,
        outDir: '.zerux/cycle',
        routes: [
          {
            path: '/catalog/a',
            access: 'public',
            redirect: '/catalog/b',
            status: 308,
          },
          {
            path: '/catalog/b',
            access: 'public',
            redirect: '/catalog/a',
            status: 308,
          },
        ],
      }),
      (error) => error.code === 'STATIC_REDIRECT_CYCLE'
    );
    /** Completed selective prerender receipt declaring Node requirements for unlisted routes. */
    const mixed = await exportStaticSite({
      ...f.options,
      outDir: '.zerux/mixed',
      mode: 'mixed',
      routes: [
        {
          path: '/catalog',
          access: 'public',
          view: () => ({ heading: 'Prerender' }),
        },
        {
          path: '/catalog/login',
          access: 'public',
          redirect: '/catalog/private',
          status: 302,
        },
      ],
    });
    assert.equal(mixed.hosting.unlisted, 'node-server-required');
    assert.equal(
      (await readdir(path.join(f.root, '.zerux/mixed/catalog'))).includes(
        'private'
      ),
      false
    );
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
test('concurrent exports reject rather than sharing a staging directory; cancellation drains the accepted renderer once', async () => {
  /** Isolated static project fixture removed after candidate/output assertions. */
  const f = await fixture();
  let entered,
    release,
    disposed = 0;
  /** Barrier proving the accepted renderer entered before concurrent export/cancellation checks. */
  const ready = new Promise((resolve) => (entered = resolve));
  /** Controlled renderer wait released explicitly so cancellation can drain actual work. */
  const blocked = new Promise((resolve) => (release = resolve));
  /** Caller cancellation owner for the accepted export operation. */
  const controller = new AbortController();
  /** Accepted export promise retained until its renderer and staging cleanup settle. */
  const running = exportStaticSite({
    ...f.options,
    signal: controller.signal,
    renderer: () => ({
      ...renderer(),
      /** Exercise deliberate renderer failure or controlled cancellation before candidate promotion.
       * @param {unknown} view - Unused public view in the cancellation fixture.
       * @param {object} context - Export render context whose signal is checked after the barrier.
       * @returns {Promise<object> | never} Fixed HTML descriptor or deliberate private renderer failure.
       */
      async render(view, context) {
        entered();
        await blocked;
        context.signal.throwIfAborted();
        return { kind: 'html', html: '<h1>done</h1>' };
      },
      /** Record renderer owner disposal after failed or cancelled candidate work.
       * @returns {void} Increments the fixture disposal receipt.
       */
      dispose() {
        disposed++;
      },
    }),
  });
  try {
    await ready;
    await assert.rejects(exportStaticSite(f.options));
    controller.abort();
    release();
    await assert.rejects(running);
    assert.equal(disposed, 1);
    assert.equal(
      (await readdir(path.join(f.root, '.zerux'))).some(
        (name) => name.endsWith('.lock') || name.includes('candidate')
      ),
      false
    );
  } finally {
    release?.();
    await running.catch(() => {});
    await f.close();
  }
});
