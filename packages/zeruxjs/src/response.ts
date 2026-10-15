/** Response controls for ZeruxJS handlers. No global mutable response configuration. */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

export function sendStream(res: ServerResponse, result: StreamResult, request?: IncomingMessage): void {
  const { source, options } = result;
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = options.status ?? 200;
  res.setHeader('Cache-Control', 'no-store, no-transform');
  if (options.contentType) res.setHeader('Content-Type', options.contentType);
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (!/^[a-z\d-]{1,64}$/i.test(key) || /^(?:connection|transfer-encoding|content-length|content-encoding)$/i.test(key) || /[\r\n]/.test(value)) throw new TypeError('Invalid stream header');
    res.setHeader(key, value);
  }
  if (options.contentType?.startsWith('text/event-stream')) res.setHeader('X-Accel-Buffering', 'no');
  if (request?.method === 'HEAD') { res.end(); return; }
  const iterator = Readable.from(source);
  let bytes = 0;
  const limited = (async function* () {
    for await (const chunk of iterator) {
      const item = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      bytes += item.length;
      if (options.maxBytes !== undefined && bytes > options.maxBytes) throw new RangeError('Stream response limit exceeded');
      yield item;
    }
  })();
  const close = () => iterator.destroy();
  res.once('close', close);
  void pipeline(Readable.from(limited), res).catch(error => {
    if (!res.destroyed) res.destroy(error);
  }).finally(() => res.off('close', close));
}
