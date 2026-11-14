import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  loadContent,
  discoverPackages,
  repositoryRoot,
} from '../src/lib/content.ts';
import {
  groupFor,
  navigationGroups,
  groupPages,
  groupTarget,
} from '../src/lib/navigation.ts';
import { document } from '../src/lib/template.ts';
import { createRendererRegistry } from 'zeruxjs/renderers';
import {
  initializeTutorialDatabase,
  registerTutorial,
} from '../examples/renderer-data-queue.ts';

test('one authored guide per public package; six category hubs and all structure modes', async () => {
  /** Validated authored documents, read without building or serving the docs app. */
  const pages = await loadContent(),
    packages = await discoverPackages();
  for (const item of packages) {
    /** Exact public-package guide claims; duplicates/missing coverage are explicit failures. */
    const matches = pages.filter((page) => page.package === item.name);
    assert.equal(matches.length, 1, item.name);
    assert.ok(
      matches[0].sources.includes(item.source + '/package.json') ||
        matches[0].sources.some((source) =>
          source.startsWith(item.source + '/src/')
        ),
      item.name
    );
  }
  assert.deepEqual(
    navigationGroups.map((group) => group.label),
    ['Get Started', 'Structure', 'Guide', 'API', 'Deploy', 'Examples']
  );
  for (const group of navigationGroups) {
    assert.ok(
      group.slug === 'api' || pages.some((page) => page.slug === group.slug)
    );
    assert.ok(pages.some((page) => groupFor(page).id === group.id));
  }
  /** Public source read as inert text; this test does not execute the framework module to discover modes. */
  const declaration = await fs.readFile(
    path.join(repositoryRoot, 'packages/zeruxjs/src/index.ts'),
    'utf8'
  );
  /** Actual literal structure modes; spelling must be independent of source quote formatting. */
  const modes = [
    ...declaration.match(/type\?: ([^;]+);/)[1].matchAll(/(['"])([a-z]+)\1/g),
  ].map((match) => match[2]);
  assert.deepEqual(modes, ['fix', 'dynamic', 'function']);
  for (const mode of modes) {
    assert.ok(pages.some((page) => page.slug === 'structure-' + mode));
  }
  assert.ok(
    pages
      .find((page) => page.slug === 'structure-directories')
      .body.includes('structure.composables')
  );
});
test('category-scoped navigation remains native HTML and escapes stored names', async () => {
  /** Validated authored documents, read without building or serving the docs app. */
  const pages = await loadContent(),
    page = pages.find((page) => page.slug === 'structure');
  /** Owned DOM-emulation fixture for native navigation and stored-name escaping, closed in finally. */
  const dom = new JSDOM(
    document(
      { ...page, title: '<img src=x onerror=alert(1)>' },
      pages,
      '<h2 id="safe">Safe</h2>',
      [{ id: 'safe', title: 'Safe', depth: 2 }]
    )
  );
  try {
    /** Borrowed document from this owned emulation window; not real-browser/AT qualification. */
    const d = dom.window.document;
    assert.equal(d.querySelectorAll('.docs-tabs a').length, 6);
    assert.equal(
      d.querySelector('.docs-tabs [aria-current=page]').textContent,
      'Structure'
    );
    assert.equal(d.querySelectorAll('h1').length, 1);
    assert.equal(d.querySelector('h1 img'), null);
    assert.equal(d.querySelector('[onerror]'), null);
    assert.equal(
      d.querySelectorAll('.sidebar nav a').length,
      groupPages(page, pages).length
    );
    assert.ok(d.querySelector('.mobile-navigation summary'));
    assert.equal(
      d.querySelector('h1').textContent,
      '<img src=x onerror=alert(1)>'
    );
  } finally {
    dom.window.close();
  }
  assert.throws(() => groupFor({ navigation: 'community' }), /Unknown/);
});
test('public example: actual SQLite and renderer, unknown reference denial, queue failure and ordered cleanup', async () => {
  /** Owned disposable synthetic database directory, removed after renderer/queue teardown. */
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zx089-example-'));
  /** Known synthetic SQLite file; duplicate initialization must not overwrite existing state. */
  const filename = path.join(directory, 'public.sqlite'),
    registry = createRendererRegistry();
  /** Explicit route/disposal registrations captured from the public tutorial integration. */
  const routes = [],
    disposers = [];
  let queueConfig,
    closed = 0,
    enqueued;
  try {
    await initializeTutorialDatabase(filename);
    await assert.rejects(initializeTutorialDatabase(filename)); // no destructive overwrite
    /** Injected deterministic queue dependency; it records actual calls but is not a live broker. */
    /** Inject only the tutorial’s acknowledged queue basics and record startup/close ordering.
     * @param {object} config - Actual queue configuration emitted by the public example.
     * @returns {Promise<object>} Deterministic fixture queue, never a Redis connection.
     */
    const queueFactory = async (config) => {
      queueConfig = config;
      return {
        /** Resolve only the explicitly configured synthetic queue name.
         * @param {string} name - Expected snapshots queue.
         * @returns {object} Fixed enqueue fixture with no external delivery claim.
         */
        queue(name) {
          assert.equal(name, 'snapshots');
          return {
            /** Record the actual opaque-reference enqueue request.
             * @param {string} name - Authored job name.
             * @param {object} data - Opaque record-reference data; no private body is logged.
             * @returns {Promise<object>} Fixture-only receipt, not broker acceptance.
             */
            async add(name, data) {
              enqueued = { name, data };
              return { id: 'fixture-only' };
            },
          };
        },
        /** Prove the worker can still use its database dependency during ordered close.
         * @returns {Promise<void>} Actual processor assertion settlement before the example closes SQLite.
         */
        async close() {
          assert.deepEqual(
            await config.workers.snapshots.processor({
              name: 'snapshot',
              data: { reference: 'public-demo-v1' },
            }),
            { count: 1 }
          );
          closed++;
        },
      };
    };
    /** Minimal borrowed host registration fixture around the actual renderer registry. */
    const api = {
      renderers: () => registry,
      onDispose: (fn) => disposers.push(fn),
      addRoute: (route) => routes.push(route),
    };
    /** Actual public tutorial integration owner; explicit close must drain its worker before the database. */
    const app = await registerTutorial(
      api,
      { filename, redisUrl: 'redis://fixture.invalid:6379' },
      queueFactory
    );
    assert.equal((await app.enqueueSnapshot()).id, 'fixture-only');
    assert.deepEqual(enqueued.data, { reference: 'public-demo-v1' });
    /** Synthetic render-request cancellation owner for the actual renderer invocation. */
    const controller = new AbortController();
    /** Actual public renderer output, not a prefilled success response. */
    const rendered = await routes[0].handler({
      render: (token, view) =>
        registry.render(token, view, {
          requestId: 'synthetic',
          pathname: '/',
          signal: controller.signal,
        }),
    });
    assert.match(rendered.html, /<h1>Public notes<\/h1>/);
    assert.match(rendered.html, /A public synthetic note/);
    await assert.rejects(
      queueConfig.workers.snapshots.processor({
        name: 'snapshot',
        data: { reference: 'forged-private-reference' },
      }),
      /Unknown/
    );
    for (const dispose of disposers.reverse()) {
      await dispose();
    }
    await app.close();
    assert.equal(closed, 1);
    await assert.rejects(
      registerTutorial(
        api,
        { filename, redisUrl: 'redis://fixture.invalid:6379' },
        async () => {
          throw Error('synthetic queue outage');
        }
      ),
      /synthetic queue outage/
    );
    await assert.rejects(
      registerTutorial(api, { filename, redisUrl: 'https://denied.invalid' }),
      /Explicit/
    );
  } finally {
    for (const dispose of disposers) {
      await dispose();
    }
    await registry.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('MCP package is absent; zhost public exports own inert protocol registration and cleanup', async () => {
  /** Actual public manifest inventory; removed MCP names/dependencies must not reappear. */
  const packages = await discoverPackages();
  assert.equal(
    packages.some((item) => item.name === '@zeruxjs/mcp'),
    false
  );
  await assert.rejects(
    fs.stat(path.join(repositoryRoot, 'packages/@zeruxjs/mcp')),
    (error) => error.code === 'ENOENT'
  );
  for (const item of packages) {
    for (const field of [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
      'devDependencies',
    ]) {
      assert.equal(item[field]?.['@zeruxjs/mcp'], undefined, item.name);
    }
  }
  /** Committed lockfile text, read without installing packages or resolving arbitrary dependencies. */
  const lock = await fs.readFile(
    path.join(repositoryRoot, 'package-lock.json'),
    'utf8'
  );
  assert.equal(lock.includes('"@zeruxjs/mcp"'), false);
  /** Actual public zhost exports; construction remains inert until explicitly used. */
  const { createMcpServer, createProtocolGateway } =
    await import('zhost/protocols');
  /** Actual zhost root export surface, compared with its protocol subpath. */
  const root = await import('zhost');
  assert.equal(root.createMcpServer, createMcpServer);
  /** Explicit synthetic server definition; its fixed handler never executes stored content. */
  const mcp = createMcpServer({ name: 'docs-check', version: '1.0.0' });
  mcp.tools.register({
    name: 'public_status',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: () => ({ ready: true }),
  });
  /** Actual denied-by-default gateway fixture, explicitly closed after registration checks. */
  const gateway = createProtocolGateway({
    mcp,
    authorize: async () => false,
    allowedOrigins: ['https://fixture.invalid'],
    maxBodyBytes: 16384,
  });
  gateway.close();
});

test('archived taxonomy links use existing version-local slugs without rewriting snapshots', () => {
  /** Synthetic archived page inventory proves version-local fallback without editing snapshots. */
  const archived = [
    {
      version: 'old',
      slug: 'introduction',
      section: 'Getting started',
      url: '/old/introduction/',
    },
    {
      version: 'old',
      slug: 'project-structure',
      section: 'Getting started',
      url: '/old/project-structure/',
    },
  ];
  /** Actual configured Structure collection, resolved against the archived fixture only. */
  const group = navigationGroups.find((item) => item.id === 'structure');
  assert.equal(
    groupTarget(group, archived[0], archived),
    '/old/project-structure/'
  );
  /** Minimal borrowed host registration fixture around the actual renderer registry. */
  /** Archived API landing is absent, so only its same-version introduction may be used. */
  const api = navigationGroups.find((item) => item.id === 'api');
  assert.equal(groupTarget(api, archived[0], archived), '/old/introduction/');
});
