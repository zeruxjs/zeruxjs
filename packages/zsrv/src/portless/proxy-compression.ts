/** Streaming, content-negotiated HTTP compression for forwarded responses.
 * Never decode or recompress upstream-encoded representations. */
import * as zlib from 'node:zlib';
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

export type CompressionEncoding = 'br' | 'gzip' | 'deflate' | 'zstd';
export interface ProxyCompressionOptions {
  /** Defaults to true; set false to delegate all compression to the application or Nginx. */
  enabled?: boolean;
  /** Minimum known response body size to compress; default 1024 bytes. */
  minBytes?: number;
  /** Preferred order when quality values are equal, default br, zstd, gzip, deflate. */
  encodings?: CompressionEncoding[];
  /** Brotli quality 0..11. Defaults to 4 to limit CPU consumption. */
  brotliQuality?: number;
  /** zlib compression level 0..9; default 5. */
  level?: number;
}
export interface CompressionDecision { encoding: CompressionEncoding | null; acceptable: boolean; }
const DEFAULT_PREFERENCE: CompressionEncoding[] = ['br', 'zstd', 'gzip', 'deflate'];
const MIME_PATTERN = /^(?:text\/|application\/(?:json|[\w.+-]*\+json|javascript|xml|[\w.+-]*\+xml|wasm|graphql|x-www-form-urlencoded)|image\/svg\+xml|font\/svg)/i;
const ENCODINGS: ReadonlySet<string> = new Set(DEFAULT_PREFERENCE);

export function compressionSupported(encoding: CompressionEncoding): boolean {
  return encoding !== 'zstd' || typeof (zlib as typeof zlib & { createZstdCompress?: unknown }).createZstdCompress === 'function';
}

/** Parse the client's Accept-Encoding using RFC-style q weights. Invalid weights are treated as q=0. */
export function parseAcceptEncoding(header: string | string[] | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (header === undefined) return result;
  const source = Array.isArray(header) ? header.join(',') : header;
  for (const entry of source.split(',')) {
    const parts = entry.trim().split(';');
    const token = parts.shift()?.trim().toLowerCase() ?? '';
    if (!/^(?:\*|[a-z0-9!#$%&'*+.^_`|~-]+)$/.test(token)) continue;
    let q = 1;
    for (const param of parts) {
      const match = /^\s*q\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(param);
      if (match) { const value = Number(match[1]); q = value >= 0 && value <= 1 && /^\d(?:\.\d{0,3})?$/.test(match[1]) ? value : 0; }
      else if (/^\s*q\s*=/i.test(param)) q = 0;
    }
    if (!result.has(token) || result.get(token)! < q) result.set(token, q);
  }
  return result;
}

export function encodingQuality(accepted: Map<string, number>, encoding: string): number {
  const name = encoding.toLowerCase();
  if (accepted.has(name)) return accepted.get(name)!;
  if (name === 'identity') return accepted.get('*') === 0 ? 0 : 1;
  return accepted.get('*') ?? 0;
}

export function negotiateCompression(header: string | string[] | undefined, opts: ProxyCompressionOptions = {}): CompressionDecision {
  const accepted = parseAcceptEncoding(header);
  const preferences = opts.encodings ?? DEFAULT_PREFERENCE;
  let chosen: CompressionEncoding | null = null;
  let quality = 0;
  for (const encoding of preferences) {
    if (!ENCODINGS.has(encoding) || !compressionSupported(encoding)) continue;
    const q = encodingQuality(accepted, encoding);
    if (q > quality) { chosen = encoding; quality = q; }
  }
  const identityQuality = encodingQuality(accepted, 'identity');
  return { encoding: chosen, acceptable: quality > 0 || identityQuality > 0 };
}

export function validateCompressionOptions(options: ProxyCompressionOptions = {}): Required<ProxyCompressionOptions> {
  const config = {
    enabled: options.enabled ?? true,
    minBytes: options.minBytes ?? 1024,
    encodings: options.encodings ?? [...DEFAULT_PREFERENCE],
    brotliQuality: options.brotliQuality ?? 4,
    level: options.level ?? 5,
  };
  if (typeof config.enabled !== 'boolean' || !Number.isSafeInteger(config.minBytes) || config.minBytes < 0 || config.minBytes > 1_048_576 || !Number.isSafeInteger(config.brotliQuality) || config.brotliQuality < 0 || config.brotliQuality > 11 || !Number.isSafeInteger(config.level) || config.level < 0 || config.level > 9 || !Array.isArray(config.encodings) || !config.encodings.length || new Set(config.encodings).size !== config.encodings.length || config.encodings.some(enc => !ENCODINGS.has(enc))) throw new RangeError('Invalid proxy compression configuration');
  return config;
}

export function appendVary(value: string | string[] | number | undefined, header: string): string {
  const existing = (Array.isArray(value) ? value.join(',') : String(value ?? '')).trim();
  if (existing === '*') return '*';
  const values = existing.split(',').map(v => v.trim()).filter(Boolean);
  if (!values.some(v => v.toLowerCase() === header.toLowerCase())) values.push(header);
  return values.join(', ');
}

function contentIsCompressible(headers: IncomingHttpHeaders): boolean {
  const mime = String(headers['content-type'] ?? '').split(';')[0].trim();
  return MIME_PATTERN.test(mime);
}
function isNoTransform(headers: IncomingHttpHeaders): boolean {
  return /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(String(headers['cache-control'] ?? ''));
}
function makeEncoder(name: CompressionEncoding, config: Required<ProxyCompressionOptions>) {
  if (name === 'br') return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: config.brotliQuality } });
  if (name === 'gzip') return zlib.createGzip({ level: config.level });
  if (name === 'deflate') return zlib.createDeflate({ level: config.level });
  if (!compressionSupported('zstd')) throw new Error('Zstandard not available on this Node.js version');
  // zstd remains experimental on supported Node.js releases.
  return (zlib as typeof zlib & { createZstdCompress: () => ReturnType<typeof zlib.createGzip> }).createZstdCompress();
}

/** Must be called before writing headers; writes headers and pipes on success.
 * Existing Content-Encoding is never altered: Nginx and upstream compression remain compatible.
 */
export function forwardCompressedResponse(
  request: IncomingMessage, upstream: Readable & { statusCode?: number; headers: IncomingHttpHeaders },
  response: ServerResponse, options: ProxyCompressionOptions = {},
): void {
  const config = validateCompressionOptions(options);
  const status = upstream.statusCode ?? 502;
  const headers: IncomingHttpHeaders = { ...upstream.headers };
  const accepted = parseAcceptEncoding(request.headers['accept-encoding']);
  const upstreamEncoding = String(headers['content-encoding'] ?? '').trim().toLowerCase();
  const validUpstreamEncoding = !upstreamEncoding || upstreamEncoding.split(',').every(enc => encodingQuality(accepted, enc.trim()) > 0);
  // No implicit decompress/recompress. Reject representations the client explicitly forbids.
  if (!validUpstreamEncoding) {
    upstream.destroy();
    response.writeHead(406, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' });
    response.end('Upstream content encoding not acceptable');
    return;
  }
  const decision = negotiateCompression(request.headers['accept-encoding'], config);
  const noBody = request.method === 'HEAD' || status === 204 || status === 205 || status === 304 || status < 200;
  const length = headers['content-length'] === undefined ? undefined : Number(headers['content-length']);
  const canTransform = config.enabled && !noBody && status !== 206 && !upstreamEncoding && !headers['content-range'] &&
    !isNoTransform(headers) && !isNoTransform(request.headers) && !request.headers.range && !request.headers['if-range'] && contentIsCompressible(headers) &&
    !/^text\/event-stream(?:;|$)/i.test(String(headers['content-type'] ?? '')) &&
    !/\b(?:grpc|connect)\b/i.test(String(headers['content-type'] ?? '')) &&
    (length === undefined || (Number.isFinite(length) && length >= config.minBytes));
  // Vary is needed for compressed/uncompressed representations, including when below threshold.
  if (config.enabled && !upstreamEncoding && contentIsCompressible(headers)) headers.vary = appendVary(headers.vary, 'Accept-Encoding');
  const selected = canTransform ? decision.encoding : null;
  if (!selected && encodingQuality(accepted, 'identity') === 0 && !upstreamEncoding && !noBody) {
    upstream.destroy();
    response.writeHead(406, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' });
    response.end('No acceptable response encoding');
    return;
  }
  if (/^text\/event-stream(?:;|$)/i.test(String(headers['content-type'] ?? ''))) {
    headers['x-accel-buffering'] = 'no';
    headers['cache-control'] = /no-transform/i.test(String(headers['cache-control'] ?? '')) ? headers['cache-control'] : (headers['cache-control'] ? `${headers['cache-control']}, no-transform` : 'no-cache, no-transform');
  }
  if (!selected) {
    response.writeHead(status, headers);
    upstream.pipe(response);
    return;
  }
  headers['content-encoding'] = selected;
  delete headers['content-length'];
  delete headers['content-md5'];
  delete headers['content-digest'];
  delete headers.digest;
  delete headers.etag; // An origin ETag for uncompressed representation is no longer valid.
  delete headers['accept-ranges'];
  headers.vary = appendVary(headers.vary, 'Accept-Encoding');
  const encoder = makeEncoder(selected, config);
  response.writeHead(status, headers);
  encoder.on('error', err => { upstream.destroy(err); response.destroy(err); });
  upstream.on('error', err => { encoder.destroy(err); response.destroy(err); });
  response.once('close', () => { if (!upstream.destroyed) upstream.destroy(); encoder.destroy(); });
  upstream.pipe(encoder).pipe(response);
}
