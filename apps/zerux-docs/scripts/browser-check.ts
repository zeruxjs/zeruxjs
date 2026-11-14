/** Optional installed-Chrome check. CDP pipes + intercepted files: no HTTP server or external requests. */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { root } from '../src/lib/content.ts';
/** Owned disposable browser profile, removed after browser shutdown; this script is explicit opt-in. */
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zx089-chrome-'));
/** Owned trusted installed Chrome process; not a user-managed application or auto-downloaded browser. */
const browser = spawn(
  process.env.CHROME_BIN || '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    '--user-data-dir=' + profile,
  ],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
);
let next = 0,
  buffer = Buffer.alloc(0),
  stderr = '';
/** CDP request identities retain their own finite timers until response or browser exit. */
const pending = new Map(),
  listeners = new Set();
browser.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-3000);
});
/** Explicit trusted CDP command sender; expressions/paths are authored fixture code, never remote user input. */
/** Send one trusted fixture CDP request with a finite response deadline.
 * @param {string} method - Fixed authored CDP method.
 * @param {object} params - Trusted fixture command parameters; never remote user input.
 * @param {string} sessionId - Optional exact owned target session.
 * @returns {Promise<object>} Actual command outcome or explicit timeout/browser failure.
 */
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    /** Monotonic per-process CDP correlation ID, not an authentication token. */
    const id = ++next,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Chrome deadline: ' + method));
      }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + '\0'
    );
  });
browser.stdio[4].on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(0)) !== -1) {
    /** One complete NUL-delimited CDP response/event frame. */
    const message = JSON.parse(buffer.subarray(0, end).toString());
    buffer = buffer.subarray(end + 1);
    if (message.id) {
      /** Exact pending request record whose timer is cleared before resolving/rejecting. */
      const item = pending.get(message.id);
      if (!item) {
        continue;
      }
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) {
        item.reject(Error(JSON.stringify(message.error)));
      } else {
        item.resolve(message.result);
      }
    } else {
      for (const listener of listeners) {
        listener(message);
      }
    }
  }
});
browser.on('exit', () => {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(Error('Chrome exited: ' + stderr));
  }
  pending.clear();
});
/** Bounded-by-fixture-run browser error observations; no production telemetry is collected. */
const errors = [];
try {
  /** Actual exercised Chrome product identity, not a cross-browser certification. */
  const version = await send('Browser.getVersion');
  /** Owned blank browser target for this isolated fixture. */
  const { targetId } = await send('Target.createTarget', {
    url: 'about:blank',
  });
  /** Flattened CDP session scoped to the owned target. */
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  /** Session-pinned trusted CDP sender; no arbitrary caller can choose a replacement target. */
  /** Pin trusted commands to this owned target session.
   * @param {string} method - Authored CDP method.
   * @param {object} params - Trusted command data.
   * @returns {Promise<object>} Actual target-scoped command outcome.
   */
  const call = (method, params) => send(method, params, sessionId);
  /** Evaluate only fixed authored fixture expressions inside the owned browser target. */
  /** Run a fixed authored inspection expression inside the owned browser fixture.
   * @param {string} expression - Trusted fixture code only, never content/caller input.
   * @returns {Promise<unknown>} Actual returned value; browser exceptions fail the check.
   */
  const evaluate = async (expression) => {
    /** Actual CDP evaluation/measurement outcome; JavaScript exceptions fail the fixture. */
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw Error(
        result.exceptionDetails.text +
          JSON.stringify(result.exceptionDetails.exception)
      );
    }
    return result.result.value;
  };
  /** Existing docs output is read only; this fixture never builds or serves the app. */
  const directory = path.join(root, 'dist');
  listeners.add((message) => {
    if (message.sessionId !== sessionId) {
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.text);
    }
    if (message.method === 'Fetch.requestPaused') {
      void (async () => {
        /** Paused browser request is fulfilled only from the fixture’s fixed local export. */
        const { requestId, request } = message.params;
        try {
          /** Intercepted request must use the synthetic approved origin before any file access. */
          const url = new URL(request.url);
          if (url.origin !== 'https://docs.invalid') {
            throw Error('External destination denied');
          }
          let pathname = decodeURIComponent(url.pathname);
          if (pathname.endsWith('/')) {
            pathname += 'index.html';
          }
          /** Resolved output file checked against the fixed export boundary. */
          const location = path.resolve(directory, '.' + pathname);
          if (!location.startsWith(directory + path.sep)) {
            throw Error('Traversal denied');
          }
          /** Actual intercepted local asset bytes; external network access is never delegated. */
          const bytes = await fs.readFile(location);
          /** Fixed MIME mapping selected only from the local file extension. */
          let type;
          if (location.endsWith('.html')) {
            type = 'text/html; charset=utf-8';
          } else if (location.endsWith('.js')) {
            type = 'text/javascript';
          } else if (location.endsWith('.css')) {
            type = 'text/css';
          } else if (location.endsWith('.json')) {
            type = 'application/json';
          } else if (location.endsWith('.svg')) {
            type = 'image/svg+xml';
          } else {
            type = 'application/octet-stream';
          }
          await call('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'content-type', value: type }],
            body: bytes.toString('base64'),
          });
        } catch {
          await call('Fetch.fulfillRequest', {
            requestId,
            responseCode: 404,
            body: '',
          });
        }
      })().catch((error) => errors.push(error.message));
    }
  });
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  /** Configure one synthetic viewport/theme/script mode and navigate the owned intercepted target. */
  /** Exercise one intercepted local page under an explicit viewport/theme/script policy.
   * @param {string} slug - Fixed authored page identity.
   * @param {number} width - Explicit viewport width.
   * @param {boolean} dark - Emulated system color preference.
   * @param {boolean} noJavaScript - Explicitly disable script execution for native-content checks.
   * @returns {Promise<object>} Actual measured page state, not a production/browser-parity guarantee.
   */
  const visit = async (slug, width, dark = false, noJavaScript = false) => {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 760,
    });
    await call('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    await call('Emulation.setScriptExecutionDisabled', { value: noJavaScript });
    await call('Page.navigate', {
      url:
        'https://docs.invalid/zeruxjs/' + (slug ? `docs/0.0.4/${slug}/` : ''),
    });
    for (let i = 0; i < 150; i++) {
      if (
        await evaluate(
          "document.readyState==='complete' && !!document.querySelector('.docs-tabs')"
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    /** Actual CDP evaluation/measurement outcome; JavaScript exceptions fail the fixture. */
    const result = await evaluate(
      `({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,tabs:document.querySelectorAll('.docs-tabs a').length,h1:document.querySelectorAll('h1').length,active:document.querySelector('.docs-tabs [aria-current=page]')?.textContent,background:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})`
    );
    assert.equal(result.tabs, 6);
    assert.equal(result.h1, 1);
    assert.equal(result.overflow, false, JSON.stringify({ slug, ...result }));
    return result;
  };
  /** Actual bounded viewport checks retained only for the final local report. */
  const results = [];
  for (const [slug, width, dark, noJS] of [
    ['introduction', 1440, false, false],
    ['structure', 1440, true, false],
    ['examples', 390, false, false],
    ['api', 390, true, true],
    ['', 1440, false, true],
  ]) {
    results.push({
      slug,
      width,
      dark,
      noJS,
      ...(await visit(slug, width, dark, noJS)),
    });
    if (process.env.DOCS_SCREENSHOTS) {
      await fs.mkdir(process.env.DOCS_SCREENSHOTS, { recursive: true });
      /** Optional actual screenshot bytes, written only to explicit trusted operator output. */
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(
        path.join(
          process.env.DOCS_SCREENSHOTS,
          (slug || 'home') + '-' + width + '.png'
        ),
        Buffer.from(shot.data, 'base64')
      );
    }
  }
  await visit('introduction', 1440);
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'k',
    code: 'KeyK',
    modifiers: 2,
  });
  assert.equal(
    await evaluate("document.querySelector('#search-dialog').open"),
    true
  );
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
  });
  assert.equal(
    await evaluate("document.querySelector('#search-dialog').open"),
    false
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    JSON.stringify(
      {
        browser: version.product,
        results,
        searchKeyboard: 'passed',
        externalNetwork: 'intercepted',
      },
      null,
      2
    )
  );
} finally {
  /** Observe actual child close before removing its private profile. */
  const closed =
    browser.exitCode === null ? once(browser, 'close') : Promise.resolve();
  /** Finite shutdown fallback for this owned fixture process; unrelated processes are untouched. */
  const killTimer = setTimeout(() => {
    if (browser.exitCode === null) {
      browser.kill('SIGKILL');
    }
  }, 3000);
  try {
    await send('Browser.close');
  } catch {
    /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
  }
  await closed;
  clearTimeout(killTimer);
  for (const item of pending.values()) {
    clearTimeout(item.timer);
  }
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
