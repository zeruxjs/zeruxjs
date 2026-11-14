import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createApplicationLifecycle } from 'zeruxjs';

/** Render only a fixed authored fixture through the public runtime, then release its owners.
 * @param {object} theme - Explicit synthetic host theme settings.
 * @returns {Promise<string>} Generated HTML; no operator application or remote service is used.
 */
async function documentFor(theme = {}) {
  /** Owned isolated runtime tree, removed only after the fixture stops. */
  const root = await mkdtemp(path.join(tmpdir(), 'zerux-theme-'));
  /** Owned runtime with infrastructure explicitly disabled. */
  const app = await createApplicationLifecycle({
    rootDir: root,
    config: { theme, server: { allowedDomains: ['127.0.0.1'] } },
    providers: { database: async () => null, cache: async () => null },
  });
  /** Owned ephemeral listener for the fixed synthetic page. */
  const server = createServer((req, res) => {
    void app.handle(req, res).catch(() => res.destroy());
  });
  try {
    app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/',
        handler: () =>
          '<!doctype html><html class="authored"><head></head><body><main>Theme</main></body></html>',
      });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Complete generated fixture response, consumed before resource cleanup. */
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    return await response.text();
  } finally {
    try {
      await app.close();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  }
}

test('readable authored theme bootstrap preserves cookies, system changes and unrelated classes', async () => {
  /** Only fixed package-authored HTML is executed in this DOM-emulation fixture. */
  const dom = new JSDOM(await documentFor(), {
    url: 'https://theme.test/',
    runScripts: 'outside-only',
  });
  /** Synthetic media listeners avoid native browser dependencies and are released with this fixture. */
  const listeners = new Set();
  let dark = true;
  try {
    dom.window.TextDecoder = TextDecoder;
    dom.window.matchMedia = () => ({
      get matches() {
        return dark;
      },
      addEventListener(_event, callback) {
        listeners.add(callback);
      },
    });
    dom.window.document.cookie = 'theme=system';
    /** Fixed framework bootstrap, not a model-provided or remote script. */
    const script = dom.window.document.querySelector(
      'script[data-zerux-theme]'
    );
    assert.ok(script.textContent.includes('\n'));
    dom.window.eval(script.textContent);
    assert.equal(
      dom.window.document.documentElement.classList.contains('authored'),
      true
    );
    assert.equal(
      dom.window.document.documentElement.classList.contains('system'),
      true
    );
    assert.equal(
      dom.window.document.documentElement.classList.contains('dark'),
      true
    );
    dark = false;
    for (const listener of listeners) {
      listener();
    }
    assert.equal(
      dom.window.document.documentElement.classList.contains('light'),
      true
    );
    assert.equal(
      dom.window.document.documentElement.classList.contains('dark'),
      false
    );
  } finally {
    listeners.clear();
    dom.window.close();
  }
});

test('host theme settings remain inert encoded data in the readable bootstrap', async () => {
  /** Deliberately hostile synthetic setting must never become executable script source. */
  const html = await documentFor({
    cookieName: 'theme";window.INJECTED=1;//',
    default: 'light',
  });
  /** Isolated DOM executes only the one known framework bootstrap selected below. */
  const dom = new JSDOM(html, {
    url: 'https://theme.test/',
    runScripts: 'outside-only',
  });
  try {
    dom.window.TextDecoder = TextDecoder;
    assert.equal(dom.window.document.querySelectorAll('script').length, 1);
    assert.doesNotMatch(html, /window\.INJECTED/);
    dom.window.eval(
      dom.window.document.querySelector('script[data-zerux-theme]').textContent
    );
    assert.equal(dom.window.INJECTED, undefined);
    assert.equal(
      dom.window.document.documentElement.classList.contains('light'),
      true
    );
  } finally {
    dom.window.close();
  }
});
