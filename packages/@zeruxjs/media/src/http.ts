import type { MediaStore } from './store.js';
import type { StoredMedia } from './types.js';

export interface MediaResponseOptions {
  /** The caller must authorize access before calling this function. */
  request?: Request;
  downloadName?: string;
  inline?: boolean;
  cacheControl?: string;
}

function quotedFilename(name: string): string {
  const normalized = name.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 255) || 'download';
  return `"${normalized.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  // Only single RFC 9110 byte ranges are supported. Reject rather than incorrectly combining ranges.
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function matchesEtag(header: string, etag: string): boolean {
  return header.split(',').some(part => part.trim() === etag || part.trim() === '*');
}

export async function createMediaResponse(store: MediaStore, id: string, options: MediaResponseOptions = {}): Promise<Response> {
  const { request } = options;
  const method = request?.method.toUpperCase() ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const meta: StoredMedia = await store.info(id);
  const etag = `"${meta.sha256}"`;
  const safeInline=/^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[A-Za-z0-9.+-]+|video\/[A-Za-z0-9.+-]+|application\/pdf|text\/plain)$/.test(meta.contentType.toLowerCase());
  const headers = new Headers({
    'Content-Type': meta.contentType,
    'Content-Disposition': `${options.inline && safeInline ? 'inline' : 'attachment'}; filename=${quotedFilename(options.downloadName ?? meta.originalName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': options.cacheControl ?? 'private, no-store',
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Last-Modified': new Date(meta.createdAt).toUTCString(),
  });
  const reqHeaders = request?.headers;
  if (reqHeaders?.has('if-none-match') && matchesEtag(reqHeaders.get('if-none-match')!, etag)) {
    return new Response(null, { status: 304, headers });
  }
  const requestedRange = reqHeaders?.get('range');
  const ifRange = reqHeaders?.get('if-range');
  const allowRange = requestedRange && (!ifRange || ifRange === etag || (Date.parse(ifRange) >= Date.parse(meta.createdAt) && !Number.isNaN(Date.parse(ifRange))));
  const range = allowRange ? parseRange(requestedRange, meta.size) : undefined;
  if (allowRange && !range) {
    headers.set('Content-Range', `bytes */${meta.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, meta.size - 1);
  headers.set('Content-Length', String(range ? end - start + 1 : meta.size));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
  const status = range ? 206 : 200;
  if (method === 'HEAD') return new Response(null, { status, headers });
  // Secure opening occurs before constructing the response; cancel() closes the file on disconnect.
  const chunks = store.streamRange(id, start, range ? end : undefined);
  const iterator = chunks[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  });
  return new Response(body, { status, headers });
}
