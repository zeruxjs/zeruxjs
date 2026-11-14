import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { readLimitedBody, localDevHost } from './request.js';

import { createDevtoolsDocumentPolicy } from './framing.js';

import {
  readModuleAsset,
  readModulePublicAsset,
  resolveModuleApiRequest,
  resolveModuleSocketRequest,
} from './module-loader.js';
import {
  readDevAsset,
  renderApplicationPage,
  renderHomePage,
  resolveCustomApiHandler,
} from './render.js';
import { appendSnapshotEvent, normalizeSnapshot } from './state.js';
import {
  getRegistryApp,
  readRegistry,
  readSharedDevRouteName,
  registerSharedDevApp,
  unregisterSharedDevApp,
  isPortFree,
  findPort,
  writeRegistry,
} from './registry.js';
import type { SharedDevEvent, SharedDevServerHandle } from './types.js';

/** Process-owned legacy listener, separate from optional scoped module hosts. */
let sharedServerHandle: SharedDevServerHandle | null = null;
/** Borrowed process-wide callback; replacing it does not dispose host resources. */
let sharedDevEventBroadcaster:
  | ((appName: string, event: SharedDevEvent) => void)
  | null = null;

/** End a legacy development JSON response with private no-store policy.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {unknown} body - Host-approved JSON value.
 * @param {number} [statusCode] - Authored status.
 * @returns {void} Commits the representation; no authentication is performed here.
 */
const sendJson = (res: ServerResponse, body: unknown, statusCode = 200) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });
  res.end(JSON.stringify(body));
};

/** End a controlled authored development document response.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {string} body - Trusted rendered HTML.
 * @param {number} [statusCode] - Authored status.
 * @param {Record<string, string>} [headers] - Response-owned security headers.
 * @returns {void} Writes the fixed HTML content type and explicit headers.
 */
const sendHtml = (
  res: ServerResponse,
  body: string,
  statusCode = 200,
  headers: Record<string, string> = {}
) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    ...headers,
  });
  res.end(body);
};

/** End a local development asset response.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {Buffer} body - Package/module bytes already selected by trusted routing.
 * @param {string} contentType - Authored MIME value.
 * @param {number} [statusCode] - Authored status.
 * @returns {void} Commits bytes without fetching a remote resource.
 */
const sendBuffer = (
  res: ServerResponse,
  body: Buffer,
  contentType: string,
  statusCode = 200
) => {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
};

/** Shared direct-authority classifier; local host classification never authenticates an operator. */
const isLocalHost = localDevHost;

/** Match legacy trusted host-routing patterns, independently from authentication.
 * @param {string} pattern - Host-configured exact/wildcard rule.
 * @param {string} host - Parsed direct request hostname.
 * @returns {boolean} Whether the implemented legacy routing rule matches.
 */
const matchWildcard = (pattern: string, host: string) => {
  /** Lowercase trusted host pattern used for legacy routing comparisons. */
  const p = pattern.toLowerCase();
  /** Lowercase parsed direct hostname; forwarding headers never select this value. */
  const h = host.toLowerCase();
  if (p === '*') {
    return true;
  }
  if (p === h) {
    return true;
  }
  if (p.startsWith('*.')) {
    /** Wildcard suffix accepted with an explicit dot boundary. */
    const domain = p.slice(2);
    return h === domain || h.endsWith(`.${domain}`);
  }
  return false;
};

/** Borrowed bounded request reader retaining native listener cleanup and one-MiB default. */
const readRequestBody = readLimitedBody;

/** Decode the bounded legacy body without executing it.
 * @param {Buffer} body - Bytes accepted by the request reader.
 * @returns {Record<string, unknown>} Parsed legacy value or empty object on JSON failure; endpoint-specific validation remains required.
 */
const toJsonBody = (body: Buffer) => {
  try {
    return JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Resolve the first nonempty path segment to an explicit legacy registration.
 * @param {string} pathname - Parsed request pathname.
 * @returns {object | null} Registered app and remaining path, or null.
 */
const getAppFromPath = (pathname: string) => {
  /** Nonempty path segments; the length guard proves the first lookup exists. */
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  /** Application record selected only from explicit private registrations. */
  const app = getRegistryApp(segments[0]!);
  if (!app) {
    return null;
  }

  return {
    app,
    remainingPath: `/${segments.slice(1).join('/')}`.replace(/\/+$/, '') || '/',
  };
};

/** Invoke the current trusted host broadcaster with a timestamped envelope.
 * @param {string} appName - Registered application namespace.
 * @param {SharedDevEvent} event - Already-approved event data.
 * @returns {void} Dispatches only when a broadcaster is registered; no delivery persistence is implied.
 */
const broadcastEvent = (appName: string, event: SharedDevEvent) => {
  sharedDevEventBroadcaster?.(appName, {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
};

/** Route the legacy shared development server; host routing is separate from authenticated optional module endpoints.
 * @param {IncomingMessage} req - Native incoming request.
 * @param {ServerResponse} res - Borrowed response committed by one matched route.
 * @returns {Promise<void>} Route handling settlement; the server boundary sanitizes uncaught failures.
 */
const handleHttpRequest = async (req: IncomingMessage, res: ServerResponse) => {
  /** Direct request Host authority; forwarded headers do not grant routing or identity. */
  const host = req.headers.host || '';
  let requestHostname = '';
  try {
    requestHostname = new URL(`http://${host}`).hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase();
  } catch {
    sendJson(res, { error: 'Invalid Host' }, 400);
    return;
  }
  if (isLocalHost(host)) {
    // Localhost/127.0.0.1 is always allowed for devtools server
  } else {
    // For Shared Dev Server, we need to check if the app being requested allows this host
    /** Request URL parsed against a fixed internal base, never an untrusted forwarded origin. */
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    /** Private registered application/path match, or no registered application. */
    const resolved = getAppFromPath(url.pathname);
    if (resolved) {
      /** Registered application selected before applying its explicit host-routing policy. */
      const { app } = resolved;
      let allowed = false;

      if (
        app.allowedDevDomain &&
        matchWildcard(app.allowedDevDomain, requestHostname)
      ) {
        allowed = true;
      } else {
        /** Explicit legacy app host patterns; these are not authentication credentials. */
        const domains = Array.isArray(app.allowedDomains)
          ? app.allowedDomains
          : [app.allowedDomains];
        for (const pattern of domains) {
          if (pattern && matchWildcard(pattern, requestHostname)) {
            allowed = true;
            break;
          }
        }
      }

      if (!allowed) {
        console.error(
          `[Dev] Blocked unallowed host access to devtools: ${JSON.stringify(host)} (App: ${JSON.stringify(app.appName)})`
        );
        sendJson(
          res,
          {
            error: 'Unallowed Host',
            message: `Host ${host} is not allowed to access devtools for ${app.appName}.`,
          },
          403
        );
        return;
      }
    }
  }

  /** Request URL parsed against a fixed internal base, never an untrusted forwarded origin. */
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  /** Parsed request pathname used for fixed endpoint matching. */
  const pathname = url.pathname;

  if (
    pathname === '/favicon.ico' ||
    pathname.match(/^\/__[^/]+\/assets\/favicon\.ico$/)
  ) {
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = readDevAsset('favicon.ico');
    if (asset) {
      sendBuffer(res, asset, 'image/x-icon');
      return;
    }
  }

  if (
    pathname === '/favicon.png' ||
    pathname.match(/^\/__[^/]+\/assets\/favicon\.png$/)
  ) {
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = readDevAsset('favicon.png');
    if (asset) {
      sendBuffer(res, asset, 'image/png');
      return;
    }
  }

  if (
    pathname === '/robots.txt' ||
    pathname.match(/^\/__[^/]+\/assets\/robots\.txt$/)
  ) {
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = readDevAsset('robots.txt');
    if (asset) {
      sendBuffer(res, asset, 'text/plain');
      return;
    }
  }

  /** Anchored asset regex proving the required fixed asset-name capture exists. */
  const globalAssetMatch = pathname.match(
    /^\/__([^/]+)\/assets\/(style\.css|app\.js)$/
  );
  if (globalAssetMatch) {
    /** Required anchored captures; only the declared style/app asset names can enter this branch. */
    const [, , assetName] = globalAssetMatch as [string, string, string];
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = readDevAsset(assetName);
    if (!asset) {
      sendJson(res, { message: 'Asset not found' }, 404);
      return;
    }
    sendBuffer(
      res,
      asset,
      assetName === 'style.css'
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8'
    );
    return;
  }

  if (pathname === '/' || pathname === '/zdev' || pathname === '/zdev/') {
    if (!isLocalHost(host)) {
      // Root dashboard only accessible if at least one app allows this host
      /** Private registered apps consulted for legacy hub host-routing admission. */
      const apps = readRegistry().apps;
      let hostAllowed = false;
      for (const app of apps) {
        /** Explicit legacy app host patterns; these are not authentication credentials. */
        const domains = Array.isArray(app.allowedDomains)
          ? app.allowedDomains
          : [app.allowedDomains];
        if (
          (app.allowedDevDomain &&
            matchWildcard(app.allowedDevDomain, requestHostname)) ||
          domains.some((d) => d && matchWildcard(d, requestHostname))
        ) {
          hostAllowed = true;
          break;
        }
      }
      if (!hostAllowed) {
        console.error(
          `[Dev] Blocked unallowed host access to root dashboard: ${JSON.stringify(host)}`
        );
        sendJson(
          res,
          {
            error: 'Unallowed Host',
            message: `Host ${host} is not allowed to access the devtools dashboard.`,
          },
          403
        );
        return;
      }
    }
    /** Fresh response document policy and nonce from explicit development/production mode. */
    const security = createDevtoolsDocumentPolicy({
      mode:
        process.env.NODE_ENV === 'production' ? 'production' : 'development',
    });
    /** Trusted authored page renderer receiving only this response-owned nonce. */
    const page = await renderHomePage(readRegistry().apps);
    sendHtml(res, page(security.nonce), 200, security.headers);
    return;
  }

  /** Anchored internal publisher route; direct peer loopback is checked before parsing events. */
  const globalEventsMatch = pathname.match(/^\/__([^/]+)\/events$/);
  if (globalEventsMatch && req.method === 'POST') {
    // This internal publisher is used by the framework over loopback. A
    // remote client must not be able to forge lifecycle/update events.
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress || ''
      )
    ) {
      sendJson(res, { message: 'Local publisher required' }, 403);
      return;
    }
    /** Bounded decoded internal publisher payload checked for its required app/type labels. */
    const body = toJsonBody(await readRequestBody(req));
    if (typeof body.app !== 'string' || typeof body.type !== 'string') {
      sendJson(res, { message: 'Missing app name' }, 400);
      return;
    }

    if (
      !getRegistryApp(body.app) ||
      (body.serviceName ?? 'zdev') !== globalEventsMatch[1]
    ) {
      sendJson(res, { message: 'Unknown app or service' }, 404);
      return;
    }
    broadcastEvent(body.app, body as unknown as SharedDevEvent);
    sendJson(res, { ok: true });
    return;
  }

  /** Private registered application/path match, or no registered application. */
  const resolved = getAppFromPath(pathname);
  if (!resolved) {
    sendJson(res, { message: 'Application not found' }, 404);
    return;
  }

  /** Registered application and its relative path selected before service dispatch. */
  const { app, remainingPath } = resolved;
  /** Opaque pairing label used only to filter client event views, never authenticate access. */
  const identifier = url.searchParams.get('identifier');
  /** Bounded normalized private development state borrowed for this request. */
  const snapshot = normalizeSnapshot(app, { identifier });

  if (remainingPath === `/__${app.serviceName}/state` && req.method === 'GET') {
    sendJson(res, snapshot);
    return;
  }

  if (
    remainingPath === `/__${app.serviceName}/api/bootstrap` &&
    req.method === 'GET'
  ) {
    sendJson(res, {
      snapshot: {
        updatedAt: snapshot.updatedAt,
        routes: snapshot.routes,
        clientEvents: snapshot.clientEvents,
        logs: snapshot.logs,
        reload: snapshot.reload,
      },
      identifier,
    });
    return;
  }

  /** Anchored module style/script route proving all required captures are present. */
  const moduleAssetMatch = remainingPath.match(
    /^\/__([^/]+)\/modules\/([^/]+)\/(style\.css|client\.js)$/
  );
  if (moduleAssetMatch && req.method === 'GET') {
    /** Required anchored route captures checked against the registered service before asset lookup. */
    const [, serviceName, moduleId, assetName] = moduleAssetMatch as [
      string,
      string,
      string,
      string,
    ];
    if (serviceName !== app.serviceName) {
      sendJson(res, { message: 'Service mismatch' }, 403);
      return;
    }
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = await readModuleAsset(
      app,
      snapshot,
      moduleId,
      assetName === 'style.css' ? 'style' : 'script'
    );
    if (!asset) {
      sendJson(res, { message: 'Module asset not found' }, 404);
      return;
    }

    sendBuffer(
      res,
      asset,
      assetName === 'style.css'
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8'
    );
    return;
  }

  /** Anchored module public path route; canonical file containment is enforced by its reader. */
  const modulePublicMatch = remainingPath.match(
    /^\/__([^/]+)\/modules\/([^/]+)\/public\/(.+)$/
  );
  if (modulePublicMatch && req.method === 'GET') {
    /** Required service/module/public-path captures; no raw filesystem path is trusted. */
    const [, serviceName, moduleId, assetPath] = modulePublicMatch as [
      string,
      string,
      string,
      string,
    ];
    if (serviceName !== app.serviceName) {
      sendJson(res, { message: 'Service mismatch' }, 403);
      return;
    }
    /** Package/module bytes selected only after the relevant explicit path boundary. */
    const asset = await readModulePublicAsset(
      app,
      snapshot,
      moduleId,
      assetPath
    );
    if (!asset) {
      sendJson(res, { message: 'Asset not found' }, 404);
      return;
    }

    /** Validated local asset suffix used only for the fixed response MIME table. */
    const ext = path.extname(assetPath).toLowerCase();
    /** Fixed local asset MIME mapping with an octet-stream fallback. */
    const mimes: Record<string, string> = {
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
    };
    sendBuffer(res, asset, mimes[ext] || 'application/octet-stream');
    return;
  }

  /** Anchored legacy module API route proving required handler-name captures exist. */
  const moduleApiMatch = remainingPath.match(
    /^\/__([^/]+)\/modules\/([^/]+)\/api\/([^/]+)$/
  );
  if (moduleApiMatch) {
    /** Required service/module/handler captures checked before trusted callback lookup. */
    const [, serviceName, moduleId, handlerName] = moduleApiMatch as [
      string,
      string,
      string,
      string,
    ];
    if (serviceName !== app.serviceName) {
      sendJson(res, { message: 'Service mismatch' }, 403);
      return;
    }
    /** Empty GET/HEAD input or bounded decoded body requiring receiver-specific validation. */
    const requestBody =
      req.method === 'GET' || req.method === 'HEAD'
        ? {}
        : toJsonBody(await readRequestBody(req));
    /** Declared legacy sharing label; optional authenticated module hosts use separate verified contexts. */
    const requesterModuleId = url.searchParams.get('requester');
    /** Trusted callback outcome serialized only after its selected dispatch finishes. */
    const result = await resolveModuleApiRequest({
      app,
      snapshot,
      moduleId,
      handlerName,
      request: req,
      body: requestBody,
      identifier,
      requesterModuleId,
    });

    if (result === null) {
      sendJson(res, { message: 'Module API handler not found' }, 404);
      return;
    }

    sendJson(res, result);
    return;
  }

  if (remainingPath.startsWith(`/__${app.serviceName}/api/`)) {
    /** Explicit legacy API key sliced after the registered service prefix. */
    const apiName = remainingPath.slice(`/__${app.serviceName}/api/`.length);
    /** Borrowed callback found only in the explicit process-wide API registry. */
    const handler = resolveCustomApiHandler(apiName);
    if (!handler) {
      sendJson(res, { message: 'API handler not found' }, 404);
      return;
    }
    sendJson(res, await handler({ req, app, snapshot, identifier }));
    return;
  }

  if (
    remainingPath === `/__${app.serviceName}/client-event` &&
    req.method === 'POST'
  ) {
    /** Bounded decoded client event; callers must keep private data out of this legacy path. */
    const payload = toJsonBody(await readRequestBody(req));
    appendSnapshotEvent(app.dataFilePath, payload);
    broadcastEvent(app.routeName, {
      app: app.routeName,
      type: 'client-event',
      payload,
    });
    sendJson(res, { ok: true });
    return;
  }

  /** Whether the remaining path belongs to the reserved service namespace. */
  const isAsset = remainingPath.startsWith(`/__${app.serviceName}/`);
  if (!isAsset && req.method === 'GET') {
    /** Fresh response document policy and nonce from explicit development/production mode. */
    const security = createDevtoolsDocumentPolicy({
      mode:
        process.env.NODE_ENV === 'production' ? 'production' : 'development',
      frameAncestors: app.devtools.frameAncestors,
    });
    /** Requested authored section identifier, with the existing default when absent. */
    const sectionId = remainingPath.replace(/^\//, '') || null;
    /** Trusted authored page renderer receiving only this response-owned nonce. */
    const page = await renderApplicationPage(
      app,
      snapshot,
      identifier,
      sectionId
    );
    sendHtml(res, page(security.nonce), 200, security.headers);
    return;
  }

  sendJson(res, { message: 'Route not found' }, 404);
};

/** Ensure the process-shared legacy listener exists without taking ownership of another recorded process.
 * @param {number} [preferredPort] - Initial trusted port preference.
 * @returns {Promise<SharedDevServerHandle | null>} Existing/new process-owned listener, or null when another live recorded owner occupies the port.
 */
export const ensureSharedDevServer = async (preferredPort?: number) => {
  if (sharedServerHandle) {
    return sharedServerHandle;
  }

  /** Current private legacy registry snapshot; atomic file replacement is not distributed locking. */
  const registry = readRegistry();

  /** Selected registry port or released probe result; native listen remains authoritative. */
  const port = registry.port ?? (await findPort(preferredPort ?? 9000));

  /** Port-probe result used with the separate legacy process-liveness hint. */
  const portFree = await isPortFree(port);

  /** Signal-zero liveness hint only; it does not authenticate a process identity. */
  const liveOwner = registry.serverPid
    ? (() => {
        try {
          process.kill(registry.serverPid, 0);
          return true;
        } catch {
          return false;
        }
      })()
    : false;

  if (!portFree && liveOwner && registry.serverPid !== process.pid) {
    return null;
  }

  /** Process-owned shared HTTP listener; closeSharedDevServer owns its native close. */
  const server = http.createServer((req, res) => {
    void handleHttpRequest(req, res).catch((error: unknown) => {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      /** Fixed sanitized body-limit/internal-error classification without private transport causes. */
      const status =
        (error as { statusCode?: number })?.statusCode === 413 ? 413 : 500;
      sendJson(
        res,
        {
          error: status === 413 ? 'Payload Too Large' : 'Internal Server Error',
        },
        status
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Devtools are private by default. Public access requires deliberate opt-in
    // together with an upstream authentication/access-control policy.
    server.listen(port, process.env.ZDEV_BIND_HOST || '127.0.0.1', () =>
      resolve()
    );
  });

  writeRegistry({
    ...registry,
    port,
    serverPid: process.pid,
  });

  sharedServerHandle = { port, server };

  server.on('close', () => {
    /** Fresh registry snapshot read when the native shared listener closes. */
    const currentRegistry = readRegistry();

    if (currentRegistry.serverPid === process.pid) {
      writeRegistry({
        ...currentRegistry,
        serverPid: undefined,
      });
    }

    sharedServerHandle = null;
  });

  return sharedServerHandle;
};

/** Request orderly close of the process-owned shared native listener.
 * @returns {Promise<void>} Native server close settlement; it does not close another process or force-cancel arbitrary handlers.
 */
export const closeSharedDevServer = async () => {
  if (!sharedServerHandle) {
    return;
  }

  /** Owned listener captured before clearing the process-global shared handle. */
  const current = sharedServerHandle;
  sharedServerHandle = null;
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
};

/** Best-effort publish to the fixed loopback development event route.
 * @param {number} port - Explicit shared listener port.
 * @param {SharedDevEvent} event - Host-approved redacted envelope.
 * @returns {Promise<void>} Request end/error settlement with a three-second socket timeout; no durable delivery acknowledgement.
 */
export const publishSharedDevEvent = async (
  port: number,
  event: SharedDevEvent
) => {
  /** Exact approved event JSON bytes counted for the native request content length. */
  const payload = JSON.stringify({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });

  await new Promise<void>((resolve) => {
    /** Owned native loopback publisher request completed or destroyed by its timeout. */
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/__${event.serviceName || 'zdev'}/events`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload, 'utf8'),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve());
      }
    );

    request.on('error', () => resolve());
    request.setTimeout(3000, () =>
      request.destroy(new Error('Devtools event timeout'))
    );
    request.write(payload);
    request.end();
  });
};

/** Replace the trusted process-wide event broadcaster callback.
 * @param {((appName: string, event: SharedDevEvent) => void) | null} broadcaster - Host callback or null to detach it.
 * @returns {void} Replaces only the callback; its external resources remain host-owned.
 */
export const setSharedDevEventBroadcaster = (
  broadcaster: ((appName: string, event: SharedDevEvent) => void) | null
) => {
  sharedDevEventBroadcaster = broadcaster;
};

/** Resolve a legacy socket callback for an explicitly registered app.
 * @param {object} options - Host-selected app/module/channel and receiver-validated payload labels.
 * @param {string} options.appName - Explicit registered application namespace.
 * @param {string} options.moduleId - Configured target module identity.
 * @param {string} options.channel - Exact registered channel callback key.
 * @param {Record<string, unknown>} [options.payload] - Receiver-validated input.
 * @param {string | null} [options.identifier] - Pairing label, not authentication.
 * @param {string} [options.clientType] - Declared development client kind.
 * @param {string | null} [options.requesterModuleId] - Legacy sharing label.
 * @returns {Promise<unknown>} Trusted callback result or null; module labels are not authenticated principals.
 */
export const resolveSharedDevModuleSocketRequest = async (options: {
  /** Registered application namespace selected by the socket host. */
  appName: string;
  /** Explicit configured module identity. */
  moduleId: string;
  /** Exact trusted socket callback key. */
  channel: string;
  /** Untrusted input requiring the receiving callback to validate it. */
  payload?: Record<string, unknown>;
  /** Optional pairing label, never sufficient authorization. */
  identifier?: string | null;
  /** Declared client kind, not a verified role. */
  clientType?: string;
  /** Legacy requester-module sharing label, independent of authentication. */
  requesterModuleId?: string | null;
}) => {
  /** Application record selected only from explicit private registrations. */
  const app = getRegistryApp(options.appName);
  if (!app) {
    return null;
  }

  /** Bounded normalized private development state borrowed for this request. */
  const snapshot = normalizeSnapshot(app, { identifier: options.identifier });
  return resolveModuleSocketRequest({
    app,
    snapshot,
    moduleId: options.moduleId,
    channel: options.channel,
    payload: options.payload,
    identifier: options.identifier,
    clientType: options.clientType,
    requesterModuleId: options.requesterModuleId,
  });
};

export {
  getRegistryApp,
  readSharedDevRouteName,
  registerSharedDevApp,
  unregisterSharedDevApp,
};
