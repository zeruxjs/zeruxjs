import { isIP } from 'node:net';
import { sanitizeForwardedRequestHeaders } from '../portless/proxy-headers.js';
import type { TransportLimits } from './lifecycle.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from './mcp/protocol.js';
import { JsonRpcRouter } from './json-rpc.js';
import { ConnectRouter, TrpcRouter } from './connect.js';
import { SseHub } from './sse.js';
import { WebTransportRouter } from './webtransport.js';
import { ConnectStreamRouter, readConnectEnvelopes, encodeConnectEnvelope } from './connect-stream.js';
export interface ProtocolEndpoint { readonly kind:'mcp'|'json-rpc'|'sse'|'connect-json'|'connect-stream-json'|'trpc-json'; readonly path:string }
export interface ProtocolGatewayOptions {
  authorizeEndpoint?:(req:IncomingMessage,endpoint:Readonly<ProtocolEndpoint>,context:{signal:AbortSignal;remoteAddress:string|undefined;trustedProxy:boolean})=>boolean|Promise<boolean>;
  trustedProxies?:readonly string[];
  maxConcurrentRequests?:number;
  requestTimeoutMs?:number;
  onError?:(error:unknown,endpoint:Readonly<ProtocolEndpoint>)=>void;
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
function json(res: ServerResponse, code: number, data: unknown, limit=16*1024*1024): void {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  const body=JSON.stringify(data);if(Buffer.byteLength(body)>(code>=400?Math.max(1024,limit):limit))throw new BodyError(500,'Response too large');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
class BodyError extends Error { constructor(public status: number, message: string) { super(message); } }
async function readJson(req: IncomingMessage, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/(?:json|[^;]+\+json)(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) throw new BodyError(415, 'JSON Content-Type required');
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(String(declared))||BigInt(String(declared))>BigInt(limit)))throw new BodyError(413,'Request body too large');
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let size=0,done=false;
    const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',abort);signal.removeEventListener('abort',abort);};
    const fail=(cause:unknown)=>{if(done)return;done=true;cleanup();reject(cause);};
    const abort=()=>fail(new BodyError(408,'Request cancelled')),error=()=>fail(new BodyError(400,'Request disconnected'));
    const data=(value:Buffer|string)=>{const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);size+=chunk.length;if(size>limit){req.pause();fail(new BodyError(413,'Request body too large'));}else chunks.push(chunk);};
    const end=()=>{if(done)return;done=true;cleanup();try{resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))));}catch{reject(new BodyError(400,'Malformed JSON'));}};
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',abort);signal.addEventListener('abort',abort,{once:true});if(signal.aborted||req.aborted)abort();
  });
}
const invalidRpc = (code: number, message: string) => ({ jsonrpc: '2.0', id: null, error: { code, message } });
/** Application-local protocol dispatch; invoke from ZHOST via ProxyServerOptions.protocols.
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
  private limit: number;
  private concurrency:number;private timeout:number;private closed=false;
  private readonly active=new Set<{cancel():void}>();private readonly pending=new Set<Promise<unknown>>();
  constructor(options: ProtocolGatewayOptions = {}) {
    if(!options||typeof options!=='object'||Array.isArray(options)||options.authorize!==undefined&&typeof options.authorize!=='function'||options.authorizeEndpoint!==undefined&&typeof options.authorizeEndpoint!=='function'||options.onError!==undefined&&typeof options.onError!=='function')throw new TypeError('Invalid gateway options');
    if(options.trustedProxies!==undefined&&(!Array.isArray(options.trustedProxies)||options.trustedProxies.length>64||options.trustedProxies.some(value=>typeof value!=='string'||!isIP(value))))throw new TypeError('Invalid trusted proxy list');
    if(options.allowedOrigins!==undefined&&(!Array.isArray(options.allowedOrigins)||options.allowedOrigins.length>64||options.allowedOrigins.some(value=>{try{return new URL(value).origin!==value;}catch{return true;}})))throw new TypeError('Invalid allowed origins');
    this.concurrency=options.maxConcurrentRequests??32;this.timeout=options.requestTimeoutMs??30000;
    if(!Number.isSafeInteger(this.concurrency)||this.concurrency<1||this.concurrency>1024||!Number.isSafeInteger(this.timeout)||this.timeout<10||this.timeout>120000)throw new RangeError('Invalid gateway limits');
    this.options = {...options,allowedOrigins:options.allowedOrigins?[...options.allowedOrigins]:undefined,trustedProxies:options.trustedProxies?[...options.trustedProxies]:undefined}; this.mcp = options.mcp;
    this.rpc = options.rpc ?? new JsonRpcRouter();
    this.connect = options.connect ?? new ConnectRouter();
    this.connectStream = options.connectStream ?? new ConnectStreamRouter();
    this.trpc = options.trpc ?? new TrpcRouter();
    this.events = options.events ?? new SseHub();
    this.webTransport = options.webTransport ?? new WebTransportRouter();
    this.limit = options.maxBodyBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 16 * 1024 * 1024) throw new RangeError('Invalid protocol request limit');
  }
  /** Tighten a transport-owned gateway before listening; never widen a host's policy. */
  constrain(limits:TransportLimits):void{if(!limits||!Number.isSafeInteger(limits.maxMessageBytes)||limits.maxMessageBytes<1||limits.maxMessageBytes>16*1024*1024||!Number.isSafeInteger(limits.maxConcurrent)||limits.maxConcurrent<1||limits.maxConcurrent>1024||!Number.isSafeInteger(limits.timeoutMs)||limits.timeoutMs<10||limits.timeoutMs>120000)throw new RangeError('Invalid transport limits');if(this.active.size||this.closed)throw new Error('Gateway is active/closed');this.limit=Math.min(this.limit,limits.maxMessageBytes);this.concurrency=Math.min(this.concurrency,limits.maxConcurrent);this.timeout=Math.min(this.timeout,limits.timeoutMs);}
  validateBindings():void{const paths=['/rpc','/events',...(this.mcp?['/mcp']:[]),...this.connect.paths(),...this.connectStream.paths(),...this.trpc.paths()];if(new Set(paths).size!==paths.length)throw new Error('Protocol endpoint bind conflict');}
  getDiagnostics(){return {closed:this.closed,active:this.active.size,pending:this.pending.size};}
  async whenClosed():Promise<void>{await Promise.allSettled([...this.pending]);}
  private send(res:ServerResponse,code:number,data:unknown){json(res,code,data,this.limit);}
  async handle(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
    const path=(req.url??'/').split('?')[0];
    if(!(path==='/mcp'&&this.mcp||path==='/rpc'||path==='/events'||this.connect.has(path)||this.connectStream.has(path)||path.startsWith('/trpc/')&&this.trpc.has(path.slice(6))))return false;
    if(this.closed||this.active.size>=this.concurrency){this.send(res,503,{error:'Protocol unavailable'});return true;}
    const supplied=req.headers['x-zerux-deadline'];
    if(supplied!==undefined&&(typeof supplied!=='string'||!/^\d{1,16}$/.test(supplied)||!Number.isSafeInteger(Number(supplied)))){this.send(res,400,{error:'Invalid request deadline'});return true;}
    const deadline=Math.min(Date.now()+this.timeout,supplied===undefined?Infinity:Number(supplied));
    if(deadline<=Date.now()){this.send(res,408,{error:'Request deadline exceeded'});return true;}
    const controller=new AbortController();let ioDone=false,workDone=false;
    const release=()=>{if(ioDone&&workDone)this.active.delete(lease);};
    const finish=()=>{if(ioDone)return;ioDone=true;controller.abort();res.off('finish',finish);res.off('close',finish);req.off('aborted',finish);release();};
    const lease={cancel:()=>{controller.abort();if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)this.send(res,503,{error:'Protocol unavailable'});else res.end();}}};this.active.add(lease);
    res.once('finish',finish);res.once('close',finish);req.once('aborted',finish);
    const timer=setTimeout(()=>{controller.abort();if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)this.send(res,504,{error:'Protocol deadline exceeded'});else res.destroy();}},Math.max(1,deadline-Date.now()));
    const work=this.execute(req,res,controller.signal,deadline);this.pending.add(work);
    try{return await work;}finally{clearTimeout(timer);workDone=true;this.pending.delete(work);if(res.destroyed||res.writableFinished)finish();release();}
  }
  private async execute(req: IncomingMessage, res: ServerResponse, signal:AbortSignal,deadline:number): Promise<boolean> {
    const rawPath = (req.url ?? '/').split('?')[0];
    const mcp = rawPath === '/mcp' && !!this.mcp;
    const rpc = rawPath === '/rpc';
    const sse = rawPath === '/events';
    const trpc = rawPath.startsWith('/trpc/') && this.trpc.has(rawPath.slice(6));
    const stream = this.connectStream.has(rawPath);
    const connect = this.connect.has(rawPath);
    if (!mcp && !rpc && !sse && !trpc && !connect && !stream) return false;
    const endpoint:Readonly<ProtocolEndpoint>=Object.freeze({path:rawPath,kind:mcp?'mcp':rpc?'json-rpc':sse?'sse':stream?'connect-stream-json':connect?'connect-json':'trpc-json'});
    const trustedProxy=this.options.trustedProxies?.includes(req.socket.remoteAddress??'')===true;
    const context={signal,deadline,remoteAddress:req.socket.remoteAddress,trustedProxy,headers:trustedProxy?{...req.headers}:sanitizeForwardedRequestHeaders(req.headers) as IncomingMessage['headers']};
    const origin = req.headers.origin;
    if (origin) {
      let valid = false;
      try {
        const parsed = new URL(origin);
        valid = parsed.origin===origin && (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          (this.options.allowedOrigins?.includes(parsed.origin) ?? false);
        // Same-origin requests remain allowed, but compare host and origin authority exactly.
        valid ||= parsed.origin===origin && parsed.host === req.headers.host && (((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? parsed.protocol === 'https:' : parsed.protocol === 'http:'));
      } catch { /* reject invalid Origin */ }
      if (!valid) { this.send(res, 403, { error: 'Origin not allowed' }); return true; }
    }
    try {
      // Local reverse proxies may forward untrusted internet traffic over loopback.
      // Require explicit authorization when forwarding metadata is present.
      const proxied = !!(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip']);
      const allowed = this.options.authorize ? await this.options.authorize(req)===true : local(req.socket.remoteAddress) && !proxied;
      const endpointAllowed=allowed&&(!this.options.authorizeEndpoint||await this.options.authorizeEndpoint(req,endpoint,{signal,remoteAddress:context.remoteAddress,trustedProxy})===true);
      if(signal.aborted)throw new BodyError(408,'Request cancelled');
      this.validateBindings();
      if (!endpointAllowed) { this.send(res, 403, { error: 'Forbidden' }); return true; }
      if (sse) {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); this.send(res, 405, { error: 'Method not allowed' }); return true; }
        this.events.subscribe(res, typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : undefined);
        return true;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); this.send(res, 405, { error: 'Method not allowed' }); return true; }
      if (mcp) {
        const accept = String(req.headers.accept ?? '');
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { this.send(res, 406, { error: 'MCP Accept must include application/json and text/event-stream' }); return true; }
        const version = req.headers['mcp-protocol-version'];
        if (version && version !== this.mcp!.protocolVersion) { this.send(res, 400, invalidRpc(-32600, 'Unsupported MCP protocol version')); return true; }
      }
      if (stream) {
        if (!/^application\/connect\+json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) { this.send(res, 415, { error: 'Connect JSON content type required' }); return true; }
        // Must remain streaming end-to-end. Envelopes are bounded independently.
        const output = await this.connectStream.call(rawPath, readConnectEnvelopes(req, { maxMessageBytes: this.limit, maxTotalBytes: Math.min(16 * 1024 * 1024, this.limit * 16), signal }), context);
        res.writeHead(200, { 'Content-Type': 'application/connect+json', 'Cache-Control': 'no-store, no-transform' });
        let outputCount=0,outputBytes=0;
        for await (const message of output) {
          signal.throwIfAborted();
          const frame=encodeConnectEnvelope(message);outputBytes+=frame.length;if(++outputCount>256||frame.length>this.limit+5||outputBytes>16*1024*1024)throw new RangeError('Connect output limit');
          if (res.destroyed || res.writableEnded) break;
          if (!res.write(frame)) await new Promise<void>(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
            res.once('drain', done); res.once('close', done);
          });
        }
        if (!res.destroyed) res.end(encodeConnectEnvelope({}, true));
        return true;
      }
      const body = await readJson(req, this.limit, signal);
      if (mcp) {
        const response = await this.mcp!.handle(body,context);
        if (response === null) { res.writeHead(202); res.end(); }
        else this.send(res, 200, response);
      } else if (rpc) {
        const response = await this.rpc.dispatch(body, context);
        if (response === null) { res.writeHead(204); res.end(); }
        else this.send(res, 200, response);
      } else if (connect) {
        try { this.send(res, 200, await this.connect.call(rawPath, body, context)); }
        catch { this.send(res, 500, { code: 'internal', message: 'Connect procedure failed' }); }
      } else if (trpc) {
        try { this.send(res, 200, { result: { data: await this.trpc.call(rawPath.slice(6), body, context) } }); }
        catch { this.send(res, 500, { error: { message: 'Procedure failed', code: -32603 } }); }
      }
    } catch (err) {
      try{this.options.onError?.(err,endpoint);}catch{/* private diagnostics cannot affect cleanup */}
      const status = err instanceof BodyError ? err.status : 500;
      this.send(res, status, mcp || rpc ? invalidRpc(status === 400 ? -32700 : -32600, status === 500 ? 'Internal error' : err instanceof Error ? err.message : 'Invalid request') : { error: status === 500 ? 'Internal error' : err instanceof Error ? err.message : 'Invalid request' });
      if (!req.complete) req.resume();
    }
    return true;
  }
  close(): void { if(this.closed)return;this.closed=true;this.events.close();for(const lease of this.active)lease.cancel(); }
}
export function createProtocolGateway(options?: ProtocolGatewayOptions) { return new ProtocolGateway(options); }
