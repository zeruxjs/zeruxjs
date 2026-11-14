import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPublicRouteManifest } from '../dist/navigation-manifest.js';
import { readBuildFile } from '../dist/commands/build-paths.js';

test(
  'route validation rejects ambiguous long segments without changing valid dynamic routes',
  { timeout: 1000 },
  () => {
    /** Build the smallest public manifest for route syntax validation.
     * @param {string} pattern - Authored valid or malicious fixture route.
     * @returns {object} Versioned public navigation manifest.
     */
    const manifest = (pattern) => ({
      version: 1,
      basePath: '/',
      boundaries: {},
      routes: [{ id: 'route', pattern, layouts: [] }],
    });
    assert.equal(
      readPublicRouteManifest(manifest('/docs/:slug')).routes[0].parameters[0]
        .name,
      'slug'
    );
    assert.throws(
      () => readPublicRouteManifest(manifest('/' + '-'.repeat(1900) + '!')),
      /NAVIGATION_ROUTE_INVALID/
    );
    assert.equal(readPublicRouteManifest(manifest('/')).routes[0].pattern, '/');
  }
);
test('build reads inspect the opened file, reject leaf links and enforce byte budgets', async () => {
  /** Temporary source root removed after boundary and encoding checks. */
  const root = await mkdtemp(path.join(tmpdir(), 'codeql-build-'));
  try {
    /** Owned fixture file used to test descriptor validation and read budgets. */
    const file = path.join(root, 'data');
    await writeFile(file, 'known bytes');
    assert.equal((await readBuildFile(file, 32)).toString(), 'known bytes');
    await assert.rejects(readBuildFile(file, 4), /oversized/);
    await symlink(file, path.join(root, 'link'));
    await assert.rejects(readBuildFile(path.join(root, 'link'), 32));
    await assert.rejects(readBuildFile(root, 32));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('theme script encodes script terminators and does not treat replacement tokens as HTML', async () => {
  /** Public framework factory loaded only for the isolated theme fixture. */
  const { createApplicationLifecycle } = await import('zeruxjs');
  /** Native server factory used only for an ephemeral loopback listener. */
  const { createServer } = await import('node:http');
  /** Event helper awaiting listener readiness without polling. */
  const { once } = await import('node:events');
  /** DOM emulator inspecting the generated theme output; not live-browser qualification. */
  const { JSDOM } = await import('jsdom');
  /** Temporary source root removed after boundary and encoding checks. */
  const root = await mkdtemp(path.join(tmpdir(), 'codeql-theme-'));
  let app, server;
  try {
    app = await createApplicationLifecycle({
      rootDir: root,
      config: {
        theme: { cookieName: 'theme</script><script>forged()</script>$&' },
      },
      providers: { database: async () => null, cache: async () => null },
    });
    app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/',
        handler: () =>
          '<html style="color-scheme: light; font-family: sans-serif"><head></head><body><h1>Known content</h1></body></html>',
      });
    server = createServer(
      (req, res) => void app.handle(req, res).catch(() => res.destroy())
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Generated synthetic response with an intentionally hostile cookie-name setting. */
    const html = await (
      await fetch(`http://127.0.0.1:${server.address().port}`)
    ).text();
    /** Owned DOM emulator closed before the runtime and temporary files are removed. */
    const dom = new JSDOM(html);
    try {
      assert.equal(dom.window.document.scripts.length, 1);
      assert.equal(
        dom.window.document.querySelector('h1').textContent,
        'Known content'
      );
      assert.doesNotMatch(
        dom.window.document.scripts[0].textContent,
        /forged|theme<|\$&/
      );
      /** Decoded inert theme settings proving hostile data was encoded rather than inserted as code. */
      const settings = JSON.parse(
        Buffer.from(
          dom.window.document.scripts[0].getAttribute('data-zerux-theme'),
          'base64'
        ).toString('utf8')
      );
      assert.equal(
        settings.cookieName,
        'theme</script><script>forged()</script>$&'
      );
      /** Node VM used only to execute the fixed framework-authored bootstrap fixture. */
      const vm = await import('node:vm');
      /** Known framework bootstrap text; caller-supplied setting data remains outside this program. */
      const script = dom.window.document.scripts[0].textContent;
      vm.runInNewContext(
        script,
        {
          document: dom.window.document,
          window: dom.window,
          TextDecoder,
          Uint8Array,
          atob,
        },
        { timeout: 1000 }
      );
      assert.equal(
        dom.window.document.documentElement.style.colorScheme,
        'light'
      );
      /** Existing bootstrap script element whose encoded data is changed for the fallback assertion. */
      const element = dom.window.document.scripts[0];
      element.setAttribute(
        'data-zerux-theme',
        Buffer.from(
          JSON.stringify({ cookieName: 'theme', default: 'dark' })
        ).toString('base64')
      );
      vm.runInNewContext(
        script,
        {
          document: dom.window.document,
          window: dom.window,
          TextDecoder,
          Uint8Array,
          atob,
        },
        { timeout: 1000 }
      );
      assert.equal(
        dom.window.document.documentElement.style.colorScheme,
        'dark'
      );
    } finally {
      dom.window.close();
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
