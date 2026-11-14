import type {
  FileAddress,
  FileInfo,
  FileSource,
  PutFileOptions,
  ReadFileOptions,
} from './types.js';
/** Validate the shared literal bucket syntax without querying a storage provider.
 * @param {string} bucket - Lowercase 3–63-character bucket name without consecutive dots.
 * @returns {string} The original accepted bucket string; invalid syntax throws TypeError.
 */
export function validateBucket(bucket: string): string {
  if (
    typeof bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes('..')
  ) {
    throw new TypeError('Invalid bucket name');
  }
  return bucket;
}
/** Reject traversal, separators and control characters before filesystem or URL use.
 * @param {string} key - Nonempty relative slash-separated key, at most 1024 UTF-16 code units.
 * @returns {string} Original accepted key, without normalization or decoding.
 */
export function validateKey(key: string): string {
  if (
    typeof key !== 'string' ||
    !key ||
    key.length > 1024 ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in object keys.
    /[\\\x00-\x1f\x7f]/.test(key) ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.split('/').some((p) => p === '' || p === '.' || p === '..')
  ) {
    throw new TypeError('Unsafe file key');
  }
  return key;
}
/** Check connection/bucket/key syntax without authorizing or copying the address.
 * @param {FileAddress} address - Borrowed address; optional storage names use the named-connection syntax.
 * @returns {FileAddress} Same address reference after validation; tenant policy remains host-owned.
 */
export function validateAddress(address: FileAddress): FileAddress {
  if (!address || typeof address !== 'object') {
    throw new TypeError('File address required');
  }
  validateBucket(address.bucket);
  validateKey(address.key);
  if (
    address.storage !== undefined &&
    !/^[a-z][a-z0-9_-]{0,63}$/.test(address.storage)
  ) {
    throw new TypeError('Invalid storage name');
  }
  return address;
}
/** Check upload options and reserved metadata before dispatch; this is not an object-content scanner.
 * @param {PutFileOptions} options - Borrowed options; defaults to empty. Enforces positive sizes, bare MIME, safe headers, future expiry and bounded metadata.
 * @returns {void} Accepted options remain unchanged; invalid syntax or bounds throw.
 */
export function validatePut(options: PutFileOptions = {}): void {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Upload options required');
  }
  if (
    options.ifNoneMatch !== undefined &&
    typeof options.ifNoneMatch !== 'boolean'
  ) {
    throw new TypeError('Invalid create-only condition');
  }
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
  ) {
    throw new RangeError('Invalid upload size');
  }
  if (
    options.contentType !== undefined &&
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(options.contentType)
  ) {
    throw new TypeError('Invalid content type');
  }
  if (
    options.visibility !== undefined &&
    options.visibility !== 'public' &&
    options.visibility !== 'private'
  ) {
    throw new TypeError('Invalid visibility');
  }

  // Apply the same literal header safety policy to both caller-controlled headers.
  for (const x of [options.cacheControl, options.contentDisposition]) {
    // eslint-disable-next-line no-control-regex -- Intentionally reject header injection control characters.
    if (x !== undefined && (x.length > 512 || /[\r\n\x00]/.test(x))) {
      throw new TypeError('Unsafe header value');
    }
  }
  if (
    options.expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(options.expiresAt)) ||
      Date.parse(options.expiresAt) <= Date.now())
  ) {
    throw new RangeError('Invalid expiration');
  }
  /** Own enumerable metadata entries checked against the 32-field key/value budgets. */
  const entries = Object.entries(options.metadata ?? {});

  if (
    entries.length > 32 ||
    entries.some(
      ([k, v]) =>
        k.startsWith('zfiles-') ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(k) ||
        typeof v !== 'string' ||
        v.length > 1024 ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in metadata values.
        /[\r\n\x00]/.test(v)
    )
  ) {
    throw new TypeError('Invalid metadata');
  }
}
/** Validate nonnegative inclusive byte bounds without knowing object length.
 * @param {ReadFileOptions} options - Optional start/end; end must be at least start, or zero when start is absent.
 * @returns {void} Invalid safe-integer or ordering bounds throw RangeError.
 */
export function validateRange(options: ReadFileOptions = {}): void {
  if (
    options.start !== undefined &&
    (!Number.isSafeInteger(options.start) || options.start < 0)
  ) {
    throw new RangeError('Invalid start');
  }
  if (
    options.end !== undefined &&
    (!Number.isSafeInteger(options.end) || options.end < (options.start ?? 0))
  ) {
    throw new RangeError('Invalid end');
  }
}
/** Yield borrowed byte chunks while observing cancellation at cooperative checkpoints. A pending source read is not forcibly interrupted.
 * @param {FileSource} source - Borrowed bytes, iterable or Web Stream; every yielded value must be Uint8Array.
 * @param {AbortSignal | undefined} signal - Caller-owned cancellation; abort reason propagates at observed checkpoints.
 * @returns {AsyncGenerator<Uint8Array>} Validated byte chunks without copying; acquired Web readers cancel/unlock on exit and iterables retain native return semantics.
 */
export async function* chunks(
  source: FileSource,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    yield source;
    return;
  }
  if (source instanceof ReadableStream) {
    /** Exclusive Web Stream reader owned until cancellation and lock release in finally. */
    const reader = source.getReader();
    try {
      // Hold exclusive reader ownership through actual source settlement, including cancellation observation.
      while (true) {
        if (signal?.aborted) {
          throw signal.reason;
        }
        /** Next native read observation; each value must be bytes before it is yielded. */
        const next = await reader.read();
        if (next.done) {
          return;
        }
        if (!(next.value instanceof Uint8Array)) {
          throw new TypeError('Invalid file chunk');
        }
        yield next.value;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    // Native for-await closes the iterator on consumer return or validation failure.
    for await (const chunk of source) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError('Invalid file chunk');
      }
      yield chunk;
    }
  }
}
/** Compare optional stored expiry with the current wall clock.
 * @param {FileInfo} meta - Borrowed metadata; missing expiry is not expired, invalid dates do not compare as elapsed.
 * @returns {boolean} Whether a supplied parseable expiry is at or before now.
 */
export function expired(meta: FileInfo): boolean {
  return !!meta.expiresAt && Date.parse(meta.expiresAt) <= Date.now();
}
/** Reject expired metadata before returning stored bytes.
 * @param {FileInfo} meta - Borrowed metadata checked against the current wall clock.
 * @returns {void} Returns for unexpired metadata; throws FILE_EXPIRED for elapsed expiry.
 */
export function ensureNotExpired(meta: FileInfo): void {
  if (expired(meta)) {
    throw Object.assign(new Error('File expired'), { code: 'FILE_EXPIRED' });
  }
}
