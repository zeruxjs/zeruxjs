import { resolve, sep } from 'node:path';
import type { UploadOptions } from './types.js';
/** Compatible case-insensitive UUID syntax, restricted to a single safe filename. */
export const MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Validate the bounded UUID spelling before using an ID as a private filename.
 * @throws {TypeError} Invalid media ID syntax.
 * @param {string} id - Opaque media UUID; not a tenant/principal authorization token.
 * @returns {void} Accepted ID remains unchanged; no filesystem access occurs.
 */
export function assertId(id: string): void {
  if (typeof id !== 'string' || !MEDIA_ID.test(id)) {
    throw new TypeError('Invalid media id');
  }
}
/** Resolve only a validated UUID directly beneath the configured root; canonical/no-follow checks remain with the store.
 * @param {string} root - Trusted private store root.
 * @param {string} id - Validated opaque UUID, never an arbitrary relative path.
 * @returns {string} Resolved internal binary path, not a public access URL.
 */
export function safePath(root: string, id: string): string {
  assertId(id);
  /** Resolved direct-child binary path after UUID validation. */
  const file = resolve(root, id);
  if (!file.startsWith(resolve(root) + sep)) {
    throw new Error('Unsafe path');
  }
  return file;
}
/** Validate declared upload metadata and derive a positive byte ceiling/optional future expiry. Content scanning and authorization remain host-owned.
 * @param {UploadOptions} options - Trusted declared name, bare MIME and optional lifetime/byte limit.
 * @param {number} defaultMax - Store-selected default byte ceiling used when maxBytes is absent.
 * @returns {object} Effective max bytes and optional ISO expiry; invalid names/MIME/bounds reject.
 */
export function validateUpload(
  options: UploadOptions,
  defaultMax: number
): {
  max: number; /** Optional stored ISO expiry; reads reject elapsed metadata. */
  expiresAt?: string;
} {
  if (
    !options ||
    typeof options.name !== 'string' ||
    !options.name.trim() ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
    /[\x00-\x1f\x7f]/.test(options.name) ||
    options.name.length > 255
  ) {
    throw new TypeError('Invalid media name');
  }
  if (
    typeof options.contentType !== 'string' ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(options.contentType)
  ) {
    throw new TypeError('Invalid MIME type');
  }
  /** Effective positive safe-integer upload byte ceiling. */
  const max = options.maxBytes ?? defaultMax;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }
  if (
    options.expiresInMs !== undefined &&
    (!Number.isSafeInteger(options.expiresInMs) ||
      options.expiresInMs <= 0 ||
      !Number.isFinite(Date.now() + options.expiresInMs))
  ) {
    throw new RangeError('Invalid expiration');
  }
  return {
    max,
    ...(options.expiresInMs === undefined
      ? {}
      : {
          expiresAt: new Date(Date.now() + options.expiresInMs).toISOString(),
        }),
  };
}
