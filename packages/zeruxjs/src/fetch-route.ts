import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ZeruxPluginApi,
  ZeruxRequestContext,
  RouteHandler,
} from './bootstrap/types.js';

export type FetchRouteHandler = (
  request: Request,
  context: ZeruxRequestContext
) => Response | Promise<Response>;
export interface FetchRouteRegistration {
  /** Preferred explicit absolute route path. */
  pattern?: string;
  /** Compatibility absolute route path when pattern is omitted. */
  path?: string;
  /** Trusted Fetch endpoint implementation; not a remotely supplied executable callback. */
  handler: FetchRouteHandler;
  /** Explicit application middleware names retaining existing request authorization. */
  middleware?: string[];
}

/** Hop-by-hop headers excluded when adapting a Fetch response to the existing Node transport. */
const SKIP_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

/** Stream one Fetch response through the native pipeline, preserving statuses and eligible headers while draining cancellation.
 * @param {IncomingMessage} req - Borrowed native request; HEAD discards the producer body.
 * @param {ServerResponse} res - Borrowed native response owning backpressure/close.
 * @param {Response} response - Explicit handler-produced Fetch response.
 * @returns {Promise<void>} Pipeline settlement; unexpected producer failures remain visible.
 */
export async function sendFetchResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response
): Promise<void> {
  if (!(response instanceof Response)) {
    throw new TypeError('Fetch route must return a Response');
  }
  if (res.writableEnded || res.destroyed) {
    await response.body?.cancel();
    return;
  }
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }
  if (
    !response.body ||
    req.method === 'HEAD' ||
    response.status === 204 ||
    response.status === 304
  ) {
    await response.body?.cancel();
    res.end();
    return;
  }
  /** Per-send native pipeline cancellation for an aborted incoming request. */
  const controller = new AbortController();
  /** Signal the owned pipeline on incoming upload abort.
   * @returns {void} Cooperative pipeline cancellation request.
   */
  const abort = () => controller.abort();
  // pipeline owns destination close/cancellation. A second close observer is
  // redundant and exceeds response listener budgets when tracing and lifecycle
  // ownership are enabled together. Incoming upload abort remains independent.
  req.once('aborted', abort);
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream
      ),
      res,
      { signal: controller.signal }
    );
  } catch (error) {
    /** Known native destination-close failure, distinct from an unreported producer error. */
    const disconnected =
      res.destroyed &&
      error instanceof Error &&
      'code' in error &&
      ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE'].includes(
        String(error.code)
      );
    if (!controller.signal.aborted && !disconnected) {
      throw error;
    }
  } finally {
    req.off('aborted', abort);
  }
}

/** Adapt an explicitly supplied Fetch handler without buffering its request/response streams or granting authorization.
 * @param {FetchRouteHandler} handler - Trusted application handler; host middleware owns authentication and tenant policy.
 * @returns {RouteHandler} Framework route handler over the existing request context.
 */
export function createFetchRoute(handler: FetchRouteHandler): RouteHandler {
  return async (context) => {
    /** Borrowed native request whose stream can transfer into the Fetch upload body. */
    const req = context.req;
    // Use a neutral origin; app routing is based on the already-parsed request path.
    /** Neutral internal origin with the already parsed application path/query; never trust Host for authority. */
    const url = new URL(
      context.url.pathname + context.url.search,
      'http://localhost'
    );
    /** Fetch-compatible inbound headers excluding Host and invalid values. */
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === 'host' || value === undefined) {
        continue;
      }
      /** Declared repeated native-header values joined without creating an outbound destination. */
      const joined = Array.isArray(value) ? value.join(', ') : value;
      try {
        headers.set(key, joined);
      } catch {
        /* invalid inbound header cannot enter Fetch API */
      }
    }
    /** Existing framework method used to preserve GET/HEAD body semantics. */
    const method = context.method;
    /** Whether the Fetch request is allowed to own a native upload stream. */
    const streamingUpload = method !== 'GET' && method !== 'HEAD';
    /** Explicit Fetch request options; duplex half is set only for streaming upload methods. */
    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (streamingUpload) {
      init.body = Readable.toWeb(req) as ReadableStream;
      init.duplex = 'half';
    }
    /** Fetch request over the borrowed native upload; application code still owns authorization. */
    const request = new Request(url, init);
    /** Application handler’s Fetch response transferred into the Node pipeline. */
    const response = await handler(request, context);
    await sendFetchResponse(req, context.res, response);
  };
}

/** Register explicit Fetch endpoints using the existing framework ALL-method dispatch and streamed-body policy.
 * @param {ZeruxPluginApi} api - Borrowed generation route-registration surface.
 * @param {Iterable<FetchRouteRegistration>} routes - Explicit iterable of host-owned endpoint definitions.
 * @returns {void} Registers routes; it does not add implicit authentication or CSRF checks.
 */
export function registerFetchRoutes(
  api: ZeruxPluginApi,
  routes: Iterable<FetchRouteRegistration>
): void {
  for (const route of routes) {
    /** Explicit registered absolute route path; no arbitrary endpoint discovery occurs. */
    const pattern = route.pattern ?? route.path;
    if (!pattern?.startsWith('/')) {
      throw new TypeError('Fetch routes require absolute paths');
    }
    api.addRoute({
      pattern,
      method: 'ALL',
      handler: createFetchRoute(route.handler),
      middleware: route.middleware,
      meta: { streamBody: true },
    });
  }
}
