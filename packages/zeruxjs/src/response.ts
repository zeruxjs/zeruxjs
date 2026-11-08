/** Response controls for ZeruxJS handlers. No global mutable response configuration. */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export interface ResponseCachePolicy {
  /** Defaults to private; public requires an explicit opt-in. */
  visibility?: 'public' | 'private' | 'no-store';
  maxAge?: number;
  sharedMaxAge?: number;
  staleWhileRevalidate?: number;
  immutable?: boolean;
  mustRevalidate?: boolean;
  vary?: string[];
  /** Generate a content-derived strong ETag for non-streaming bodies. */
  etag?: boolean;
}
export interface ResponseStreamOptions {
  status?: number;
  headers?: Record<string, string>;
  /** Streaming responses are never implicitly cacheable. */
  contentType?: string;
  maxBytes?: number;
}
const streamMarker = Symbol('zerux.stream');
const cacheMarker = Symbol('zerux.cached');
export interface StreamResult { readonly [streamMarker]: true; readonly source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string> | Readable; readonly options: ResponseStreamOptions }
export interface CachedResult { readonly [cacheMarker]: true; readonly value: unknown; readonly policy: ResponseCachePolicy }

function seconds(value: number | undefined, field: string): string | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 31_536_000) throw new RangeError(`Invalid ${field}`);
  return String(value);
}
export function cacheControl(policy: ResponseCachePolicy = {}): string {
  const visibility = policy.visibility ?? 'private';
  if (!['public', 'private', 'no-store'].includes(visibility)) throw new TypeError('Invalid cache visibility');
  if (visibility === 'no-store') return 'no-store';
  const values: string[] = [visibility];
  const maxAge = seconds(policy.maxAge, 'maxAge');
  const sharedMaxAge = seconds(policy.sharedMaxAge, 'sharedMaxAge');
  const stale = seconds(policy.staleWhileRevalidate, 'staleWhileRevalidate');
  if (maxAge !== null) values.push(`max-age=${maxAge}`);
  if (sharedMaxAge !== null && visibility === 'public') values.push(`s-maxage=${sharedMaxAge}`);
  if (stale !== null) values.push(`stale-while-revalidate=${stale}`);
  if (policy.immutable) values.push('immutable');
  if (policy.mustRevalidate) values.push('must-revalidate');
  return values.join(', ');
}
export function applyCachePolicy(res: ServerResponse, policy: ResponseCachePolicy): void {
  if (res.headersSent) throw new Error('Response headers already sent');
  res.setHeader('Cache-Control', cacheControl(policy));
  if (policy.vary?.length) {
    const existing = String(res.getHeader('Vary') ?? '').split(',').map(x => x.trim()).filter(Boolean);
    for (const field of policy.vary) {
      if (!/^[a-z\d-]{1,64}$/i.test(field)) throw new TypeError('Invalid Vary field');
      if (!existing.some(x => x.toLowerCase() === field.toLowerCase())) existing.push(field);
    }
    res.setHeader('Vary', existing.join(', '));
  }
}
export function cached(value: unknown, policy: ResponseCachePolicy): CachedResult {
  cacheControl(policy);
  return { [cacheMarker]: true, value, policy };
}
export function isCached(value: unknown): value is CachedResult { return !!value && typeof value === 'object' && cacheMarker in value; }
export function stream(source: StreamResult['source'], options: ResponseStreamOptions = {}): StreamResult {
  if (!source || !(Symbol.asyncIterator in Object(source) || Symbol.iterator in Object(source))) throw new TypeError('Stream must be iterable');
  if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) throw new RangeError('Invalid stream limit');
  if (options.status !== undefined && (!Number.isInteger(options.status) || options.status < 200 || options.status > 599)) throw new RangeError('Invalid stream status');
  return { [streamMarker]: true, source, options };
}
export function isStream(value: unknown): value is StreamResult { return !!value && typeof value === 'object' && streamMarker in value; }

export function conditionalEtag(req: IncomingMessage, res: ServerResponse, body: Buffer): boolean {
  const tag = `"${createHash('sha256').update(body).digest('hex')}"`;
  res.setHeader('ETag', tag);
  const incoming = req.headers['if-none-match'];
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (typeof incoming !== 'string') return false;
  if (incoming.trim() === '*' || incoming.split(',').some(x => x.trim().replace(/^W\//, '') === tag)) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.end();
    return true;
  }
  return false;
}

/** Header values supplied by trusted adapters still require runtime validation. */
export function validateResponseHeaders(headers: Record<string, string>): void {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 64) throw new TypeError('Invalid response headers');
  for (const [key, value] of Object.entries(headers)) {
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    if (!/^[a-z\d-]{1,64}$/i.test(key) || /^(?:connection|transfer-encoding|content-length|content-encoding)$/i.test(key) || typeof value !== 'string' || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError('Invalid response header');
  }
}

/** Await completion to observe producer failures before commitment.
 * After the first nonempty chunk, failure terminates the connection. */
export async function sendStream(res: ServerResponse, result: StreamResult, request?: IncomingMessage): Promise<void> {
  const source=result.source, options={...result.options,headers:{...result.options.headers}};
  const asyncSource=source as AsyncIterable<string|Uint8Array>;
  const iterator = typeof asyncSource[Symbol.asyncIterator]==='function' ? asyncSource[Symbol.asyncIterator]() : (source as Iterable<string | Uint8Array>)[Symbol.iterator]();
  let returning: Promise<unknown> | undefined;
  const release = () => returning ??= Promise.resolve().then(() => iterator.return?.());
  let wake: (()=>void) | undefined, transportError: Error | undefined;
  const ready = () => { const resolve=wake;wake=undefined;resolve?.(); };
  const failed = (error:Error) => { transportError=error;close(); };
  const close = () => { if (source instanceof Readable) source.destroy(); void release().catch(() => {});ready(); };
  res.once('close', close);
  request?.once('aborted', close);
  res.on('drain',ready);res.on('error',failed);
  let bytes = 0, workFailed=false, workError:unknown;
  const next = async () => {
    const item = await iterator.next();
    if (item.done) return item;
    if (typeof item.value !== 'string' && !(item.value instanceof Uint8Array)) throw new TypeError('Invalid stream chunk');
    const value = Buffer.from(item.value);
    bytes += value.length;
    if (options.maxBytes !== undefined && bytes > options.maxBytes) throw new RangeError('Stream response limit exceeded');
    return {done: false as const, value};
  };
  try {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    // Validate the complete header bag before changing the response.
    const headers = {...options.headers};
    validateResponseHeaders(result.options.headers??{});
    validateResponseHeaders(headers);
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    if (options.contentType !== undefined && (typeof options.contentType !== 'string' || /[\x00-\x1f\x7f]/.test(options.contentType))) throw new TypeError('Invalid stream content type');
    // HEAD never executes the producer, but still relinquishes ownership.
    let first = request?.method === 'HEAD' ? {done: true as const, value: undefined} : await next();
    while (!first.done && first.value.length === 0) first = await next();
    if(transportError)throw transportError;
    if (res.destroyed || request?.aborted) return;
    res.statusCode = options.status ?? 200;
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.setHeader('Cache-Control', 'no-store, no-transform');
    if (options.contentType) res.setHeader('Content-Type', options.contentType);
    if (options.contentType?.startsWith('text/event-stream')) res.setHeader('X-Accel-Buffering', 'no');
    if (first.done) { res.end(); return; }
    // Write one chunk at a time; never pull another while the socket is backpressured.
    let item:Awaited<ReturnType<typeof next>>=first;
    while(!item.done&&!res.destroyed){
      if(transportError)throw transportError;
      if(!res.write(item.value)){
        if(!res.destroyed&&!transportError)await new Promise<void>(resolve=>wake=resolve);
        if(transportError)throw transportError;
        if(res.destroyed)break;
      }
      item=await next();
    }
    if(!res.destroyed){
      await new Promise<void>(resolve=>{wake=resolve;res.end(ready);});
      if(transportError)throw transportError;
    }

  } catch(error) { workFailed=true;workError=error;throw error; } finally {
    try { await release(); }
    // eslint-disable-next-line no-unsafe-finally -- Cleanup failure must propagate; this owner explicitly reports failed resource release.
    catch(error){if(workFailed)throw new AggregateError([workError,error],'Stream production and cleanup failed');throw error;}
    finally { res.off('close', close);res.off('drain',ready);res.off('error',failed);request?.off('aborted', close); }
  }
}
