import { resolve, sep } from 'node:path';
import type { UploadOptions } from './types.js';
export const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertId(id: string): void { if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new TypeError('Invalid media id'); }
export function safePath(root: string, id: string): string { assertId(id); const file = resolve(root, id); if (!file.startsWith(resolve(root) + sep)) throw new Error('Unsafe path'); return file; }
export function validateUpload(options: UploadOptions, defaultMax: number): {max: number; expiresAt?: string} {
  if (!options || typeof options.name !== 'string' || !options.name.trim() || /[\x00-\x1f\x7f]/.test(options.name) || options.name.length > 255) throw new TypeError('Invalid media name');
  if (typeof options.contentType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(options.contentType)) throw new TypeError('Invalid MIME type');
  const max = options.maxBytes ?? defaultMax;
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('maxBytes must be a positive safe integer');
  if (options.expiresInMs !== undefined && (!Number.isSafeInteger(options.expiresInMs) || options.expiresInMs <= 0 || !Number.isFinite(Date.now() + options.expiresInMs))) throw new RangeError('Invalid expiration');
  return {max, ...(options.expiresInMs === undefined ? {} : {expiresAt: new Date(Date.now() + options.expiresInMs).toISOString()})};
}
