import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from './mcp/protocol.js';
import { JsonRpcRouter } from './json-rpc.js';
import { ConnectRouter, TrpcRouter } from './connect.js';
import { SseHub } from './sse.js';
import { WebTransportRouter } from './webtransport.js';
import { ConnectStreamRouter, readConnectEnvelopes, encodeConnectEnvelope } from './connect-stream.js';
export interface ProtocolGatewayOptions {
  /** MCP handler (registered before listen) or attached later using .mcp. */
  mcp?: McpServer;
  rpc?: JsonRpcRouter;
  connect?: ConnectRouter;
  connectStream?: ConnectStreamRouter;
  trpc?: TrpcRouter;
  events?: SseHub;
  webTransport?: WebTransportRouter;
  /** Defaults to localhost only. External requests require authorization callback. */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
  maxBodyBytes?: number;
  /** Explicit allowed browser origins. Browser origins not in this list are rejected. */
  allowedOrigins?: string[];
}
function local(address: string | undefined): boolean { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function json(res: ServerResponse, code: number, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
class BodyError extends Error { constructor(public status: number, message: string) { super(message); } }
async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/(?:json|[^;]+\+json)(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) throw new BodyError(415, 'JSON Content-Type required');
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || BigInt(String(declared)) > BigInt(limit))) throw new BodyError(413, 'Request body too large');
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const part: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > limit) throw new BodyError(413, 'Request body too large');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new BodyError(400, 'Malformed JSON'); }
}
const invalidRpc = (code: number, message: string) => ({ jsonrpc: '2.0', id: null, error: { code, message } });
/** Application-local protocol dispatch; invoke from ZSRV via ProxyServerOptions.protocols.
 * A gateway never handles unregistered paths, allowing normal HTTP/WebSocket proxying. */
export class ProtocolGateway {
  mcp?: McpServer;
  readonly rpc: JsonRpcRouter;
  readonly connect: ConnectRouter;
  readonly connectStream: ConnectStreamRouter;
  readonly trpc: TrpcRouter;
  readonly events: SseHub;
  readonly webTransport: WebTransportRouter;
  private readonly options: ProtocolGatewayOptions;
  private readonly limit: number;
  constructor(options: ProtocolGatewayOptions = {}) {
    this.options = options; this.mcp = options.mcp;
    this.rpc = options.rpc ?? new JsonRpcRouter();
    this.connect = options.connect ?? new ConnectRouter();
    this.connectStream = options.connectStream ?? new ConnectStreamRouter();
    this.trpc = options.trpc ?? new TrpcRouter();
    this.events = options.events ?? new SseHub();
    this.webTransport = options.webTransport ?? new WebTransportRouter();
    this.limit = options.maxBodyBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 16 * 1024 * 1024) throw new RangeError('Invalid protocol request limit');
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const rawPath = (req.url ?? '/').split('?')[0];
    const mcp = rawPath === '/mcp' && !!this.mcp;
    const rpc = rawPath === '/rpc';
    const sse = rawPath === '/events';
    const trpc = rawPath.startsWith('/trpc/') && this.trpc.has(rawPath.slice(6));
    const stream = this.connectStream.has(rawPath);
    const connect = this.connect.has(rawPath);
    if (!mcp && !rpc && !sse && !trpc && !connect && !stream) return false;
    const origin = req.headers.origin;
    if (origin) {
      let valid = false;
      try {
        const parsed = new URL(origin);
        valid = (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          (this.options.allowedOrigins?.includes(parsed.origin) ?? false);
        // Same-origin requests remain allowed, but compare host and origin authority exactly.
        valid ||= parsed.host === req.headers.host && (((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? parsed.protocol === 'https:' : parsed.protocol === 'http:'));
      } catch { /* reject invalid Origin */ }
      if (!valid) { json(res, 403, { error: 'Origin not allowed' }); return true; }
    }
    try {
      // Local reverse proxies may forward untrusted internet traffic over loopback.
      // Require explicit authorization when forwarding metadata is present.
      const proxied = !!(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip']);
      const allowed = this.options.authorize ? await this.options.authorize(req) : local(req.socket.remoteAddress) && !proxied;
      if (!allowed) { json(res, 403, { error: 'Forbidden' }); return true; }
      if (sse) {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { error: 'Method not allowed' }); return true; }
        this.events.subscribe(res, typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : undefined);
        return true;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'Method not allowed' }); return true; }
      if (mcp) {
        const accept = String(req.headers.accept ?? '');
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { json(res, 406, { error: 'MCP Accept must include application/json and text/event-stream' }); return true; }
        const version = req.headers['mcp-protocol-version'];
        if (version && version !== this.mcp!.protocolVersion) { json(res, 400, invalidRpc(-32600, 'Unsupported MCP protocol version')); return true; }
      }
      if (stream) {
        if (!/^application\/connect\+json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) { json(res, 415, { error: 'Connect JSON content type required' }); return true; }
        // Must remain streaming end-to-end. Envelopes are bounded independently.
        const output = await this.connectStream.call(rawPath, readConnectEnvelopes(req, { maxMessageBytes: this.limit, maxTotalBytes: Math.min(16 * 1024 * 1024, this.limit * 16) }), { headers: req.headers });
        res.writeHead(200, { 'Content-Type': 'application/connect+json', 'Cache-Control': 'no-store, no-transform' });
        for await (const message of output) {
          if (res.destroyed || res.writableEnded) break;
          if (!res.write(encodeConnectEnvelope(message))) await new Promise<void>(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
            res.once('drain', done); res.once('close', done);
          });
        }
        if (!res.destroyed) res.end(encodeConnectEnvelope({}, true));
        return true;
      }
      const body = await readJson(req, this.limit);
      if (mcp) {
        const response = await this.mcp!.handle(body);
        if (response === null) { res.writeHead(202); res.end(); }
        else json(res, 200, response);
      } else if (rpc) {
        const response = await this.rpc.dispatch(body, { headers: req.headers });
        if (response === null) { res.writeHead(204); res.end(); }
        else json(res, 200, response);
      } else if (connect) {
        try { json(res, 200, await this.connect.call(rawPath, body, { headers: req.headers })); }
        catch { json(res, 500, { code: 'internal', message: 'Connect procedure failed' }); }
      } else if (trpc) {
        try { json(res, 200, { result: { data: await this.trpc.call(rawPath.slice(6), body, { headers: req.headers }) } }); }
        catch { json(res, 500, { error: { message: 'Procedure failed', code: -32603 } }); }
      }
    } catch (err) {
      const status = err instanceof BodyError ? err.status : 500;
      json(res, status, mcp || rpc ? invalidRpc(status === 400 ? -32700 : -32600, status === 500 ? 'Internal error' : err instanceof Error ? err.message : 'Invalid request') : { error: status === 500 ? 'Internal error' : err instanceof Error ? err.message : 'Invalid request' });
      if (!req.complete) req.resume();
    }
    return true;
  }
  close(): void { this.events.close(); }
}
export function createProtocolGateway(options?: ProtocolGatewayOptions) { return new ProtocolGateway(options); }
