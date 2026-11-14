/** Owned ephemeral app + Chrome profile. Synthetic data only; never starts the configured app. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { hashPassword } from '@zeruxjs/auth';
import { createApplicationLifecycle, runWorkers } from 'zeruxjs';
import config from '../zerux.config.ts';
/** Browser event envelope owned by this fixed CDP fixture, not an application HTTP schema. */
type BrowserEvent = { sessionId?: string; id?: undefined } & (
  | {
      method: 'Runtime.exceptionThrown';
      params: { exceptionDetails: { text: string } };
    }
  | {
      method: 'Log.entryAdded';
      params: { entry: { source: string; text: string } };
    }
  | {
      method: 'Fetch.requestPaused';
      params: { requestId: string; request: { url: string } };
    }
);
/** Pending command metadata is retained only until its response/deadline/child exit. */
interface PendingBrowserCommand {
  /** Settle the exact command from its owned process response. */
  resolve: (value: unknown) => void;
  /** Reject without exposing application credentials. */
  reject: (reason: unknown) => void;
  /** Owned response deadline cleared on every terminal command outcome. */
  timer: ReturnType<typeof setTimeout>;
}
/** Actual CDP evaluation response; return values remain caller-asserted fixture data. */
interface BrowserEvaluation {
  /** Browser exception details fail the authored inspection. */
  exceptionDetails?: { text: string };
  /** Runtime return value requested explicitly through returnByValue. */
  result: { value: unknown };
}
/** Actual source app root; the configured operator runtime is never started by this fixture. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, '.zerux'), { recursive: true });
/** Owned private fixture/build scratch tree, separate from the running application output. */
const compiled = await mkdtemp(join(root, '.zerux/workspace-chrome-'));
/** Copied production fixture; browser requests never use the operator’s live data directory. */
const fixtureRoot = join(compiled, 'fixture');
/** Synthetic private SQLite/object state beneath the copied fixture only. */
const directory = join(fixtureRoot, '.workspace');
/** Owned disposable installed-Chrome profile; no browser is downloaded. */
const profile = await mkdtemp(join(tmpdir(), 'zerux-browser-profile-'));
let app: Awaited<ReturnType<typeof createApplicationLifecycle>> | undefined;
let browser: ReturnType<typeof spawn> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let workers: Awaited<ReturnType<typeof runWorkers>> | undefined;
try {
  await cp(join(root, '.zerux/build'), fixtureRoot, { recursive: true });
  await cp(join(root, 'workers'), join(fixtureRoot, 'workers'), {
    recursive: true,
  });
  /** Temporary isolated service bundle used only by this synthetic fixture. */
  const outfile = join(compiled, 'app.mjs');
  await build({
    entryPoints: [join(root, 'lib/workspace/application.ts')],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  /** Actual public integration owner loaded from the isolated bundle, not a fake browser success stub. */
  const { createWorkspace } = await import(pathToFileURL(outfile).href);
  /** Synthetic fixture-only request observations used to prove the exercised local endpoint. */
  const requestSummary: Array<{
    method: string | undefined;
    pathname: string;
    status: number;
    origin: string | null;
  }> = [];
  server = createServer(async (req, res) => {
    try {
      /** Request path in the owned loopback fixture, never production telemetry. */
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      res.once('finish', () =>
        requestSummary.push({
          method: req.method,
          pathname,
          status: res.statusCode,
          origin: req.headers.origin ?? null,
        })
      );
      await app!.handle(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Synthetic fixture failed');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  /** Actual native listener address must be a TCP endpoint before selecting the fixture origin. */
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  /** Actual ephemeral loopback listener origin used for all synthetic session/CSRF policy. */
  const origin = `http://localhost:${address.port}`;
  /** Synthetic one-run password record and independent random key; not a default app credential. */
  const passwordHash = hashPassword('synthetic-browser-only-password'),
    key = randomBytes(32);
  /** Explicit synthetic schema-initialization generation, closed before the actual fixture runtime starts. */
  const initial = await createWorkspace({
    directory,
    origin,
    tenant: 'synthetic',
    site: 'browser',
    username: 'operator',
    passwordHash,
    key,
    migrate: true,
  });
  await initial.close();
  Object.assign(process.env, {
    WORKSPACE_ENABLED: 'true',
    WORKSPACE_ORIGIN: origin,
    WORKSPACE_TENANT: 'synthetic',
    WORKSPACE_SITE: 'browser',
    WORKSPACE_USERNAME: 'operator',
    WORKSPACE_PASSWORD_HASH: passwordHash,
    WORKSPACE_KEY: key.toString('base64url'),
    ENABLE_MYSQL_DEMO: 'false',
  });
  // The fixture always excludes the operator's optional external database.
  /** Force the optional operator database out of the copied fixture configuration. */
  const { db: _ignoredDatabase, ...localConfig } = config;
  app = await createApplicationLifecycle({
    rootDir: fixtureRoot,
    mode: 'start',
    config: localConfig,
  });
  workers = await runWorkers(app.runtime());
  browser = spawn(
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
  let id = 0,
    buffer = Buffer.alloc(0);
  /** CDP requests retain exact correlation IDs/timers until response or child exit. */
  const pending = new Map<number, PendingBrowserCommand>(),
    listeners = new Set<(message: BrowserEvent) => void>();
  browser.stderr!.on('data', () => {});
  /** Explicit pipe 3 is the owned CDP request writer, never a caller-selected file descriptor. */
  const cdpInput = browser.stdio[3] as import('node:stream').Writable;
  /** Explicit pipe 4 is the owned CDP event/response reader. */
  const cdpOutput = browser.stdio[4] as import('node:stream').Readable;
  /** Send one authored CDP command to the owned browser with a finite response deadline.
   * @param {string} method - Trusted fixed CDP method, not a caller-selected command endpoint.
   * @param {object} params - Trusted fixture parameters; never external/model content.
   * @param {string} sessionId - Optional exact owned target session.
   * @returns {Promise<object>} Actual browser command result, timeout or process failure.
   */
  const send = <TResult = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<TResult> =>
    new Promise<TResult>((resolve, reject) => {
      /** Monotonic fixture CDP request ID with its own finite deadline. */
      const next = ++id,
        timer = setTimeout(() => {
          pending.delete(next);
          reject(Error('Chrome deadline: ' + method));
        }, 15000);
      pending.set(next, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });
      cdpInput.write(
        JSON.stringify({
          id: next,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }) + '\0'
      );
    });
  cdpOutput.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    let end;
    while ((end = buffer.indexOf(0)) !== -1) {
      /** One complete NUL-framed browser response/event; no application payload is evaluated on the server. */
      const message = JSON.parse(buffer.subarray(0, end).toString('utf8')) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      buffer = buffer.subarray(end + 1);
      if (message.id) {
        /** Exact pending request record, removed and timer-cleared before settlement. */
        const item = pending.get(message.id);
        if (!item) {
          continue;
        }
        clearTimeout(item.timer);
        pending.delete(message.id);
        if (message.error) {
          item.reject(Error(JSON.stringify(message.error)));
        } else {
          item.resolve(message.result);
        }
      } else {
        for (const listener of listeners) {
          listener(message as unknown as BrowserEvent);
        }
      }
    }
  });
  browser.once('exit', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error('Chrome exited'));
    }
    pending.clear();
  });
  /** Actual exercised Chrome product identity; this fixture cannot certify other browsers/codecs. */
  const version = await send<{ product: string }>('Browser.getVersion');
  /** Owned blank target created exclusively for this fixture. */
  const { targetId } = await send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank',
  });
  /** Exact flattened CDP session for the owned target. */
  const { sessionId } = await send<{ sessionId: string }>(
    'Target.attachToTarget',
    {
      targetId,
      flatten: true,
    }
  );
  /** Pin authored commands to this fixture’s exact owned target.
   * @param {string} method - Fixed trusted CDP method.
   * @param {object} params - Authored command data.
   * @returns {Promise<object>} Actual session-scoped browser outcome.
   */
  const call = <TResult = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {}
  ) => send<TResult>(method, params, sessionId);
  /** Inspect only fixed authored fixture expressions inside the isolated browser target.
   * @param {string} expression - Trusted test code, never text from an HTTP/user/model payload.
   * @returns {Promise<unknown>} Actual browser value; exceptions fail the fixture.
   */
  const evaluate = async <TResult = unknown>(
    expression: string
  ): Promise<TResult> => {
    /** Actual CDP evaluation outcome; exceptions fail the check rather than inventing a pass. */
    const result = await call<BrowserEvaluation>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw Error(result.exceptionDetails.text);
    }
    return result.result.value as TResult;
  };
  /** Browser/security errors retained only for this finite synthetic run. */
  const errors: string[] = [];
  listeners.add((message) => {
    if (message.sessionId !== sessionId) {
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.text);
    }
    if (
      message.method === 'Log.entryAdded' &&
      message.params.entry.source === 'security'
    ) {
      errors.push(message.params.entry.text);
    }
    if (message.method === 'Fetch.requestPaused') {
      /** Paused browser request is checked before continuation; external destinations are denied. */
      const { requestId, request } = message.params;
      /** Only the exact synthetic loopback origin and its owned blob URLs may continue. */
      const allowed =
        request.url.startsWith(origin + '/') ||
        request.url.startsWith('blob:' + origin + '/');
      void call(
        allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }
      ).catch(() => {});
    }
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  /** Poll a trusted fixture condition until its finite deadline.
   * @param {string} expression - Fixed authored browser condition.
   * @returns {Promise<void>} Actual observed condition or explicit failure; no fabricated browser pass.
   */
  const waitFor = async (expression: string) => {
    /** Finite polling deadline; arbitrary browser code is never promised forced cancellation. */
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await evaluate(expression)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw Error(
      'Browser condition failed: ' +
        expression +
        ' ' +
        JSON.stringify({
          location: await evaluate('location.pathname'),
          text: await evaluate('document.body.textContent.slice(0,300)'),
          requests: requestSummary.slice(-8),
          errors,
        })
    );
  };
  /** Navigate only the synthetic loopback app and wait for its actual ready state.
   * @param {string} path - Fixed authored local route.
   * @returns {Promise<void>} Actual expected route readiness, never a redirect/authorization bypass.
   */
  const navigate = async (path: string) => {
    await call('Page.navigate', { url: origin + path });
    await waitFor(
      `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'`
    );
  };
  /** Dispatch real native key-down/up messages to the currently focused fixture control.
   * @returns {Promise<void>} Actual browser command settlement; not a forced click or fake DOM event.
   */
  const enter = async () => {
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
  };
  await navigate('/index.html');
  await waitFor(
    "document.querySelector('.count-display')?.textContent === '0'"
  );
  await evaluate("document.querySelector('[aria-label=Increase]').focus()");
  await enter();
  assert.equal(
    await evaluate("document.querySelector('.count-display').textContent"),
    '1'
  );
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    assert.equal(
      await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'),
      true
    );
  }
  await navigate('/api/echo');
  assert.equal(
    await evaluate(
      `fetch('/api/echo?debug=1', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'message=browser-check' }).then(r => r.json()).then(result => result.body.message)`
    ),
    'browser-check'
  );
  assert.equal(
    await evaluate(
      `fetch('/plugin/workers').then(r => r.json()).then(result => result.mathResult.squared)`
    ),
    144
  );
  assert.equal(
    await evaluate(
      `fetch('/playground').then(r => r.text()).then(text => text.includes('request-context') && !text.includes('missing composable'))`
    ),
    true
  );
  await navigate('/workspace/login');
  await evaluate(
    `document.querySelector('[name=username]').value='operator'; document.querySelector('[name=password]').value='synthetic-browser-only-password'; document.querySelector('button[type=submit]').focus();`
  );
  await enter();
  await waitFor(
    "location.pathname === '/workspace/notes' && document.querySelector('[name=title]')"
  );
  for (const path of [
    '/',
    '/playground',
    '/blog/hello-world',
    '/api/health',
    '/api/echo',
    '/db-demo',
    '/plugin/runtime',
    '/plugin/workers',
    '/workspace/files',
    '/workspace/assets',
    '/workspace/share',
    '/workspace/email',
    '/workspace/experiments',
    '/workspace/tags',
    '/workspace/performance',
    '/workspace/diagnostics',
    '/workspace/public',
    '/workspace/search',
    '/workspace/feed.xml',
    '/workspace/feed.json',
    '/workspace/sitemap.xml',
  ]) {
    assert.equal(
      await evaluate(`fetch(${JSON.stringify(path)}).then(r=>r.status)`),
      200,
      path
    );
  }
  await navigate('/workspace/reports');
  await evaluate(
    "document.querySelector('[name=consent]').value='granted';document.querySelector('button[type=submit]').focus()"
  );
  await enter();
  await waitFor(
    "location.search.includes('outcome=persisted') && document.querySelector('[data-report-chart]')"
  );
  assert.match(
    await evaluate<string>(
      "document.querySelector('[data-report-view]').textContent"
    ),
    /workspace.sample/
  );
  await navigate('/workspace/protocols');
  await waitFor("document.querySelector('[data-protocol-client] button')");
  for (const [label, endpoint] of [
    ['JSON-RPC summary', '/rpc'],
    ['MCP tool call', '/mcp'],
    ['Connect summary', '/workspace.Notebook/Summary'],
    ['tRPC-style summary', '/trpc/workspace.summary'],
  ]) {
    await evaluate(
      `Array.from(document.querySelectorAll('[data-protocol-client] button')).find(button=>button.textContent===${JSON.stringify(label)}).focus()`
    );
    await enter();
    await waitFor(
      "document.querySelector('[data-protocol-client] [role=status]').textContent === 'Local endpoint responded.'"
    );
    assert.ok(
      requestSummary.some(
        (request) =>
          request.method === 'POST' &&
          request.pathname === endpoint &&
          request.status === 200
      ),
      endpoint
    );
  }
  await navigate('/workspace/lab');
  await waitFor(
    "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Increase') && document.querySelector('audio')?.getAttribute('src')?.startsWith('blob:')"
  );
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Increase').focus()"
  );
  await enter();
  assert.equal(
    await evaluate(
      "document.querySelector('[data-browser-lab] [role=status]').textContent"
    ),
    '1'
  );
  assert.match(
    await evaluate<string>(
      "document.querySelector('[data-browser-lab]').textContent"
    ),
    /React: 1; Vue: 1/
  );
  await evaluate(
    "const locale=document.querySelector('[data-browser-lab] select');locale.value='ar';locale.dispatchEvent(new Event('change',{bubbles:true}))"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-browser-lab] .card').getAttribute('dir')"
    ),
    'rtl'
  );
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await waitFor(
    "document.querySelector('main').getAttribute('data-zx-motion') === 'reduce'"
  );
  await evaluate("document.querySelector('audio').focus()");
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'k',
    code: 'KeyK',
    windowsVirtualKeyCode: 75,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'k',
    code: 'KeyK',
    windowsVirtualKeyCode: 75,
  });
  await waitFor("document.querySelector('audio').currentTime > 0");
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    assert.equal(
      await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'),
      true,
      'horizontal overflow at ' + width
    );
  }
  await evaluate(
    "window.dispatchEvent(new PageTransitionEvent('pagehide'));true"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-browser-lab]').childElementCount"
    ),
    0
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-zx-preference-style]').length"
    ),
    0
  );
  await call('Emulation.setScriptExecutionDisabled', { value: true });
  await navigate('/workspace/notes');
  await evaluate("document.querySelector('[name=title]').focus()");
  await call('Input.insertText', { text: 'Keyboard no-JavaScript note' });
  await evaluate("document.querySelector('[name=body]').focus()");
  await call('Input.insertText', {
    text: 'Stored by an ordinary native POST form.',
  });
  await evaluate(
    'document.querySelector(\'form[action="/workspace/save"] button\').focus()'
  );
  await enter();
  await waitFor(
    'document.querySelectorAll(\'form[action="/workspace/save"]\').length === 2'
  );
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('[name=title]')).some(input=>input.value==='Keyboard no-JavaScript note')"
    ),
    true
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: version.product,
      checked: [
        'production framework route discovery and public assets',
        'standalone counter and responsive layout',
        'local page and worker endpoints',
        'keyboard login and reactive counter',
        'consented analytics and accessible report view',
        'browser JSON-RPC/MCP/Connect/tRPC calls',
        'standalone adapter store updates',
        'RTL locale',
        'reduced motion',
        'PCM/WAV keyboard playback',
        '1440/390 layout',
        'pagehide cleanup',
        'JavaScript-disabled native POST',
      ],
    })
  );
  await send('Browser.close');
} finally {
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([
      once(browser, 'exit').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (browser.exitCode === null && browser.signalCode === null) {
      /** Observe actual owned child exit before removing its profile and fixture files. */
      const ended = once(browser, 'exit').catch(() => {});
      browser.kill('SIGKILL');
      await ended;
    }
  }
  await workers?.stop();
  await app?.close();
  config.lifecycleHooks?.dispose();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
  }
  await Promise.all([
    rm(compiled, { recursive: true, force: true }),
    rm(directory, { recursive: true, force: true }),
    rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }),
  ]);
}
