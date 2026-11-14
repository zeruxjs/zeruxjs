import { SignJWT, importJWK, type JWK } from 'jose';
import {
  validateJwtKey,
  JwtVerificationError,
  type JwtAlgorithm,
  type JwtVerificationKey,
} from './jwt.js';
export interface JwtSignerOptions {
  /** Explicit local signing JWK: symmetric secret or supported private asymmetric material. */
  key: JWK;
  /** Bounded public key ID included in the protected header; never secret material. */
  kid: string;
  /** One explicit supported JWT signature algorithm matching the supplied key. */
  algorithm: JwtAlgorithm;
  /** Exact configured issuer; custom claims cannot override it. */
  issuer: string;
  /** Exact configured audience; custom claims cannot override it. */
  audience: string;
  /** Exact configured protected-header typ. */
  type: string;
  /** Finite issued lifetime ceiling; defaults3600 seconds, maximum604800. */
  maxLifetimeSeconds?: number;
  /** Actual pending signing cap; defaults32, maximum256. */
  maxPending?: number;
  /** Trusted Unix-millisecond clock; defaults Date.now. */
  now?: () => number;
}
/** Create explicit bounded JOSE issuance using host-held signing material. Signed claims are readable, not encrypted, and token issuance never grants application authorization automatically.
 * @param {JwtSignerOptions} options - Explicit signing key/algorithm/kid/issuer/audience/type, finite lifetime/capacity and optional trusted clock.
 * @returns {object} Owned sign/close scope; no network starts and no secret is read implicitly.
 */
export function createJwtSigner(options: JwtSignerOptions) {
  /** Construct fixed issuance rejection without claim, token or key values.
   * @returns {JwtVerificationError} Fixed JWT_REJECTED category.
   */
  const deny = () => new JwtVerificationError('JWT_REJECTED');
  if (!options || !options.key || typeof options.key !== 'object') {
    throw deny();
  }
  /** Captured private JWK fields; close releases these owned references after pending signing settles. */
  const key = { ...options.key, alg: options.algorithm, kid: options.kid };
  if (
    (options.key.alg !== undefined && options.key.alg !== options.algorithm) ||
    (options.key.kid !== undefined && options.key.kid !== options.kid) ||
    (options.key.use !== undefined && options.key.use !== 'sig') ||
    (options.key.key_ops !== undefined &&
      (!Array.isArray(options.key.key_ops) ||
        options.key.key_ops.length !== 1 ||
        options.key.key_ops[0] !== 'sign'))
  ) {
    throw deny();
  }
  /** Verification-only metadata projection used to validate supported type/curve/algorithm before private import. */
  const publicPart = { ...key, key_ops: ['verify'] };
  // Verify only the public projection; private material is validated separately before signing.
  for (const name of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
    delete (publicPart as Record<string, unknown>)[name];
  }
  validateJwtKey(publicPart as JwtVerificationKey);
  /** Validate canonical bounded private JWK component encoding before native JOSE import.
   * @param {unknown} value - Candidate private JWK component.
   * @param {number} max - Maximum decoded bytes.
   * @param {number} exact - Optional exact supported component length.
   * @returns {void} Completes only for canonical supported material; malformed input rejects.
   */
  const privateBytes = (value: unknown, max: number, exact?: number) => {
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > Math.ceil((max * 4) / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw deny();
    }
    /** Canonical decoded private component used only to check byte length/round-trip encoding. */
    const bytes = Buffer.from(value, 'base64url');
    if (
      bytes.length > max ||
      (exact !== undefined && bytes.length !== exact) ||
      bytes.toString('base64url') !== value
    ) {
      throw deny();
    }
  };
  if (key.kty === 'RSA') {
    if (key.oth !== undefined) {
      throw deny();
    }
    // Require every supported RSA private component before JOSE signing import.
    for (const name of ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const) {
      privateBytes(key[name], 1024);
    }
  } else if (key.kty === 'EC') {
    /** Exact coordinate/private-scalar length for the declared supported EC curve. */
    let size: number;
    if (key.crv === 'P-256') {
      size = 32;
    } else if (key.crv === 'P-384') {
      size = 48;
    } else {
      size = 66;
    }
    privateBytes(key.d, size, size);
  } else if (key.kty === 'OKP') {
    privateBytes(key.d, 32, 32);
  }

  /** Bounded control-free issuer/audience/type/subject/JTI text predicate.
   * @param {unknown} value - Candidate configured/registered claim text.
   * @param {number} max - Character/UTF-8 limit; defaults512.
   * @returns {boolean} Whether the candidate is a bounded nonempty control-free string.
   */
  const text = (value: unknown, max = 512): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    Buffer.byteLength(value) <= max &&
    // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
    !/[\x00-\x1f\x7f]/.test(value);
  /** Maximum explicit issuance lifetime, default one hour and at most seven days. */
  const max =
    options.maxLifetimeSeconds === undefined
      ? 3600
      : options.maxLifetimeSeconds;
  /** Actual unsettled signing capacity, default32 and maximum256. */
  const cap = options.maxPending === undefined ? 32 : options.maxPending;
  /** Borrowed trusted Unix-millisecond clock; every issuance validates its output. */
  const now = options.now === undefined ? Date.now : options.now;
  if (
    !text(options.issuer) ||
    !text(options.audience) ||
    !text(options.type, 64) ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 604800 ||
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    cap > 256 ||
    typeof now !== 'function'
  ) {
    throw deny();
  }
  /** Captured exact issuer owned by configuration, never overridable through custom claims. */
  const issuer = options.issuer;
  /** Captured exact audience owned by configuration. */
  const audience = options.audience;
  /** Captured exact protected-header token type. */
  const type = options.type;
  /** Captured supported signature algorithm; no model/caller-selected fallback occurs. */
  const algorithm = options.algorithm;
  /** Captured bounded public signing-key label. */
  const kid = options.kid;
  let closed = false,
    closing: Promise<void> | undefined;
  /** Actual signing/import promises retained until settlement; close drains before releasing key references. */
  const pending = new Set<Promise<string>>();
  return {
    /** Validate bounded custom JSON claims, set registered claims from trusted configuration/input and sign through JOSE. Caller overrides of issuer/audience/time/JTI fields reject.
     * @param {Record<string, unknown>} claims - Custom public-readable inert JSON claim map under8-KiB/depth/node budgets.
     * @param {{ subject: string; ttlSeconds: number; jti?: string }} input - Explicit verified subject, finite requested lifetime and optional JTI.
     * @param {string} input.subject - Explicit verified subject value.
     * @param {number} input.ttlSeconds - Positive requested lifetime under configured maximum.
     * @param {string} input.jti - Optional bounded unique token identifier.
     * @returns {Promise<string>} Bounded signed compact JWT; failure retains only fixed public categories and private native causes.
     */
    sign(
      claims: Record<string, unknown>,
      input: {
        /** Explicit verified subject; setting it is not an authentication procedure. */
        subject: string;
        /** Explicit positive requested lifetime through the configured maximum. */
        ttlSeconds: number;
        /** Optional bounded caller-issued unique ID; replay protection belongs to a verification/store policy. */
        jti?: string;
      }
    ): Promise<string> {
      if (closed) {
        return Promise.reject(new JwtVerificationError('JWT_CLOSED'));
      }
      if (pending.size >= cap) {
        return Promise.reject(new JwtVerificationError('JWT_OVERLOAD'));
      }
      /** Actual one-shot bounded signing promise; no repair/tool loop or automatic side-effect replay. */
      const work = Promise.resolve()
        .then(async () => {
          if (
            !input ||
            !text(input.subject) ||
            !Number.isSafeInteger(input.ttlSeconds) ||
            input.ttlSeconds < 1 ||
            input.ttlSeconds > max ||
            (input.jti !== undefined && !text(input.jti, 256)) ||
            !claims ||
            typeof claims !== 'object' ||
            Array.isArray(claims) ||
            Object.keys(claims).some((name) =>
              [
                'iss',
                'aud',
                'sub',
                'exp',
                'iat',
                'nbf',
                'jti',
                '__proto__',
                'constructor',
                'prototype',
              ].includes(name)
            )
          ) {
            throw deny();
          }
          let nodes = 0,
            bytes = 0;
          /** Ancestor identities for bounded claim traversal; repeated noncyclic values remain valid. */
          const seen = new WeakSet<object>();
          /** Bound claim JSON shape/depth/nodes/bytes before native signing; this is not an arbitrary JavaScript sandbox.
           * @param {unknown} value - Current custom-claim candidate subtree.
           * @param {number} depth - Current nesting level, capped at12.
           * @returns {void} Completes only when this subtree satisfies finite JSON/ownership budgets.
           */
          const check = (value: unknown, depth: number): void => {
            if (++nodes > 256 || depth > 12) {
              throw deny();
            }
            if (typeof value === 'string') {
              if (
                value.length > 8192 ||
                (bytes += Buffer.byteLength(value)) > 8192
              ) {
                throw deny();
              }
              return;
            }
            if (
              value === null ||
              typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value))
            ) {
              return;
            }
            if (!value || typeof value !== 'object' || seen.has(value)) {
              throw deny();
            }
            seen.add(value);
            if (
              !Array.isArray(value) &&
              ![Object.prototype, null].includes(Object.getPrototypeOf(value))
            ) {
              throw deny();
            }
            /** Own descriptors inspected before reading each value; getters are not invoked by traversal. */
            const entries = Object.entries(
              Object.getOwnPropertyDescriptors(value)
            );
            if (entries.length > 128) {
              throw deny();
            }
            // Reject accessors and reserved names before reading any nested claim value.
            for (const [name, descriptor] of entries) {
              if (
                !('value' in descriptor) ||
                ['__proto__', 'prototype', 'constructor'].includes(name) ||
                name.length > 256 ||
                (bytes += Buffer.byteLength(name)) > 8192
              ) {
                throw deny();
              }
              check(descriptor.value, depth + 1);
            }
            seen.delete(value);
          };
          check(claims, 0);
          /** Validated bounded serialized custom claims, excluding caller overrides of registered fields. */
          const raw = JSON.stringify(claims);
          if (raw.length > 8192 || Buffer.byteLength(raw) > 8192) {
            throw deny();
          }
          /** Trusted clock reading validated before issuing integer NumericDates. */
          const timestamp = now();
          if (
            !Number.isSafeInteger(timestamp) ||
            timestamp < 0 ||
            timestamp > 253402300799000
          ) {
            throw deny();
          }
          /** Integer Unix seconds captured once for this token’s iat and explicit expiry. */
          const issued = Math.floor(timestamp / 1000);
          /** Independent JSON claim snapshot passed to JOSE; JWT content remains readable, not encrypted. */
          const payload = JSON.parse(raw);
          if (issued + input.ttlSeconds > 253402300799) {
            throw deny();
          }
          /** Native JOSE builder with fixed registered fields and protected header. */
          const signer = new SignJWT(payload)
            .setProtectedHeader({ alg: algorithm, kid, typ: type })
            .setIssuer(issuer)
            .setAudience(audience)
            .setSubject(input.subject)
            .setIssuedAt(issued)
            .setExpirationTime(issued + input.ttlSeconds);
          if (input.jti !== undefined) {
            signer.setJti(input.jti);
          }
          /** Bounded native signed compact token; output beyond16 KiB is rejected. */
          const result = await signer.sign(await importJWK(key, algorithm));
          if (result.length > 16384) {
            throw deny();
          }
          return result;
        })
        .catch((cause) => {
          if (cause instanceof JwtVerificationError) {
            throw cause;
          }
          throw new JwtVerificationError('JWT_REJECTED', { cause });
        });
      pending.add(work);
      void work.finally(() => pending.delete(work)).catch(() => {});
      return work;
    },
    /** Reject new issuance and wait for actual import/signing settlement before releasing copied key-field references. VM/native/string zeroization is not guaranteed.
     * @returns {Promise<void>} Idempotently drained signer; caller key objects remain borrowed and unchanged.
     */
    close() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        await Promise.allSettled([...pending]);
        // Pending native operations are finished before owned references are discarded.
        for (const name of Object.keys(key)) {
          delete (key as Record<string, unknown>)[name];
        }
      }));
    },
  };
}
