import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZeruxPluginApi, ZeruxRequestContext, RouteHandler } from './bootstrap/types.js';

export type FetchRouteHandler = (request: Request, context: ZeruxRequestContext) => Response | Promise<Response>;
export interface FetchRouteRegistration { pattern?: string; path?: string; handler: FetchRouteHandler; middleware?: string[] }

const SKIP_HEADERS = new Set(['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']);

/** Streams a Fetch Response to Node's ServerResponse; preserves headers, status, backpressure and cancellation. */
export async function sendFetchResponse(req: IncomingMessage, res: ServerResponse, response: Response): Promise<void> {
  if (!(response instanceof Response)) throw new TypeError('Fetch route must return a Response');
  if (res.writableEnded || res.destroyed) { await response.body?.cancel(); return; }
  res.statusCode = response.status;
  for (const [key, value] of response.headers) if (!SKIP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  if (!response.body || req.method === 'HEAD' || response.status === 204 || response.status === 304) {
    await response.body?.cancel();
    res.end();
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  // IncomingMessage close may also fire when the complete request body was received;
  // ServerResponse close is the connection-loss signal during outbound streaming.
  res.once('close', abort);
  req.once('aborted', abort);
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),res,{signal:controller.signal});
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    res.off('close', abort);
    req.off('aborted', abort);
  }
}

/** Wrap Fetch-style route code without buffering potentially streaming responses. */
export function createFetchRoute(handler: FetchRouteHandler): RouteHandler {
  return async context => {
    const req = context.req;
    // Use a neutral origin; app routing is based on the already-parsed request path.
    const url = new URL(context.url.pathname + context.url.search, 'http://localhost');
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === 'host' || value === undefined) continue;
      const joined = Array.isArray(value) ? value.join(', ') : value;
      try { headers.set(key, joined); } catch { /* invalid inbound header cannot enter Fetch API */ }
    }
    const method = context.method;
    const streamingUpload = method !== 'GET' && method !== 'HEAD';
    const init: RequestInit & {duplex?:'half'} = {method, headers};
    if (streamingUpload) {
      init.body = Readable.toWeb(req) as ReadableStream;
      init.duplex = 'half';
    }
    const request = new Request(url, init);
    const response = await handler(request, context);
    await sendFetchResponse(req, context.res, response);
  };
}

/** Registers Fetch handlers as GET/HEAD-compatible application routes. */
export function registerFetchRoutes(api: ZeruxPluginApi, routes: Iterable<FetchRouteRegistration>): void {
  for (const route of routes) {
    const pattern = route.pattern ?? route.path;
    if (!pattern?.startsWith('/')) throw new TypeError('Fetch routes require absolute paths');
    api.addRoute({ pattern, method: 'ALL', handler: createFetchRoute(route.handler), middleware: route.middleware, meta: {streamBody: true} });
  }
}
