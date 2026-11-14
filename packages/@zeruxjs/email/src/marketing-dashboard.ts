/** Opt-in authenticated HTTP management for function-first marketing campaigns.
 * Does not expose provider credentials, per-contact JSON, or unbounded recipient lists. */
import type {
  MarketingCampaignService,
  MarketingCampaignInput,
  MarketingRecipient,
} from './marketing.js';

export interface MarketingCampaignDashboardOptions {
  /** Borrowed function-first campaign service; its resources remain host-owned. */
  service: MarketingCampaignService;
  /** Required host session verifier returning an opaque principal; booleans/null/undefined are denied. */
  authorize: (request: Request) => unknown | Promise<unknown>;
  /** Required fresh per-campaign tenant/action authorization; literal true is mandatory. */
  authorizeCampaign: (
    principal: unknown,
    code: string,
    action:
      | 'read'
      | 'recipients'
      | 'preview'
      | 'append'
      | 'enqueue'
      | 'pause'
      | 'resume'
      | 'cancel'
      | 'redrive'
      | 'schedule'
      | 'archive'
      | 'finalize'
      | 'export'
  ) => boolean | Promise<boolean>;
  /** Creation is a separate permission because a code does not yet exist. */
  authorizeCreate: (principal: unknown) => boolean | Promise<boolean>;
  /** Listing is only available when the entire campaign namespace is authorized. */
  authorizeList?: (principal: unknown) => boolean | Promise<boolean>;
  /** Required per-write host CSRF verifier; only literal true permits dispatch after exact origin checks. */
  verifyCsrf: (
    request: Request,
    principal: unknown
  ) => boolean | Promise<boolean>;
  /** Required host session token provider, 16–512 characters; token is escaped into the private page. */
  csrfToken: (request: Request, principal: unknown) => string | Promise<string>;
  /** Explicit validated mount prefix; defaults to the documented private email dashboard path. */
  prefix?: string;
  /** Optional exact HTTP(S) origin with no credentials/path/query/fragment; otherwise use the host-verified request URL origin. */
  publicOrigin?: string;
}
/** Private no-store response policy with same-origin assets, no framing and no referrer leakage. */
const headers = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
/**
 * Serialize a deliberately projected JSON value under the fixed private response headers.
 *
 * @param {unknown} value - Untrusted count/provider value or deliberately projected private response data.
 * @param {number} status - HTTP status, default 200.
 * @returns {Response} Private no-store JSON response; caller must pass only an authorized projection.
 */
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
/**
 * Return authored page/asset text under private headers; dynamic HTML values must already be escaped.
 *
 * @param {string} value - Untrusted count/provider value or deliberately projected private response data.
 * @returns {Response} Private no-store authored page/asset response; dynamic HTML must already be escaped.
 */
const html = (value: string) =>
  new Response(value, {
    headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
  });
/**
 * Recognize only bounded opaque campaign references; syntax never grants tenant access.
 *
 * @param {unknown} v - Untrusted opaque campaign identifier.
 * @returns {boolean} Whether the identifier syntax is valid; tenant permission is checked separately.
 */
const validCode = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(v);
/**
 * Escape stored/token values for authored HTML attributes and text; not a sanitizer for arbitrary markup.
 *
 * @param {string} s - Dynamic text/token value inserted into authored HTML.
 * @returns {string} HTML text/attribute encoded value; never use this as arbitrary HTML sanitization.
 */
const safe = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
/** Read one JSON object with a 131072-byte streamed ceiling and a five-second reader deadline; always release timer and reader ownership.
 * @param {Request} request - Host-routed Fetch request; host owns trusted URL construction, session lifetime and callback deadlines.
 * @returns {Promise<Record<string, unknown>>} Bounded untrusted object; action-specific schema validation still runs before persistence.
 */
async function readBody(request: Request) {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(
      request.headers.get('content-type') ?? ''
    )
  ) {
    throw new TypeError('JSON body required');
  }
  /** Untrusted declared body length; streaming bytes are still counted independently. */
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 131_072)) {
    throw new RangeError('Body too large');
  }
  /** Owned request-body reader released in finally; deadline cancellation is cooperative. */
  const reader = request.body?.getReader();
  if (!reader) {
    throw new TypeError('Body required');
  }
  /** Finite body chunks retained only until bounded JSON parsing completes. */
  const chunks: Uint8Array[] = [];
  let size = 0,
    expired = false;
  /** Owned five-second body-read deadline; cancellation does not force-cancel arbitrary host callbacks. */
  const timeout = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  timeout.unref?.();
  try {
    // Count actual streamed bytes; always release reader/timer ownership even on overflow.
    for (;;) {
      /** Next native reader result; count actual bytes rather than trusting Content-Length. */
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 131_072) {
        await reader.cancel().catch(() => {});
        throw new RangeError('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  if (expired) {
    throw new Error('Body timed out');
  }
  /** Bounded parsed JSON value; arrays and primitives are rejected before action dispatch. */
  const raw = JSON.parse(
    Buffer.concat(chunks.map((v) => Buffer.from(v))).toString('utf8')
  ) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('JSON object required');
  }
  return raw as Record<string, unknown>;
}
/** Authored same-origin dashboard stylesheet; no remote asset or provider credential is embedded. */
const css = String.raw`body {
  font:
    16px system-ui,
    sans-serif;
  max-width: 900px;
  margin: 24px auto;
  padding: 16px;
  color: #17212d;
  background: #f8fafc;
}
main {
  display: grid;
  gap: 14px;
}
section {
  padding: 16px;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}
label {
  display: block;
  margin: 8px;
}
input,
textarea {
  max-width: 90%;
  padding: 8px;
  margin: 8px;
}
textarea {
  width: 85%;
}
button {
  padding: 9px;
  margin: 4px;
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
#status {
  min-height: 24px;
}
`;
/** Authored same-origin browser controller; use textContent for private names and result data. */
const js = String.raw`'use strict';
/** Validated server-rendered mount prefix from this same-origin script element. */
const root = document.currentScript.dataset.root;
/** Private session CSRF token supplied by the authenticated page; never store it in telemetry. */
const csrf = document.querySelector('meta[name="csrf"]').content;
/**
 * Resolve an authored control by its fixed ID.
 *
 * @param {string} id - Authored element ID, never untrusted HTML.
 * @returns {HTMLElement | null} Native element lookup; required controls are part of the server template.
 */
const $ = (id) => document.getElementById(id);
/**
 * Display operation feedback through textContent.
 *
 * @param {string} s - Operation feedback; never interpreted as HTML.
 * @returns {void} Updates only the owned result/status region.
 */
const message = (s) => {
  $('status').textContent = s;
};
/**
 * Display private result data through textContent and readable JSON.
 *
 * @param {unknown} v - Authorized bounded response projection.
 * @returns {void} Updates only the owned result/status region.
 */
const show = (v) => {
  $('result').textContent = JSON.stringify(v, null, 2);
};
let lastView = '',
  nextCursor = null;
/**
 * Call only the same-origin registered management API; the server reauthorizes every operation.
 *
 * @param {string} action - Fixed view/action selected by an authored control.
 * @param {string} method - GET by default; writes include the private CSRF token.
 * @param {object | undefined} body - Private JSON action fields, absent for reads.
 * @param {boolean} paginate - Default false; use only the last returned opaque continuation.
 * @returns {Promise<object>} Authorized parsed projection; non-success responses reject without automatic mutation replay.
 */
async function call(action, method = 'GET', body, paginate = false) {
  /** Structured query parameters; server-side permission and page budgets remain authoritative. */
  const params = new URLSearchParams({ code: $('code').value, view: action });
  if (method === 'GET') {
    params.set('limit', '10');
    if (paginate && nextCursor) {
      params.set('cursor', nextCursor);
    }
  }
  /** Same-origin authenticated Fetch response, or its projected parsed create receipt. */
  const response = await fetch(root + '/api?' + params, {
    method,
    credentials: 'same-origin',
    headers: body
      ? { 'content-type': 'application/json', 'x-csrf-token': csrf }
      : {},
    body: body ? JSON.stringify({ action, ...body }) : undefined,
  });
  /** Parsed server projection; render as text and retain explicit coverage notices. */
  const value = await response.json();
  if (!response.ok) {
    throw Error(value.error || 'Request failed');
  }
  if (method === 'GET') {
    lastView = action;
    nextCursor = value.nextCursor ?? null;
  }
  return value;
}
$('load').onclick = async () => {
  try {
    show(await call('overview'));
    message('Campaign loaded');
  } catch (e) {
    message(e.message);
  }
};
$('recipients').onclick = async () => {
  try {
    show(await call('recipients'));
    message('Bounded recipient list loaded');
  } catch (e) {
    message(e.message);
  }
};
$('previews').onclick = async () => {
  try {
    show(await call('previews'));
    message('Recipient previews loaded');
  } catch (e) {
    message(e.message);
  }
};
$('nextPage').onclick = async () => {
  if (!lastView || !nextCursor) {
    message('No more pages');
    return;
  }
  try {
    show(await call(lastView, 'GET', undefined, true));
    message('Next page loaded');
  } catch (e) {
    message(e.message);
  }
};
$('report').onclick = async () => {
  try {
    show(await call('report'));
    message('Delivery state report page loaded');
  } catch (e) {
    message(e.message);
  }
};
$('export').onclick = async () => {
  try {
    show(await call('export'));
    message('Redacted campaign export page loaded');
  } catch (e) {
    message(e.message);
  }
};
$('list').onclick = async () => {
  try {
    show(await call('list'));
    message('Campaign list loaded');
  } catch (e) {
    message(e.message);
  }
};
$('create').onclick = async () => {
  try {
    /** Untrusted authored campaign HTML; send to the server as data, never execute it here. */
    const content = $('content').value;
    /** Private operator-entered recipients split for bounded server validation. */
    const emails = $('emails')
      .value.split(/[\s,]+/)
      .filter(Boolean);
    /** Explicit campaign creation data with autoEnqueue false; storage does not grant tracking consent. */
    const input = {
      name: $('name').value,
      subject: $('subject').value,
      content,
      providers: [$('account').value],
      emails,
      isTracking: $('tracking').checked,
      autoEnqueue: false,
    };
    /** Same-origin authenticated Fetch response, or its projected parsed create receipt. */
    const response = await call('create', 'POST', { input });
    $('code').value = response.code;
    show(response);
    message('Campaign stored; use Enqueue to schedule delivery');
  } catch (e) {
    message(e.message);
  }
};
$('schedule').onclick = async () => {
  try {
    /** Parsed operator schedule epoch; invalid dates reject before the server independently validates it. */
    const sendAt = Date.parse($('sendAt').value);
    if (!Number.isSafeInteger(sendAt)) {
      throw Error('Select a valid schedule');
    }
    show(await call('schedule', 'POST', { code: $('code').value, sendAt }));
    message('Schedule updated');
  } catch (e) {
    message(e.message);
  }
};
// Bind only the fixed authored mutation controls; requests remain server-authorized.
for (const action of [
  'enqueue',
  'pause',
  'resume',
  'cancel',
  'redrive',
  'finalize',
  'archive',
]) {
  $(action).onclick = async () => {
    try {
      show(await call(action, 'POST', { code: $('code').value }));
      message(action + ' completed');
    } catch (e) {
      message(e.message);
    }
  };
}
`;
/** Create explicit authenticated function-first campaign handlers; creation, namespace listing and individual actions retain separate host permissions.
 * @param {MarketingCampaignDashboardOptions} options - Borrowed campaign service plus required host session, CSRF and scoped authorization callbacks.
 * @returns {object} Host-registerable handle/routes without owning a listener or the campaign service.
 */
export function createMarketingCampaignDashboard(
  options: MarketingCampaignDashboardOptions
) {
  if (
    !options ||
    !options.service ||
    ![
      'get',
      'list',
      'recipients',
      'previewPage',
      'appendRecipients',
      'enqueue',
      'pause',
      'resume',
      'cancel',
      'redrivePending',
      'create',
      'overview',
      'schedule',
      'archive',
      'finalize',
      'exportPage',
      'report',
    ].every((k) => typeof (options.service as any)[k] === 'function') ||
    ![
      'authorize',
      'authorizeCampaign',
      'authorizeCreate',
      'verifyCsrf',
      'csrfToken',
    ].every((k) => typeof (options as any)[k] === 'function')
  ) {
    throw new TypeError(
      'Marketing dashboard requires a campaign service and host authorization'
    );
  }
  /** Validated explicit host mount prefix; host routing must dispatch only the declared paths. */
  const prefix = options.prefix ?? '/_email/marketing';
  if (
    !/^\/[A-Za-z0-9/_-]{2,100}$/.test(prefix) ||
    prefix.includes('//') ||
    prefix.endsWith('/') ||
    prefix.includes('..')
  ) {
    throw new TypeError('Invalid dashboard route');
  }
  let origin: string | undefined;
  if (options.publicOrigin) {
    /** Request/configuration URL; forwarding headers never select the trusted public origin. */
    const url = new URL(options.publicOrigin);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new TypeError('Invalid dashboard origin');
    }
    origin = url.origin;
  }
  /** Authorize every page, asset and API request; mutations additionally require exact origin, CSRF and scoped action permission. No listener is created.
   * @param {Request} request - Host-routed Fetch request; host owns trusted URL construction, session lifetime and callback deadlines.
   * @returns {Promise<Response>} Private no-store response with fixed redacted failures; host callback deadlines remain host-owned.
   */
  async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    let principal: unknown;
    try {
      principal = await options.authorize(request);
    } catch {
      return json({ error: 'Forbidden' }, 403);
    }
    if (
      principal === true ||
      principal === false ||
      principal === null ||
      principal === undefined
    ) {
      return json({ error: 'Forbidden' }, 403);
    }
    /** Request/configuration URL; forwarding headers never select the trusted public origin. */
    const url = new URL(request.url);
    /** Request pathname relative to the registered mount; actual router registration remains host-owned. */
    const suffix = url.pathname.slice(prefix.length);
    if (suffix === '' && request.method === 'GET') {
      let token: string;
      try {
        token = await options.csrfToken(request, principal);
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
      return html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="csrf" content="${safe(token)}"><link rel="stylesheet" href="${prefix}/app.css"><title>Zerux Marketing Campaigns</title></head><body><main><h1>Marketing campaigns</h1><p>Create one reusable template and queue recipient-specific renders without duplicating content. All actions require host authorization.</p><section><label>Campaign code <input id="code" maxlength="96"></label><button id="load">Overview</button><button id="list">List</button><button id="recipients">Recipients</button><button id="previews">Previews</button><button id="export">Redacted export</button><button id="report">Delivery report</button><button id="nextPage">Next page</button></section><section><h2>New campaign</h2><label>Name <input id="name" maxlength="120"></label><label>Subject <input id="subject" maxlength="998"></label><label>Account <input id="account"></label><label>Recipient emails, comma or newline separated <textarea id="emails" rows="4"></textarea></label><label>HTML content <textarea id="content" rows="7"></textarea></label><label><input id="tracking" type="checkbox"> Enable email tracking</label><button id="create">Create draft</button></section><section><label>Schedule (local time) <input id="sendAt" type="datetime-local"></label><button id="schedule">Schedule</button><button id="enqueue">Enqueue</button><button id="redrive">Redrive pending</button><button id="pause">Pause</button><button id="resume">Resume</button><button id="cancel">Cancel</button><button id="finalize">Finalize completed</button><button id="archive">Archive</button></section><p id="status" role="status"></p><section><h2>Results</h2><pre id="result"></pre></section></main><script defer src="${prefix}/app.js" data-root="${prefix}"></script></body></html>`
      );
    }
    if (suffix === '/app.js' && request.method === 'GET') {
      return new Response(js, {
        headers: {
          ...headers,
          'content-type': 'text/javascript; charset=utf-8',
        },
      });
    }
    if (suffix === '/app.css' && request.method === 'GET') {
      return new Response(css, {
        headers: { ...headers, 'content-type': 'text/css; charset=utf-8' },
      });
    }
    if (suffix !== '/api') {
      return json({ error: 'Not found' }, 404);
    }
    let action: string,
      code: unknown,
      input: Record<string, unknown> | undefined;
    if (request.method === 'GET') {
      action = url.searchParams.get('view') ?? 'overview';
      code = url.searchParams.get('code');
    } else {
      if (
        request.headers.get('origin') !== (origin ?? url.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      ) {
        return json({ error: 'Invalid origin' }, 403);
      }
      try {
        if ((await options.verifyCsrf(request, principal)) !== true) {
          return json({ error: 'Forbidden' }, 403);
        }
      } catch {
        return json({ error: 'Forbidden' }, 403);
      }
      try {
        input = await readBody(request);
      } catch {
        return json({ error: 'Invalid request body' }, 400);
      }
      action = String(input.action ?? '');
      code = input.code;
    }
    /** Borrowed function-first campaign API; dashboard registration does not own its lifecycle. */
    const service = options.service;
    if (action === 'list' && request.method === 'GET') {
      if (!options.authorizeList) {
        return json({ error: 'Forbidden' }, 403);
      }
      try {
        if ((await options.authorizeList(principal)) !== true) {
          return json({ error: 'Forbidden' }, 403);
        }
      } catch {
        return json({ error: 'Forbidden' }, 403);
      }
      /** Validated finite page size with operation-specific caps before any service read. */
      const limit = Math.min(
        50,
        Math.max(1, Number(url.searchParams.get('limit') ?? 25))
      );
      if (!Number.isSafeInteger(limit)) {
        return json({ error: 'Invalid page size' }, 400);
      }
      try {
        /** Private bounded campaign page; response copies only approved management fields. */
        const list = await service.list({
          cursor: url.searchParams.get('cursor'),
          limit,
        });
        return json({
          campaigns: list.campaigns.map((c) => ({
            code: c.code,
            name: c.name,
            status: c.status,
            createdAt: c.createdAt,
            recipientCount: c.recipientCount,
          })),
          nextCursor: list.nextCursor,
          done: list.done,
        });
      } catch {
        return json({ error: 'Campaign listing unavailable' }, 503);
      }
    }
    if (action === 'create' && request.method === 'POST') {
      try {
        if ((await options.authorizeCreate(principal)) !== true) {
          return json({ error: 'Forbidden' }, 403);
        }
      } catch {
        return json({ error: 'Forbidden' }, 403);
      }
      /** Untrusted create payload; the service performs detailed schema validation after authorization. */
      const candidate = input?.input;
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return json({ error: 'Campaign definition required' }, 400);
      }
      /** Private parsed/provider result; validate and project it before any response. */
      const value = candidate as MarketingCampaignInput;
      if ((value.recipients ?? value.emails ?? []).length > 100) {
        return json(
          { error: 'Use server-side streaming import for larger audiences' },
          400
        );
      }
      try {
        return json({ code: await service.create(value) }, 201);
      } catch {
        return json({ error: 'Campaign creation failed' }, 409);
      }
    }
    if (!validCode(code)) {
      return json({ error: 'Invalid campaign code' }, 400);
    }
    /** Fixed action-to-permission mapping; unknown actions still require read access before rejection. */
    const permission: MarketingCampaignDashboardOptions['authorizeCampaign'] extends (
      p: any,
      id: any,
      a: infer A
    ) => any
      ? A
      : never = (() => {
      if (action === 'recipients') {
        return 'recipients';
      }
      if (action === 'previews') {
        return 'preview';
      }
      if (action === 'append') {
        return 'append';
      }
      if (action === 'enqueue') {
        return 'enqueue';
      }
      if (action === 'redrive') {
        return 'redrive';
      }
      if (action === 'schedule') {
        return 'schedule';
      }
      if (action === 'archive') {
        return 'archive';
      }
      if (action === 'finalize') {
        return 'finalize';
      }
      if (action === 'export') {
        return 'export';
      }
      if (action === 'pause') {
        return 'pause';
      }
      if (action === 'resume') {
        return 'resume';
      }
      if (action === 'cancel') {
        return 'cancel';
      }
      return 'read';
    })();
    try {
      if (
        (await options.authorizeCampaign(principal, code, permission)) !== true
      ) {
        return json({ error: 'Forbidden' }, 403);
      }
    } catch {
      return json({ error: 'Forbidden' }, 403);
    }
    try {
      if (request.method === 'GET') {
        if (action === 'overview') {
          return json(await service.overview(code));
        }
        if (action === 'template') {
          /** Private campaign record; explicitly project fields instead of serializing leases or recipient data. */
          const c = await service.get(code);
          return c
            ? json({
                code: c.code,
                name: c.name,
                subject: c.subject,
                html: c.html,
                text: c.text,
                status: c.status,
                trackingEnabled: c.tracking.enabled === true,
              })
            : json({ error: 'Not found' }, 404);
        }
        /** Validated finite page size with operation-specific caps before any service read. */
        const limit = Math.min(
          action === 'previews' ? 20 : 100,
          Number(url.searchParams.get('limit') ?? 10)
        );
        if (!Number.isSafeInteger(limit) || limit < 1) {
          return json({ error: 'Invalid page size' }, 400);
        }
        /** Explicit exclusive keyset continuation; never a raw database query. */
        const cursor = url.searchParams.get('cursor');
        if (action === 'report') {
          return json(await service.report(code, { cursor, limit }));
        }
        if (action === 'export') {
          /** Authorized bounded redacted export result; no exportPII route is exposed here. */
          const result = await service.exportPage(code, { cursor, limit });
          return json(result);
        }
        if (action === 'previews') {
          /** Private bounded provider/service result before explicit dashboard projection. */
          const r = await service.previewPage(code, { cursor, limit });
          return json({
            items: r.items.map((v) => ({
              subject: v.subject,
              html: v.html,
              text: v.text,
              recipient: v.recipient,
              trackingEnabled: v.trackingEnabled,
            })),
            nextCursor: r.nextCursor,
            done: r.done,
          });
        }
        if (action === 'recipients') {
          /** Private bounded provider/service result before explicit dashboard projection. */
          const r = await service.recipients(code, { cursor, limit });
          return json({
            recipients: r.recipients.map((v) => ({
              email: v.email,
              name: v.name,
              deliveryState: v.deliveryState,
            })),
            nextCursor: r.nextCursor,
            done: r.done,
          });
        }
        return json({ error: 'Unknown view' }, 400);
      }
      if (action === 'schedule') {
        if (typeof input?.sendAt !== 'number') {
          return json({ error: 'Absolute sendAt milliseconds required' }, 400);
        }
        return json(await service.schedule(code, input.sendAt));
      }
      if (action === 'finalize') {
        return json(await service.finalize(code));
      }
      if (action === 'archive') {
        return json({ status: (await service.archive(code)).status });
      }
      if (action === 'enqueue') {
        return json(await service.enqueue(code));
      }
      if (action === 'redrive') {
        return json(await service.redrivePending(code));
      }
      if (action === 'pause') {
        return json({ status: (await service.pause(code)).status });
      }
      if (action === 'resume') {
        return json({ status: (await service.resume(code)).status });
      }
      if (action === 'cancel') {
        return json({ status: (await service.cancel(code)).status });
      }
      if (action === 'append') {
        /** Bounded append batch; HTTP caps at one hundred recipients and never silently enqueues. */
        const entries = input?.recipients;
        if (
          !Array.isArray(entries) ||
          entries.length < 1 ||
          entries.length > 100
        ) {
          return json(
            { error: 'Append 1..100 recipients per HTTP request' },
            400
          );
        }
        return json(
          await service.appendRecipients(
            code,
            entries as MarketingRecipient[],
            false
          )
        );
      }
      return json({ error: 'Unknown action' }, 400);
    } catch {
      return json(
        { error: 'Campaign action failed or store unavailable' },
        409
      );
    }
  }
  return {
    prefix,
    handle,
    routes: () => [
      { pattern: prefix, handler: handle },
      { pattern: `${prefix}/api`, handler: handle },
      { pattern: `${prefix}/app.js`, handler: handle },
      { pattern: `${prefix}/app.css`, handler: handle },
    ],
  };
}
