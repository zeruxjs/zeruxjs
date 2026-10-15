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
  const maxBytes=options.maxBytes;
  if(maxBytes!==undefined&&(!Number.isSafeInteger(maxBytes)||maxBytes<1))throw new RangeError('Invalid upload limit');
  const expected=length===null?undefined:Number(length);
  const name = options.name ?? 'upload';
  const reader = request.body.getReader();
  async function* chunks(): AsyncGenerator<Uint8Array> {
    let bytes=0;
    try { while (true) {
      if(request.signal.aborted)throw request.signal.reason;
      const { done,value } = await reader.read(); if (done) break;
      if(!(value instanceof Uint8Array))throw new TypeError('Invalid binary upload chunk');
      bytes+=value.byteLength;
      if(!Number.isSafeInteger(bytes)||(maxBytes!==undefined&&bytes>maxBytes))throw new RangeError('Media size exceeds limit');
      if(expected!==undefined&&bytes>expected)throw new RangeError('Upload length mismatch');
      yield value;
    }
    if(expected!==undefined&&bytes!==expected)throw new RangeError('Upload length mismatch');
    }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return store.uploadStream(chunks(), { name, contentType, maxBytes, expiresInMs: options.expiresInMs });
}
