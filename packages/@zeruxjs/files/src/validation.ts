import type { FileAddress, FileInfo, FileSource, PutFileOptions, ReadFileOptions } from './types.js';
export function validateBucket(bucket: string): string {
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) throw new TypeError('Invalid bucket name');
  return bucket;
}
export function validateKey(key: string): string {
  if (typeof key !== 'string' || !key || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key) || key.startsWith('/') || key.endsWith('/') || key.split('/').some(p => p === '' || p === '.' || p === '..')) throw new TypeError('Unsafe file key');
  return key;
}
export function validateAddress(address: FileAddress): FileAddress {
  if (!address || typeof address !== 'object') throw new TypeError('File address required');
  validateBucket(address.bucket); validateKey(address.key);
  if (address.storage !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(address.storage)) throw new TypeError('Invalid storage name');
  return address;
}
export function validatePut(options: PutFileOptions = {}): void {
  if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) throw new RangeError('Invalid upload size');
  if (options.contentType !== undefined && !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(options.contentType)) throw new TypeError('Invalid content type');
  if (options.visibility !== undefined && options.visibility !== 'public' && options.visibility !== 'private') throw new TypeError('Invalid visibility');
  for (const x of [options.cacheControl,options.contentDisposition]) if (x !== undefined && (x.length > 512 || /[\r\n\x00]/.test(x))) throw new TypeError('Unsafe header value');
  if (options.expiresAt !== undefined && (!Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= Date.now())) throw new RangeError('Invalid expiration');
  const entries = Object.entries(options.metadata ?? {});
  if (entries.length > 32 || entries.some(([k,v]) => k.startsWith('zfiles-') || !/^[a-zA-Z0-9_-]{1,64}$/.test(k) || typeof v !== 'string' || v.length > 1024 || /[\r\n\x00]/.test(v))) throw new TypeError('Invalid metadata');
}
export function validateRange(options: ReadFileOptions = {}): void {
  if (options.start !== undefined && (!Number.isSafeInteger(options.start) || options.start < 0)) throw new RangeError('Invalid start');
  if (options.end !== undefined && (!Number.isSafeInteger(options.end) || options.end < (options.start ?? 0))) throw new RangeError('Invalid end');
}
export async function* chunks(source: FileSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) { if (signal?.aborted) throw signal.reason; yield source; return; }
  if (source instanceof ReadableStream) {
    const reader = source.getReader();
    try { while (true) { if (signal?.aborted) throw signal.reason; const next = await reader.read(); if (next.done) return; if (!(next.value instanceof Uint8Array)) throw new TypeError('Invalid file chunk'); yield next.value; } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else {
    for await (const chunk of source) { if (signal?.aborted) throw signal.reason; if (!(chunk instanceof Uint8Array)) throw new TypeError('Invalid file chunk'); yield chunk; }
  }
}
export function expired(meta: FileInfo): boolean { return !!meta.expiresAt && Date.parse(meta.expiresAt) <= Date.now(); }
export function ensureNotExpired(meta: FileInfo): void { if (expired(meta)) throw Object.assign(new Error('File expired'), {code:'FILE_EXPIRED'}); }
