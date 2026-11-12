import crypto from 'node:crypto';
export type DigestAlgorithm = 'sha256' | 'sha384' | 'sha512';
export interface RecordKey {
  /** Public unique key label, 1–64 safe ASCII characters; never secret material. */
  readonly id: string;
  /** Exactly 32 cryptographically random host key bytes, copied at acquisition. */
  readonly key: Uint8Array;
}
export interface KeyringOptions {
  /** Current key used to encrypt/sign new records. */
  readonly current: RecordKey;
  /** Up to four retained retired keys for decrypt/verify only. */
  readonly previous?: readonly RecordKey[];
  /** Finite plaintext/message budget; defaults 1 MiB and caps at 16 MiB. */
  readonly maxBytes?: number;
}
export interface EncryptionKeyringOptions extends KeyringOptions {
  /** Explicit sole supported cipher/authentication algorithm for the selected factory. */
  readonly algorithm?: 'aes-256-gcm';
}
export interface MessageAuthenticatorOptions extends KeyringOptions {
  /** Explicit sole supported cipher/authentication algorithm for the selected factory. */
  readonly algorithm?: 'hmac-sha256';
}
export interface EncryptedRecord {
  /** Authenticated package format version; only 1 is supported. */
  readonly v: 1;
  /** Authenticated package algorithm label; not arbitrary native algorithm selection. */
  readonly alg: 'A256GCM';
  /** Authenticated public key ID selecting one retained key. */
  readonly kid: string;
  /** Canonical unpadded base64url 12-byte random GCM IV. */
  readonly iv: string;
  /** Canonical unpadded base64url native authentication tag. */
  readonly tag: string;
  /** Canonical bounded ciphertext; no plaintext is embedded. */
  readonly ciphertext: string;
}
export interface MessageAuthentication {
  /** Authenticated package format version; only 1 is supported. */
  readonly v: 1;
  /** Authenticated package algorithm label; not arbitrary native algorithm selection. */
  readonly alg: 'HS256';
  /** Authenticated public key ID selecting one retained key. */
  readonly kid: string;
  /** Canonical unpadded base64url native authentication tag. */
  readonly tag: string;
}
/** Generic authentication rejection; no key, plaintext, record or reason oracle. */
export class SecurityRecordError extends Error {
  /** Create a fixed redacted crypto/authentication error; private native causes remain server-only.
   */
  constructor() {
    super('Invalid or unauthenticated security record');
    this.name = 'SecurityRecordError';
  }
}
/** Native backend failures remain errors, with trusted server-side causes only. */
export class SecurityCryptoError extends Error {
  /** Create a fixed redacted crypto/authentication error; private native causes remain server-only.
   * @param {unknown} cause - Private original native failure; never serialize it to an untrusted caller.
   */
  constructor(cause: unknown) {
    super('Node crypto operation failed', { cause });
    this.name = 'SecurityCryptoError';
  }
}
/** Bounded public key-ID grammar; key labels must never contain secrets or personal identifiers. */
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
/** Validate text/byte input and return an independent bounded buffer. Caller bytes remain borrowed and unchanged.
 * @param {unknown} value - Text or Uint8Array input; unsupported values reject.
 * @param {number} maximum - Maximum UTF-8/byte length checked before copying.
 * @returns {Buffer} Independent bytes owned by the caller of this internal helper.
 */
function bytes(value: unknown, maximum: number): Buffer {
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
    throw new TypeError('Expected text or byte input');
  }
  if (typeof value === 'string' && value.length > maximum) {
    throw new RangeError('Crypto input exceeds byte limit');
  }
  /** Actual UTF-8/byte length before copying; character length alone is not the byte budget. */
  const size =
    typeof value === 'string'
      ? Buffer.byteLength(value, 'utf8')
      : value.byteLength;
  if (size > maximum) {
    throw new RangeError('Crypto input exceeds byte limit');
  }
  return typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : Buffer.from(value);
}
/** Require a bounded explicit context before cryptographic work. Context must derive from server-verified tenant/object identity and is not a permission grant.
 * @param {unknown} context - Nonempty text capped at 1024 UTF-8 bytes.
 * @returns {void} Completes only for a valid context; invalid configuration throws.
 */
function validateContext(context: unknown): asserts context is string {
  if (
    typeof context !== 'string' ||
    !context ||
    context.length > 1024 ||
    Buffer.byteLength(context) > 1024
  ) {
    throw new TypeError('A bounded nonempty security context is required');
  }
}
/** Validate unique key IDs and copy all key bytes. Failed acquisition clears copied buffers; caller key material is never modified.
 * @param {KeyringOptions} options - Explicit current/previous keys and finite byte policy; no environment fallback.
 * @returns {object} Owned copied key state with check/destroy lifecycle.
 */
function setup(options: KeyringOptions) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Invalid keyring options');
  }
  /** Validated plaintext/message byte ceiling; default1 MiB, maximum 16 MiB. */
  const maximum =
    options.maxBytes === undefined ? 1024 * 1024 : options.maxBytes;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 16 * 1024 * 1024
  ) {
    throw new RangeError('Invalid crypto byte limit');
  }
  if (
    options.previous !== undefined &&
    (!Array.isArray(options.previous) || options.previous.length > 4)
  ) {
    throw new TypeError('At most four previous keys are supported');
  }
  /** Owned copied key buffers indexed by unique public key ID; clear on failed setup and destroy. */
  const keys = new Map<string, Buffer>();
  try {
    // Validate unique public labels and copy every explicit key before publishing the ring.
    for (const entry of [options.current, ...(options.previous ?? [])]) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'string' ||
        !idPattern.test(entry.id) ||
        keys.has(entry.id)
      ) {
        throw new TypeError('Invalid or duplicate key identifier');
      }
      if (!(entry.key instanceof Uint8Array) || entry.key.byteLength !== 32) {
        throw new TypeError('Security keys must contain exactly 32 bytes');
      }
      keys.set(entry.id, Buffer.from(entry.key));
    }
  } catch (error) {
    // Clear only owned copied buffers, including partial setup and idempotent destruction.
    for (const key of keys.values()) {
      key.fill(0);
    }
    throw error;
  }
  /** Captured current key ID used for new records; previous keys only decrypt/verify. */
  const current = options.current.id;
  let destroyed = false;
  return {
    maximum,
    current,
    keys,
    /** Reject operations after owned key state was destroyed.
     * @returns {void} Completes only while the key snapshot remains active.
     */
    check() {
      if (destroyed) {
        throw new Error('Security keyring is destroyed');
      }
    },
    /** Idempotently invalidate this key snapshot and clear its owned buffers. Native/VM/caller copies cannot be guaranteed erased.
     * @returns {void} Releases owned key references; caller keys and returned plaintext remain caller-owned.
     */
    destroy() {
      // Clear only owned copied buffers, including partial setup and idempotent destruction.
      for (const key of keys.values()) {
        key.fill(0);
      }
      keys.clear();
      destroyed = true;
    },
  };
}
/** Decode only canonical unpadded base64url within declared length bounds.
 * @param {unknown} value - Untrusted record field; invalid syntax does not reveal a detailed rejection reason.
 * @param {number} max - Maximum decoded bytes.
 * @param {number} length - Optional exact decoded byte length.
 * @returns {Buffer | undefined} Validated independent decoded bytes, or undefined for malformed input.
 */
function decode(
  value: unknown,
  max: number,
  length?: number
): Buffer | undefined {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil((max * 4) / 3) ||
    !/^[A-Za-z0-9_-]*$/.test(value)
  ) {
    return;
  }
  /** Canonical decoded bytes accepted only after size and round-trip encoding checks. */
  const result = Buffer.from(value, 'base64url');
  if (
    result.byteLength > max ||
    (length !== undefined && result.byteLength !== length) ||
    result.toString('base64url') !== value
  ) {
    return;
  }
  return result;
}
/** Read an exact set of own data descriptors without executing getters. Reflection failure becomes generic malformed-record rejection.
 * @param {unknown} record - Untrusted record envelope; arrays and missing/extra fields reject.
 * @param {readonly string[]} names - Exact required own data-field names.
 * @returns {Record<string, unknown> | undefined} Copied data-field map or undefined without exposing reflection causes.
 */
function fields(
  record: unknown,
  names: readonly string[]
): Record<string, unknown> | undefined {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return;
    }
    /** Own data descriptors inspected without invoking record getters. */
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (
      Object.keys(descriptors).length !== names.length ||
      names.some(
        (name) =>
          !Object.hasOwn(descriptors, name) ||
          !Object.hasOwn(descriptors[name], 'value')
      )
    ) {
      return;
    }
    return Object.fromEntries(
      names.map((name) => [name, descriptors[name].value])
    );
  } catch {
    return;
  } // Treat hostile reflective objects like malformed records, without exposing their errors.
}
/** Encode an unambiguous authenticated domain/version/algorithm/key/context tuple. No tuple field is accepted as authorization.
 * @param {string} domain - Fixed package format domain.
 * @param {number} v - Fixed format version.
 * @param {string} alg - Fixed allowed algorithm label.
 * @param {string} kid - Selected public key identifier.
 * @param {string} context - Verified application scope supplied separately from stored record.
 * @returns {Buffer} Native authenticated-associated-data bytes.
 */
function aad(
  domain: string,
  v: number,
  alg: string,
  kid: string,
  context: string
): Buffer {
  return Buffer.from(JSON.stringify([domain, v, alg, kid, context]));
}

/** Create an explicit AES-256-GCM keyring with copied 32-byte keys. Fresh 12-byte IVs and 16-byte tags authenticate metadata/context; always destroy the owner.
 * @param {EncryptionKeyringOptions} options - Current/previous key policy; unsupported algorithms and duplicate IDs reject.
 * @returns {object} Synchronous encrypt/decrypt owner with idempotent destroy; no I/O, timer or worker starts.
 */
export function createEncryptionKeyring(options: EncryptionKeyringOptions) {
  if (options?.algorithm !== undefined && options.algorithm !== 'aes-256-gcm') {
    throw new TypeError('Unsupported encryption algorithm');
  }
  /** Owned copied key state; destruction invalidates subsequent synchronous operations. */
  const ring = setup(options);
  return {
    /** Encrypt with the current key and fresh native IV, authenticating context and format metadata. Always clears its owned plaintext-input copy.
     * @param {string | Uint8Array} plaintext - Bounded caller text/bytes copied before native use.
     * @param {string} context - Stable server-verified tenant/object scope; not a permission token.
     * @returns {EncryptedRecord} Versioned authenticated ciphertext record; native failure is distinct from record rejection.
     */
    encrypt(plaintext: string | Uint8Array, context: string): EncryptedRecord {
      ring.check();
      validateContext(context);
      /** Owned copy of input bytes; cleared after native encryption/authentication completes or fails. */
      const input = bytes(plaintext, ring.maximum);
      try {
        /** Fresh native 12-byte GCM nonce or validated stored IV; never derived from user identity. */
        const iv = crypto.randomBytes(12);
        /** Native AES-256-GCM instance configured with the exact declared authentication-tag size. */
        const cipher = crypto.createCipheriv(
          'aes-256-gcm',
          ring.keys.get(ring.current)!,
          iv,
          { authTagLength: 16 }
        );
        cipher.setAAD(
          aad('zeruxjs.security.record', 1, 'A256GCM', ring.current, context)
        );
        /** Ciphertext returned only after native finalization; no unauthenticated plaintext is exposed. */
        const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
        return {
          v: 1,
          alg: 'A256GCM',
          kid: ring.current,
          iv: iv.toString('base64url'),
          tag: cipher.getAuthTag().toString('base64url'),
          ciphertext: encrypted.toString('base64url'),
        };
      } catch (cause) {
        throw new SecurityCryptoError(cause);
      } finally {
        input.fill(0);
      }
    },
    /** Validate record structure then authenticate before returning plaintext. Pending unauthenticated buffers are cleared on success/failure.
     * @param {unknown} record - Unknown versioned record; malformed/unknown-key/tampered forms share one rejection class.
     * @param {string} context - Expected verified application scope; mismatch cannot return plaintext.
     * @returns {Buffer} Authenticated plaintext, now caller-owned; caller controls retention and clearing.
     */
    decrypt(record: unknown, context: string): Buffer {
      ring.check();
      validateContext(context);
      /** Validated record fields or owned digest-input copy; private values never enter error text. */
      const data = fields(record, [
        'v',
        'alg',
        'kid',
        'iv',
        'tag',
        'ciphertext',
      ]);
      if (
        !data ||
        data.v !== 1 ||
        data.alg !== 'A256GCM' ||
        typeof data.kid !== 'string' ||
        !idPattern.test(data.kid)
      ) {
        throw new SecurityRecordError();
      }
      /** Selected copied key by authenticated public ID; absence follows the generic rejection path. */
      const key = ring.keys.get(data.kid);
      /** Fresh native 12-byte GCM nonce or validated stored IV; never derived from user identity. */
      const iv = decode(data.iv, 12, 12);
      /** Validated 16-byte native GCM authentication tag. */
      const tag = decode(data.tag, 16, 16);
      /** Canonical bounded ciphertext decoded before authentication. */
      const ciphertext = decode(data.ciphertext, ring.maximum);
      if (!key || !iv || !tag || !ciphertext) {
        throw new SecurityRecordError();
      }
      let decipher: crypto.DecipherGCM;
      try {
        decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
          authTagLength: 16,
        });
      } catch (cause) {
        throw new SecurityCryptoError(cause);
      }
      let pending: Buffer | undefined;
      try {
        decipher.setAAD(
          aad('zeruxjs.security.record', 1, 'A256GCM', data.kid, context)
        );
        decipher.setAuthTag(tag);
        pending = decipher.update(ciphertext);
        return Buffer.concat([pending, decipher.final()]);
      } catch {
        throw new SecurityRecordError();
      } finally {
        pending?.fill(0);
      }
    },
    destroy: ring.destroy,
  };
}

/** Create explicit native HMAC-SHA-256 authentication with copied keys and required context. Not encryption, public-key signatures or password hashing.
 * @param {MessageAuthenticatorOptions} options - Current/previous 32-byte keys and finite message budget.
 * @returns {object} Synchronous sign/verify owner; destroy releases copied key buffers.
 */
export function createMessageAuthenticator(
  options: MessageAuthenticatorOptions
) {
  if (options?.algorithm !== undefined && options.algorithm !== 'hmac-sha256') {
    throw new TypeError('Unsupported authentication algorithm');
  }
  /** Owned copied key state; destruction invalidates subsequent synchronous operations. */
  const ring = setup(options);
  /** Compute native HMAC over format/context metadata followed by bounded message bytes; always clears the owned message copy.
   * @param {string | Uint8Array} message - Caller-owned text/bytes copied for this operation.
   * @param {string} context - Required verified application scope.
   * @param {string} kid - Selected retained key identifier.
   * @returns {Buffer} Native HMAC bytes; native failures remain private causes.
   */
  function tag(
    message: string | Uint8Array,
    context: string,
    kid: string
  ): Buffer {
    validateContext(context);
    /** Owned copy of input bytes; cleared after native encryption/authentication completes or fails. */
    const input = bytes(message, ring.maximum);
    try {
      return crypto
        .createHmac('sha256', ring.keys.get(kid)!)
        .update(aad('zeruxjs.security.mac', 1, 'HS256', kid, context))
        .update(input)
        .digest();
    } catch (cause) {
      throw new SecurityCryptoError(cause);
    } finally {
      input.fill(0);
    }
  }
  return {
    /** Authenticate with the captured current key; retired keys never emit new records.
     * @param {string | Uint8Array} message - Bounded caller message, retained outside the authentication record.
     * @param {string} context - Required verified application scope.
     * @returns {MessageAuthentication} Versioned authentication metadata/tag; the message itself is not included.
     */
    sign(message: string | Uint8Array, context: string): MessageAuthentication {
      ring.check();
      return {
        v: 1,
        alg: 'HS256',
        kid: ring.current,
        tag: tag(message, context, ring.current).toString('base64url'),
      };
    },
    /** Verify canonical metadata/tag with a retained current or previous key. Invalid authentication returns false without a reason oracle.
     * @param {string | Uint8Array} message - Original bounded message supplied separately from the record.
     * @param {unknown} record - Unknown authentication metadata/tag.
     * @param {string} context - Expected verified application scope.
     * @returns {boolean} Whether native HMAC matches; invalid trusted configuration/context still throws.
     */
    verify(
      message: string | Uint8Array,
      record: unknown,
      context: string
    ): boolean {
      ring.check();
      validateContext(context);
      /** Validated record fields or owned digest-input copy; private values never enter error text. */
      const data = fields(record, ['v', 'alg', 'kid', 'tag']);
      if (
        !data ||
        data.v !== 1 ||
        data.alg !== 'HS256' ||
        typeof data.kid !== 'string' ||
        !idPattern.test(data.kid) ||
        !ring.keys.has(data.kid)
      ) {
        return false;
      }
      /** Received canonical 32-byte HMAC tag; malformed tags return false. */
      const actual = decode(data.tag, 32, 32);
      if (!actual) {
        return false;
      }
      /** Native context-bound HMAC under the selected retained key. */
      const expected = tag(message, context, data.kid);
      return crypto.timingSafeEqual(actual, expected);
    },
    destroy: ring.destroy,
  };
}

/** Compute an allowlisted native SHA-2 data digest and clear its owned input copy. Not a password KDF, MAC, signature or authorization decision.
 * @param {string | Uint8Array} input - Caller-owned text/bytes capped at 16 MiB.
 * @param {DigestAlgorithm} algorithm - sha256 default, or explicit sha384/sha512.
 * @returns {string} Hexadecimal native digest; unsupported algorithms/native errors reject.
 */
export function hashData(
  input: string | Uint8Array,
  algorithm: DigestAlgorithm = 'sha256'
): string {
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) {
    throw new TypeError('Unsupported digest algorithm');
  }
  /** Validated record fields or owned digest-input copy; private values never enter error text. */
  const data = bytes(input, 16 * 1024 * 1024);
  try {
    return crypto.createHash(algorithm).update(data).digest('hex');
  } catch (cause) {
    throw new SecurityCryptoError(cause);
  } finally {
    data.fill(0);
  }
}
/** Compare equal-length bounded byte inputs with native timingSafeEqual. Length/type checks remain observable; this does not make a whole request constant-time.
 * @param {Uint8Array} left - First borrowed byte array capped at 1 MiB.
 * @param {Uint8Array} right - Second borrowed byte array capped at 1 MiB.
 * @returns {boolean} False for invalid/different sizes; otherwise the native equal-length comparison.
 */
export function timingSafeEqualBytes(
  left: Uint8Array,
  right: Uint8Array
): boolean {
  if (
    !(left instanceof Uint8Array) ||
    !(right instanceof Uint8Array) ||
    left.byteLength > 1024 * 1024 ||
    right.byteLength > 1024 * 1024
  ) {
    return false;
  }
  return (
    left.byteLength === right.byteLength && crypto.timingSafeEqual(left, right)
  );
}
