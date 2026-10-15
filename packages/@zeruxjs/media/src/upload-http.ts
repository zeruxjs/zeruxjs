import type { StoredMedia } from './types.js';
import type { MediaStore } from './store.js';
export interface MediaRequestUploadOptions {
  name?: string;
  maxBytes?: number;
  expiresInMs?: number;
}
/**
 * Upload a Fetch Request stream without buffering it in memory. Applications must
 * authenticate and authorize the request before calling this helper.
 */
export async function uploadMediaRequest(store: MediaStore, request: Request, options: MediaRequestUploadOptions = {}): Promise<StoredMedia> {
  if (request.method !== 'POST' && request.method !== 'PUT') throw new TypeError('Upload requires POST or PUT');
  const rawType = request.headers.get('content-type') ?? 'application/octet-stream';
  const contentType = rawType.split(';',1)[0].trim();
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new TypeError('Encoded uploads are not supported');
  if (!request.body) throw new TypeError('Upload body is required');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new RangeError('Invalid Content-Length');
  if (options.maxBytes !== undefined && length && Number(length) > options.maxBytes) throw new RangeError('Media size exceeds limit');
  const name = options.name ?? 'upload';
  const reader = request.body.getReader();
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try { while (true) { const { done,value } = await reader.read(); if (done) break; yield value; } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const result = await store.uploadStream(chunks(), { name, contentType, maxBytes: options.maxBytes, expiresInMs: options.expiresInMs });
  if (length && result.size !== Number(length)) { await store.remove(result.id); throw new RangeError('Upload length mismatch'); }
  return result;
}
