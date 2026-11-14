import { timingSafeEqual } from 'node:crypto';
import type { QueueOperations, QueueJobState } from './index.js';

export interface QueueDashboardOptions {
  /** Explicit trusted app-session authenticator. Return a server-issued principal, never request fields. */
  authorize: (request: Request) => unknown | Promise<unknown>;
  /** Validate a per-session CSRF header using server-side state. No default bypass. */
  verifyCsrf: (
    request: Request,
    principal: unknown
  ) => boolean | Promise<boolean>;
  /** Return the matching session CSRF token for the rendered dashboard. */
  csrfToken: (request: Request, principal: unknown) => string | Promise<string>;
  /** Explicit validated same-origin mount, default /_queue/admin; no automatic server is started. */
  prefix?: string;
  /** Canonical public origin when proxied. POST Origin must match this exactly. */
  publicOrigin?: string;
}
/** Fixed private no-store/security headers; cookies govern representation variation. */
const headers: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  vary: 'Cookie',
};
/** Fixed CSP prohibits inline executable scripts/styles and cross-origin assets by default. */
const security = {
  ...headers,
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
/** Serialize only explicit redacted API records with fixed private security headers.
 * @param {unknown} body - Fixed redacted JSON projection.
 * @param {number} status - Explicit fixed response status, default 200.
 * @returns {Response} Private JSON response.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...security, 'content-type': 'application/json; charset=utf-8' },
  });
/** Serve one authored HTML/JS/CSS representation with the same private security policy.
 * @param {string} content - Authored serialized representation.
 * @param {string} type - Fixed representation MIME.
 * @returns {Response} Private same-origin authored asset/page.
 */
const page = (content: string, type: string) =>
  new Response(content, {
    status: 200,
    headers: { ...security, 'content-type': type },
  });
/** Escape host CSRF display/attribute text for HTML context, not URL or authorization policy.
 * @param {string} s - Explicit host-issued inert attribute text.
 * @returns {string} HTML-context escaped text.
 */
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
/** Validate a fixed canonical mount without traversal/double-slash ambiguities.
 * @param {string} s - Explicit host mount.
 * @returns {boolean} Whether the mount is canonical and traversal-free.
 */
const validPrefix = (s: string) =>
  /^\/[A-Za-z0-9/_-]{1,100}$/.test(s) &&
  !s.includes('//') &&
  !s.endsWith('/') &&
  !s.includes('..');
/** Read at most 4 KiB JSON under a five-second reader deadline; reject missing/nonobject bodies. Host session/origin/CSRF checks run before this parser.
 * @param {Request} request - Borrowed explicit operator write request.
 * @returns {Promise<Record<string,unknown>>} Inert parsed object; no source, SQL or shell expression is evaluated.
 */
async function smallJson(request: Request): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(
      request.headers.get('content-type') ?? ''
    )
  ) {
    throw new TypeError('Expected application/json');
  }
  /** Optional declared body length; actual counted bytes remain authoritative. */
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) {
    throw new RangeError('Request body too large');
  }
  if (!request.body) {
    throw new TypeError('Request body missing');
  }
  /** Owned request-body reader lock released in finally, including deadline/size failures. */
  const reader = request.body.getReader();
  let size = 0;
  /** Bounded raw request chunks, parsed only after the finite byte/deadline checks. */
  const parts: Uint8Array[] = [];
  let timedOut = false;
  /** Owned five-second body deadline; cancellation is observed before JSON parsing. */
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  timer.unref?.();
  try {
    // Count actual bytes under the owned deadline before parsing any JSON.
    for (;;) {
      /** Native read result counted before retention; no content evaluation. */
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel().catch(() => {});
        throw new RangeError('Request body too large');
      }
      parts.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (timedOut) {
    throw new Error('Request body timed out');
  }
  /** Inert parsed JSON object; individual control fields are separately validated. */
  const value = JSON.parse(
    Buffer.concat(parts.map((part) => Buffer.from(part))).toString('utf8')
  ) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid request body');
  }
  return value as Record<string, unknown>;
}
/** Authored readable browser program; stored data reaches only textContent/native nodes. */
const script = String.raw`'use strict';
/** Explicit same-origin dashboard mount from the authored script element or current page. */
const base =
  document.currentScript?.getAttribute('data-base') ||
  location.pathname.replace(/\/app\.js$/, '');
/** Host-issued session CSRF token used only on authorized writes; never telemetry. */
const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
/** Resolve only the fixed authored dashboard element IDs.
 * @param {string} id - Fixed authored dashboard node ID.
 * @returns {HTMLElement | null} Existing native element, without executing selector input.
 */
const $ = (id) => document.getElementById(id);
let selected = '';
/** Create an inert native display node without interpreting stored text as HTML.
 * @param {string} tag - Fixed authored tag name.
 * @param {unknown} txt - Authorized redacted display value.
 * @returns {HTMLElement} Owned text-only display node.
 */
function item(tag, txt) {
  /** New owned native element whose content is assigned with textContent, never HTML. */
  const el = document.createElement(tag);
  el.textContent = String(txt);
  return el;
}
/** Call only the same-origin dashboard API using the host session and explicit CSRF header on writes.
 * @param {string} url - Fixed relative dashboard query suffix.
 * @param {string} method - Explicit GET/POST operation, default GET.
 * @param {object} body - Optional fixed control payload; no credentials or job bodies.
 * @returns {Promise<object>} Authorized response or fixed readable server error; no auto-retry of mutations.
 */
async function api(url, method = 'GET', body) {
  /** Same-origin authenticated API response; server independently authorizes every operation. */
  const res = await fetch(base + '/api' + url, {
    method,
    credentials: 'same-origin',
    headers: body
      ? { 'content-type': 'application/json', 'x-csrf-token': token }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  /** Parsed authorized JSON response; error messages remain the server fixed projection. */
  const data = await res.json();
  if (!res.ok) throw Error(data.error || 'Request failed');
  return data;
}
/** Render a readable status with textContent, never HTML.
 * @param {string} message - Inert status text.
 * @returns {void} Updates the authored live-status node.
 */
function info(message) {
  $('notice').textContent = message;
}
/** Refresh the explicit authorized queue inventory and retain selection only if still permitted.
 * @returns {Promise<void>} Updates native options/counters and bounded job metadata, preserving fixed errors.
 */
async function show() {
  try {
    /** Authorized bounded queue/job inventory, never raw job bodies. */
    const result = await api('?kind=queues');
    /** Owned native queue selector populated only with authorized names. */
    const dropdown = $('queues');
    /** Previously selected authorized queue name retained across refresh. */
    const before = dropdown.value;
    dropdown.replaceChildren();
    // Render only the bounded authorized inventory using native text nodes and explicit controls.
    for (const row of result.queues) {
      /** Owned inert queue option; its display name uses textContent. */
      const opt = item('option', row.name);
      opt.value = row.name;
      dropdown.append(opt);
    }
    dropdown.value = result.queues.some((q) => q.name === before)
      ? before
      : result.queues[0]?.name || '';
    selected = dropdown.value;
    /** Owned fixed counter container; no raw service object is rendered. */
    const counts = $('counts');
    counts.replaceChildren();
    /** Selected authorized queue summary, if still available. */
    const current = result.queues.find((q) => q.name === selected);
    // Render only the bounded authorized inventory using native text nodes and explicit controls.
    for (const [k, v] of Object.entries(current?.counts || {})) {
      /** Owned native counter element. */
      const div = document.createElement('div');
      div.className = 'stat';
      div.append(item('span', k), item('strong', v));
      counts.append(div);
    }
    await jobs();
    info('Last refreshed ' + new Date().toLocaleTimeString());
  } catch (error) {
    info(error.message);
  }
}
/** Render a bounded redacted job page and native controls without exposing raw payload/result/stack data.
 * @returns {Promise<void>} Updates only the authored table; authorization remains server-side.
 */
async function jobs() {
  if (!selected) {
    $('jobs').replaceChildren();
    return;
  }
  try {
    /** Explicit native state chosen from the authored fixed select options. */
    const state = $('state').value;
    /** Authorized bounded queue/job inventory, never raw job bodies. */
    const result = await api(
      '?kind=jobs&queue=' +
        encodeURIComponent(selected) +
        '&state=' +
        encodeURIComponent(state),
    );
    /** Owned native job table body receiving redacted metadata only. */
    const tbody = $('jobs');
    tbody.replaceChildren();
    // Render only the bounded authorized inventory using native text nodes and explicit controls.
    for (const job of result.jobs) {
      /** Owned native row for one bounded redacted job summary. */
      const tr = document.createElement('tr');
      // Render only the bounded authorized inventory using native text nodes and explicit controls.
      for (const text of [
        job.id,
        job.name,
        job.state,
        job.attemptsMade,
        job.finishedOn ? new Date(job.finishedOn).toLocaleString() : '—',
      ])
        tr.append(item('td', text));
      /** Owned native cell for explicit authorized controls. */
      const td = document.createElement('td');
      if (job.state === 'failed') {
        /** Owned native retry/control button; server reauthorizes even when visible. */
        const button = item('button', 'Retry');
        button.onclick = () => act('retry', job.id);
        td.append(button);
      }
      tr.append(td);
      tbody.append(tr);
    }
  } catch (error) {
    info(error.message);
  }
}
/** Confirm one explicit operator mutation, then rely on fresh server authorization/origin/CSRF checks. Never retry an ambiguous write automatically.
 * @param {string} action - Fixed authored control operation.
 * @param {string} id - Optional opaque native job reference.
 * @returns {Promise<void>} Updates readable status after an explicit response; no role claims or executable data.
 */
async function act(action, id) {
  if (!selected) return;
  /** Inert confirmation text for one explicit operator action; never executable markup. */
  const label =
    action === 'retry'
      ? 'Retry this failed job?'
      : action.replace('-', ' ') + ' on ' + selected + '?';
  if (!confirm(label)) return;
  try {
    await api('', 'POST', { action, queue: selected, ...(id ? { id } : {}) });
    info('Operation completed');
    await show();
  } catch (error) {
    info(error.message);
  }
}
document.addEventListener('DOMContentLoaded', () => {
  $('refresh').onclick = show;
  $('queues').onchange = show;
  $('state').onchange = jobs;
  // Render only the bounded authorized inventory using native text nodes and explicit controls.
  for (const button of document.querySelectorAll('[data-action]'))
    button.onclick = () => act(button.dataset.action);
  show();
});
`;
/** Authored scoped dashboard stylesheet; no global application CSS filter. */
const css = String.raw`body {
  font:
    15px system-ui,
    sans-serif;
  max-width: 1100px;
  margin: 30px auto;
  padding: 0 20px;
  color: #162334;
  background: #f6f8fb;
}
h1 {
  font-size: 28px;
}
main {
  display: grid;
  gap: 20px;
}
section {
  background: #fff;
  border: 1px solid #dce2e9;
  border-radius: 12px;
  padding: 18px;
  overflow-x: auto;
}
button,
select {
  padding: 8px 12px;
  margin: 3px;
  border: 1px solid #bbc6d3;
  border-radius: 6px;
  background: white;
  cursor: pointer;
}
button:hover {
  background: #e9f0fc;
}
button:focus-visible,
select:focus-visible {
  outline: 3px solid #2365d1;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.stat {
  display: grid;
  border: 1px solid #e1e6ed;
  border-radius: 8px;
  padding: 10px;
  min-width: 86px;
}
.stat strong {
  font-size: 22px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  padding: 9px;
  text-align: left;
  border-bottom: 1px solid #e1e6ed;
  overflow-wrap: anywhere;
}
#notice {
  min-height: 24px;
}
`;
/** Create inert same-origin route descriptors only with explicit host session/CSRF callbacks. Every operation remains server-authorized; this factory starts no HTTP server or persistent resource.
 * @param {object} service - Borrowed configured queue names plus the separately authorized operations surface.
 * @param {function} service.names - Trusted configured queue inventory.
 * @param {QueueOperations} service.operations - Fresh per-action/queue authorization surface.
 * @param {QueueDashboardOptions} config - Private trusted host session, CSRF, mount and canonical origin policy.
 * @returns {object} Route descriptors sharing the enclosing queue/service generation; no separate close owner.
 */
export function createQueueDashboard(
  service: {
    /** Snapshot configured private native queue names for independent per-queue authorization.
     * @returns {string[]} Trusted internal names, not a public unauthorized inventory.
     */
    names(): string[];
    /** Borrowed fresh-authorized native operations, never raw job access. */
    operations: QueueOperations;
  },
  config: QueueDashboardOptions
) {
  if (
    !config ||
    typeof config.authorize !== 'function' ||
    typeof config.verifyCsrf !== 'function' ||
    typeof config.csrfToken !== 'function'
  ) {
    throw new TypeError(
      'Dashboard requires session authentication and CSRF callbacks'
    );
  }
  /** Validated host mount used by all authored dashboard/API/asset URLs. */
  const prefix = config.prefix ?? '/_queue/admin';
  if (!validPrefix(prefix)) {
    throw new TypeError('Invalid queue dashboard prefix');
  }
  let publicOrigin: string | undefined;
  if (config.publicOrigin) {
    /** Canonical explicit host origin, without credentials/path/query/fragment. */
    const parsed = new URL(config.publicOrigin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError('Invalid dashboard public origin');
    }
    publicOrigin = parsed.origin;
  }
  /** Authenticate every dashboard/asset/API request, verify origin/CSRF for writes and return only no-store redacted metadata.
   * @param {Request} request - Host-routed request whose URL/proxy origin policy is owned by the framework.
   * @returns {Promise<Response>} Private fixed response or explicit denial; raw native causes never reach clients.
   */
  async function handle(request: Request) {
    if (!['GET', 'POST'].includes(request.method)) {
      return json({ error: 'Method not allowed' }, 405);
    }
    let principal: unknown;
    try {
      principal = await config.authorize(request);
    } catch {
      return json({ error: 'Forbidden' }, 403);
    }
    if (
      principal === undefined ||
      principal === null ||
      principal === false ||
      principal === true
    ) {
      return json({ error: 'Forbidden' }, 403);
    }
    /** Parsed host-routed request URL; trusted proxy policy remains the framework responsibility. */
    const u = new URL(request.url);
    /** Route suffix within the explicitly registered mount. */
    const suffix = u.pathname.slice(prefix.length);
    if (suffix === '' && request.method === 'GET') {
      let token: string;
      try {
        token = await config.csrfToken(request, principal);
      } catch {
        return json({ error: 'Forbidden' }, 403);
      }
      if (
        typeof token !== 'string' ||
        token.length < 16 ||
        token.length > 512
      ) {
        return json({ error: 'Forbidden' }, 403);
      }
      return page(
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="csrf-token" content="${escapeHtml(token)}" />
    <link rel="stylesheet" href="${prefix}/app.css" />
    <title>Zerux Queue Operations</title>
  </head>
  <body>
    <main>
      <h1>Queue operations</h1>
      <p>
        Only redacted job metadata is displayed. Changes require session
        authorization and CSRF verification.
      </p>
      <section>
        <label
          >Queue
          <select id="queues"></select></label
        ><button id="refresh">Refresh</button>
        <p id="notice" role="status"></p>
        <div id="counts" class="stats"></div>
      </section>
      <section>
        <h2>Worker controls</h2>
        <button data-action="pause-queue">Pause queue</button
        ><button data-action="resume-queue">Resume queue</button
        ><button data-action="pause-worker">Pause local worker</button
        ><button data-action="resume-worker">Resume local worker</button>
      </section>
      <section>
        <h2>Jobs</h2>
        <label
          >State
          <select id="state">
            <option value="failed">Failed</option>
            <option value="waiting">Waiting</option>
            <option value="active">Active</option>
            <option value="delayed">Delayed</option>
            <option value="completed">Completed</option>
          </select></label
        >
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Job</th>
              <th>State</th>
              <th>Attempts</th>
              <th>Finished</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="jobs"></tbody>
        </table>
      </section>
    </main>
    <script
      defer
      src="${prefix}/app.js"
      data-base="${prefix}"
    ></script>
  </body>
</html>
`,
        'text/html; charset=utf-8'
      );
    }
    if (suffix === '/app.js' && request.method === 'GET') {
      return page(script, 'text/javascript; charset=utf-8');
    }
    if (suffix === '/app.css' && request.method === 'GET') {
      return page(css, 'text/css; charset=utf-8');
    }
    if (suffix !== '/api') {
      return json({ error: 'Not found' }, 404);
    }
    if (request.method === 'GET') {
      /** Fixed read-only API selector from request query, not arbitrary execution. */
      const kind = u.searchParams.get('kind');
      if (kind === 'queues') {
        /** Only successfully authorized queue status rows; denied queue names are omitted. */
        const rows = [];
        // Independently authorize each name; omission prevents unauthorized queue disclosure.
        for (const name of service.names()) {
          try {
            rows.push({
              name,
              ...(await service.operations.status(name, principal)),
            });
          } catch {
            /* Never expose unauthorized queue names */
          }
        }
        return json({ queues: rows });
      }
      if (kind === 'jobs') {
        /** Explicit configured target queue, reauthorized on each operator action. */
        const queue = u.searchParams.get('queue') ?? '';
        /** Explicit selected native inspection state; owning operations validate the vocabulary. */
        const state = u.searchParams.get('state') ?? 'failed';
        try {
          return json(
            await service.operations.inspect(
              queue,
              { states: [state as QueueJobState], limit: 25 },
              principal
            )
          );
        } catch {
          return json({ error: 'Not authorized or invalid query' }, 403);
        }
      }
      return json({ error: 'Invalid query' }, 400);
    }
    /** Required exact write Origin; loopback is not an authorization bypass. */
    const origin = request.headers.get('origin');
    if (
      !origin ||
      origin !== (publicOrigin ?? u.origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return json({ error: 'Invalid request origin' }, 403);
    }
    try {
      /** Bounded presented session CSRF header, never logged or exposed in metadata. */
      const provided = request.headers.get('x-csrf-token');
      /** Fresh host-issued CSRF token compared without exposing its value. */
      const expected = await config.csrfToken(request, principal);
      if (
        typeof provided !== 'string' ||
        typeof expected !== 'string' ||
        provided.length < 16 ||
        provided.length > 512 ||
        Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) ||
        (await config.verifyCsrf(request, principal)) !== true
      ) {
        return json({ error: 'CSRF verification failed' }, 403);
      }
    } catch {
      return json({ error: 'CSRF verification failed' }, 403);
    }
    let body: Record<string, unknown>;
    try {
      body = await smallJson(request);
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }
    /** Explicit configured target queue, reauthorized on each operator action. */
    const queue = body.queue;
    /** Fixed allowlisted control operation; unknown strings reject without code lookup. */
    const action = body.action;
    /** Optional opaque native job ID, validated by the owning operations API. */
    const id = body.id;
    if (typeof queue !== 'string' || typeof action !== 'string') {
      return json({ error: 'Invalid operation' }, 400);
    }
    try {
      /** Borrowed fresh-authorized native operations; direct native jobs stay private. */
      const operations: QueueOperations = service.operations;
      if (action === 'retry') {
        if (typeof id !== 'string') {
          return json({ error: 'Missing job ID' }, 400);
        }
        await operations.retryFailed(queue, id, principal);
      } else if (action === 'pause-queue') {
        await operations.pauseQueue(queue, principal);
      } else if (action === 'resume-queue') {
        await operations.resumeQueue(queue, principal);
      } else if (action === 'pause-worker') {
        await operations.pauseWorker(queue, principal);
      } else if (action === 'resume-worker') {
        await operations.resumeWorker(queue, principal);
      } else {
        return json({ error: 'Invalid operation' }, 400);
      }
      return json({ ok: true });
    } catch {
      return json({ error: 'Operation rejected or unavailable' }, 403);
    }
  }
  return {
    routes: () => [
      { pattern: prefix, handler: handle },
      { pattern: prefix + '/api', handler: handle },
      { pattern: prefix + '/app.js', handler: handle },
      { pattern: prefix + '/app.css', handler: handle },
    ],
  };
}
