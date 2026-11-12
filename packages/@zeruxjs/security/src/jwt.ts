import {
  decodeProtectedHeader,
  decodeJwt,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import { hashData } from './cryptography.js';
export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';
export type JwtVerificationKey = JWK & {
  /** Verified bounded public key identifier. */
  kid: string;
  /** Verified allowlisted signature algorithm. */
  alg: JwtAlgorithm;
};
export interface VerifiedJwt {
  /** Verified JOSE claims; business permission freshness remains host-owned. */
  payload: JWTPayload;
  /** Frozen verified algorithm/key/type metadata, never decoded-only identity. */
  protectedHeader: Readonly<{
    /** Verified allowlisted signature algorithm. */
    alg: JwtAlgorithm;
    /** Verified bounded public key identifier. */
    kid: string;
    /** Verified exact token type when present/required. */
    typ?: string;
  }>;
}
export interface JwtRequest {
  /** Optional borrowed cooperative cancellation signal. */
  signal?: AbortSignal;
  /** Optional absolute Unix-millisecond observation deadline. */
  deadline?: number;
}
export interface JwtKeySource {
  /** Resolve bounded public verification keys through one configured source. Token headers never choose an endpoint or bypass host egress policy.
   * @param {string} kid - Bounded constrained public key identifier.
   * @param {JwtRequest} request - Optional borrowed cancellation/deadline scope.
   * @returns {Promise<readonly JwtVerificationKey[]>} Independent validated public-key candidates; source/native failures remain explicit.
   */
  getKeys(
    kid: string,
    request?: JwtRequest
  ): Promise<readonly JwtVerificationKey[]>;
  /** Reject new verification, abort cooperative scopes, drain actual work and close only an explicitly owned JWKS source. Release local key references without promising VM/native zeroization.
   * @returns {Promise<void>} Drained verifier scope; borrowed sources/replay stores stay host-owned.
   */
  close?(): Promise<void> | void;
}
export interface JwtReplayStore {
  /** Atomically reserve a replay identity after signature/claim validation. Timeout may leave a committed reservation; do not automatically replay it.
   * @param {object} input - Opaque replay key and bounded Unix-millisecond expiry.
   * @param {string} input.key - Opaque validated replay identity digest.
   * @param {number} input.expiresAt - Finite replay retention expiry in Unix milliseconds.
   * @param {JwtRequest} request - Borrowed cooperative cancellation/deadline scope.
   * @returns {Promise<boolean>} True only for the first accepted reservation; false rejects replay.
   */
  consume(
    input: {
      /** Opaque replay accounting digest, never a raw JTI. */
      key: string;
      /** Absolute Unix-millisecond replay retention expiry. */
      expiresAt: number;
    },
    request: JwtRequest
  ): Promise<boolean>;
}
export interface JwtVerificationPolicy {
  /** Explicit bounded allowed signature algorithms; none and unsupported curves reject. */
  algorithms: readonly JwtAlgorithm[];
  /** Exact required issuer; no automatic provider discovery. */
  issuer: string;
  /** Exact required audience or bounded list of acceptable values. */
  audience: string | readonly string[];
  /** Expected exact/case-sensitive token type. */
  type: string;
  /** Bounded explicit required claim names; missing expiry is allowed only by declared policy. */
  requiredClaims: readonly string[];
  /** Explicit optional/required/exact subject policy; never infer tenant authorization. */
  subject:
    | 'optional'
    | 'required'
    | {
        /** Exact expected subject value when that host policy is selected. */
        equals: string;
      };
  /** Explicit optional/required/atomic-consume replay policy. */
  jti:
    | 'optional'
    | 'required'
    | {
        /** Application-owned atomic insert-if-absent replay store; ordinary get/set is insufficient. */
        consume: JwtReplayStore;
        /** Explicit replay retention ceiling through seven days. */
        maxTtlSeconds: number;
      };
  /** Require typ by default; explicit false permits absence, never a present wrong type. */
  requireType?: boolean;
  /** Optional declared token-age/future-iat policy; iat alone does not expire a token. */
  maxTokenAgeSeconds?: number;
  /** Explicit safe-integer tolerance, zero by default, at most120 seconds. */
  clockToleranceSeconds?: number;
  /** Trusted Unix-millisecond clock callback; defaults to Date.now. */
  now?: () => number;
}
/** Fixed public JWT outcome; private JOSE/key/network/replay causes must never be serialized to callers. */
export class JwtVerificationError extends Error {
  /** Create a fixed public JWT failure while retaining optional original causes only for trusted host diagnostics.
 * @param {| 'JWT_REJECTED'
      | 'JWT_UNAVAILABLE'
      | 'JWT_CLOSED'
      | 'JWT_OVERLOAD'} code - Fixed rejected/unavailable/closed/overload category.
 * @param {ErrorOptions} options - Optional private cause metadata; never serialize it to callers.
 */
  constructor(
    readonly code:
      | 'JWT_REJECTED'
      | 'JWT_UNAVAILABLE'
      | 'JWT_CLOSED'
      | 'JWT_OVERLOAD',
    options?: ErrorOptions
  ) {
    super(code.toLowerCase().replaceAll('_', ' '), options);
    this.name = 'JwtVerificationError';
  }
}
/** Construct a fixed verification rejection without token, claim, key or URL values.
 * @returns {JwtVerificationError} Fixed JWT_REJECTED error without private values.
 */
export const jwtRejected = () => new JwtVerificationError('JWT_REJECTED');
/** Explicit supported signed-JWT algorithm allowlist; none/experimental curves are excluded. */
const algorithms: readonly string[] = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

/** Bounded nonempty control-free policy/claim text predicate; does not authenticate its input.
 * @param {unknown} value - Candidate host policy or decoded claim text.
 * @param {number} max - Maximum character/UTF-8 length, default512.
 * @returns {boolean} Whether the text shape satisfies this bounded policy.
 */
const text = (value: unknown, max = 512): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  Buffer.byteLength(value) <= max &&
  // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
  !/[\x00-\x1f\x7f]/.test(value);
/** Decode only bounded canonical unpadded base64url key material before native import.
 * @param {unknown} value - Candidate JWK field; malformed syntax rejects without exposing values.
 * @param {number} max - Maximum decoded byte length for the declared key component.
 * @returns {Buffer} Canonical bounded decoded bytes.
 */
function binary(value: unknown, max: number): Buffer {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil((max * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw jwtRejected();
  }
  /** Canonical decoded key bytes checked before JOSE import. */
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length > max || decoded.toString('base64url') !== value) {
    throw jwtRejected();
  }
  return decoded;
}
/** Validate declared signing-key algorithm/type/curve/use before JOSE import. Remote verification rejects symmetric secrets and all asymmetric private fields.
 * @param {JwtVerificationKey} input - Explicit declared kid/algorithm JWK; ambiguous or unsupported metadata rejects.
 * @param {boolean} remote - True only for remote public-key sources; defaults false for explicit local keys.
 * @returns {JwtVerificationKey} Independent allowlisted verification-key projection; no token-provided URL is followed.
 */
export function validateJwtKey(
  input: JwtVerificationKey,
  remote = false
): JwtVerificationKey {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !algorithms.includes(input.alg) ||
    typeof input.kid !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.kid) ||
    (input.use !== undefined && input.use !== 'sig') ||
    (input.key_ops !== undefined &&
      (!Array.isArray(input.key_ops) ||
        input.key_ops.length !== 1 ||
        input.key_ops[0] !== 'verify'))
  ) {
    throw jwtRejected();
  }
  // Reject or strip private fields before treating a JWK as verification-only public material.
  for (const name of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
    if (name in input) {
      throw jwtRejected();
    }
  }
  if (input.alg.startsWith('HS')) {
    if (
      remote ||
      input.kty !== 'oct' ||
      binary(input.k, 128).length < Number(input.alg.slice(2)) / 8
    ) {
      throw jwtRejected();
    }
  } else if (input.alg.startsWith('RS') || input.alg.startsWith('PS')) {
    if (input.kty !== 'RSA') {
      throw jwtRejected();
    }
    /** Canonical RSA modulus bytes; leading-zero/size constraints are checked before import. */
    const n = binary(input.n, 1024);
    /** Canonical bounded RSA exponent bytes; exponent must be odd and at least three. */
    const e = binary(input.e, 8);
    /** Actual RSA modulus bit length rather than nominal encoded byte count. */
    const bits = n.length * 8 - (Math.clz32(n[0]) - 24);
    let exponent = 0n;
    // Decode the bounded RSA exponent exactly without floating-point precision loss.
    for (const byte of e) {
      exponent = (exponent << 8n) + BigInt(byte);
    }
    if (
      n[0] === 0 ||
      bits < 2048 ||
      bits > 8192 ||
      exponent < 3n ||
      exponent % 2n === 0n
    ) {
      throw jwtRejected();
    }
  } else if (input.alg.startsWith('ES')) {
    /** Fixed algorithm-to-curve/coordinate-length policy; mismatches reject before import. */
    const curve = {
      ES256: ['P-256', 32],
      ES384: ['P-384', 48],
      ES512: ['P-521', 66],
    }[input.alg as 'ES256' | 'ES384' | 'ES512']!;
    if (
      input.kty !== 'EC' ||
      input.crv !== curve[0] ||
      binary(input.x, 66).length !== curve[1] ||
      binary(input.y, 66).length !== curve[1]
    ) {
      throw jwtRejected();
    }
  } else if (
    input.kty !== 'OKP' ||
    input.crv !== 'Ed25519' ||
    binary(input.x, 32).length !== 32
  ) {
    throw jwtRejected();
  }
  // Only public signing metadata/material leaves this validator; no certificates/URLs are key selectors.
  /** Validated key metadata projected onto the supported public verification surface. */
  const data = input as unknown as Record<string, unknown>;
  /** Allowlisted key fields only; certificate/URL metadata never selects a key. */
  const names = [
    'kty',
    'kid',
    'alg',
    'use',
    'key_ops',
    ...(() => {
      if (input.kty === 'oct') {
        return ['k'];
      }
      if (input.kty === 'RSA') {
        return ['n', 'e'];
      }
      if (input.kty === 'EC') {
        return ['crv', 'x', 'y'];
      }
      return ['crv', 'x'];
    })(),
  ];
  return Object.fromEntries(
    names
      .filter((k) => data[k] !== undefined)
      .map((k) => [
        k,
        Array.isArray(data[k]) ? [...(data[k] as unknown[])] : data[k],
      ])
  ) as JwtVerificationKey;
}
/** Capture exact bounded verification policy and bind the borrowed atomic replay-store callback. Does not derive authorization from decoded claims.
 * @param {JwtVerificationPolicy} raw - Host-declared algorithms/issuer/audience/type/required claims, subject/JTI and trusted clock policy.
 * @returns {object} Captured explicit policy; unsupported requirements fail before verification work.
 */
function policy(raw: JwtVerificationPolicy) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray(raw.algorithms) ||
    !raw.algorithms.length ||
    raw.algorithms.length > 13 ||
    new Set(raw.algorithms).size !== raw.algorithms.length ||
    raw.algorithms.some((a) => !algorithms.includes(a)) ||
    !text(raw.issuer) ||
    !text(raw.type, 64) ||
    !Array.isArray(raw.requiredClaims) ||
    raw.requiredClaims.length > 32 ||
    raw.requiredClaims.some(
      (c) => !text(c, 64) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)
    )
  ) {
    throw new TypeError('Invalid JWT policy');
  }
  /** Captured bounded exact accepted audience list; query/header values cannot widen it. */
  const audience =
    typeof raw.audience === 'string' ? [raw.audience] : raw.audience;
  if (
    !Array.isArray(audience) ||
    !audience.length ||
    audience.length > 8 ||
    audience.some((a) => !text(a))
  ) {
    throw new TypeError('Invalid JWT audience');
  }
  if (raw.requireType !== undefined && typeof raw.requireType !== 'boolean') {
    throw new TypeError('Invalid JWT type policy');
  }
  if (
    raw.subject !== 'optional' &&
    raw.subject !== 'required' &&
    (!raw.subject ||
      typeof raw.subject !== 'object' ||
      !text(raw.subject.equals))
  ) {
    throw new TypeError('Invalid JWT subject policy');
  }
  if (
    raw.jti !== 'optional' &&
    raw.jti !== 'required' &&
    (!raw.jti ||
      typeof raw.jti !== 'object' ||
      typeof raw.jti.consume?.consume !== 'function' ||
      !Number.isSafeInteger(raw.jti.maxTtlSeconds) ||
      raw.jti.maxTtlSeconds < 1 ||
      raw.jti.maxTtlSeconds > 604800)
  ) {
    throw new TypeError('Invalid JWT replay policy');
  }
  /** Explicit bounded clock tolerance, default zero and maximum120 seconds. */
  const tolerance =
    raw.clockToleranceSeconds === undefined ? 0 : raw.clockToleranceSeconds;
  if (
    typeof tolerance !== 'number' ||
    !Number.isSafeInteger(tolerance) ||
    tolerance < 0 ||
    tolerance > 120 ||
    (raw.maxTokenAgeSeconds !== undefined &&
      (!Number.isSafeInteger(raw.maxTokenAgeSeconds) ||
        raw.maxTokenAgeSeconds < 1 ||
        raw.maxTokenAgeSeconds > 604800)) ||
    (raw.now !== undefined && typeof raw.now !== 'function')
  ) {
    throw new TypeError('Invalid JWT clock policy');
  }
  return {
    ...raw,
    algorithms: [...raw.algorithms],
    audience: [...audience],
    requiredClaims: [...raw.requiredClaims],
    subject: typeof raw.subject === 'object' ? { ...raw.subject } : raw.subject,
    jti:
      typeof raw.jti === 'object'
        ? {
            maxTtlSeconds: raw.jti.maxTtlSeconds,
            consume: { consume: raw.jti.consume.consume.bind(raw.jti.consume) },
          }
        : raw.jti,
    clockToleranceSeconds: tolerance,
  };
}
/** Create bounded signed-JWT verification over exactly one explicit static key set or configured JWKS source. Caller owns close; verification never automatically grants business permissions.
 * @param {{
  policy: JwtVerificationPolicy;
  keys?: readonly JwtVerificationKey[];
  jwks?: JwtKeySource;
  ownJwks?: boolean;
  timeoutMs?: number;
  maxPending?: number;
}} options - Explicit host verification/key-source policy and native pending/deadline bounds.
 * @param {JwtVerificationPolicy} options.policy - Captured exact signature/claim/replay policy.
 * @param {readonly JwtVerificationKey[]} options.keys - Optional static keys, exclusive with jwks.
 * @param {JwtKeySource} options.jwks - Optional explicit borrowed public-key source.
 * @param {boolean} options.ownJwks - Transfer source close ownership only with true.
 * @param {number} options.timeoutMs - Observation timeout, default2000 ms, maximum120000.
 * @param {number} options.maxPending - Actual unsettled work cap, default32, maximum256.
 * @returns {object} Owned verify/verifyWithHeader/diagnostics/close scope; imports start no transport.
 */
export function createJwtVerifier(options: {
  policy: JwtVerificationPolicy;
  /** Explicit static verification keys; choose these or jwks, never both. */
  keys?: readonly JwtVerificationKey[];
  /** Explicit configured key source; remote transport/egress remains host-owned. */
  jwks?: JwtKeySource;
  /** Close the source only when explicit true transfers ownership. */
  ownJwks?: boolean;
  /** Observation timeout default2000 ms, at most120000. */
  timeoutMs?: number;
  /** Actual native pending cap default32, at most256. */
  maxPending?: number;
}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Boolean(options.keys) === Boolean(options.jwks) ||
    (options.ownJwks !== undefined && typeof options.ownJwks !== 'boolean')
  ) {
    throw new TypeError('Choose static JWT keys or JWKS');
  }
  /** Captured verification policy; nested replay callback is bound to its host owner. */
  const config = policy(options.policy);
  /** Borrowed explicit JWKS source; native close transfers only with ownJwks true. */
  const source = options.jwks;
  /** Whether the host explicitly transfers JWKS source close ownership. */
  const own = options.ownJwks === true;
  if (source && typeof source.getKeys !== 'function') {
    throw new TypeError('Invalid JWKS source');
  }
  if (
    options.keys &&
    (!Array.isArray(options.keys) ||
      !options.keys.length ||
      options.keys.length > 16)
  ) {
    throw new TypeError('Invalid JWT keys');
  }
  /** Captured validated static key material; duplicate kids reject and close releases owned references. */
  const keys = options.keys?.map((key) => validateJwtKey(key));
  if (
    keys &&
    (!keys.length ||
      keys.length > 16 ||
      new Set(keys.map((k) => k.kid)).size !== keys.length)
  ) {
    throw new TypeError('Invalid JWT keys');
  }
  /** Maximum verification observation time; actual native work may outlive caller cancellation. */
  const timeout = options.timeoutMs === undefined ? 2000 : options.timeoutMs;
  /** Actual unsettled verification cap; timeout never releases native slots early. */
  const cap = options.maxPending === undefined ? 32 : options.maxPending;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000 ||
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    cap > 256
  ) {
    throw new TypeError('Invalid JWT limits');
  }
  let closed = false,
    closing: Promise<void> | undefined;
  /** Actual JOSE/JWKS/replay promises retained through settlement. */
  const pending = new Set<Promise<unknown>>();
  /** Owned cooperative per-verification scopes, aborted before close drains native work. */
  const controllers = new Set<AbortController>();
  /** Constrain header/key/claim shape, verify signature and declared claims through JOSE, then atomically consume JTI if configured. No side-effect replay occurs on timeout.
   * @param {string} token - Bounded signed compact JWT; content/keys never enter public diagnostics.
   * @param {JwtRequest} request - Optional caller cancellation and shortened absolute deadline.
   * @returns {Promise<VerifiedJwt>} Verified payload plus frozen approved alg/kid/typ metadata; application authorization remains separate.
   */
  async function verifyWithHeader(
    token: string,
    request: JwtRequest = {}
  ): Promise<VerifiedJwt> {
    if (closed) {
      throw new JwtVerificationError('JWT_CLOSED');
    }
    if (
      typeof token !== 'string' ||
      token.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      !request ||
      typeof request !== 'object' ||
      (request.signal !== undefined &&
        !(request.signal instanceof AbortSignal)) ||
      (request.deadline !== undefined &&
        (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
    ) {
      throw jwtRejected();
    }
    request = { signal: request.signal, deadline: request.deadline };
    if (pending.size >= cap) {
      throw new JwtVerificationError('JWT_OVERLOAD');
    }
    /** Owned request cancellation controller; not forced native/JavaScript termination. */
    const controller = new AbortController();
    /** Request cooperative cancellation while retaining native settlement ownership.
     * @returns {void} Requests cancellation; accepted native work still must settle.
     */
    const abort = () => controller.abort();
    /** Earliest configured/caller absolute verification deadline. */
    const deadline = Math.min(
      Date.now() + timeout,
      request.deadline ?? Infinity
    );
    if (request.signal?.aborted || deadline <= Date.now()) {
      throw new JwtVerificationError('JWT_UNAVAILABLE');
    }
    request.signal?.addEventListener('abort', abort, { once: true });
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined,
      cancel = () => {};
    /** Actual verification promise; header decoding alone never establishes identity. */
    const work = Promise.resolve().then(async () => {
      /** Fence asynchronous verification stages against close, cancellation and elapsed deadline.
       * @returns {void} Completes only while the verification scope remains active.
       */
      const check = () => {
        if (closed || controller.signal.aborted || Date.now() >= deadline) {
          throw new JwtVerificationError('JWT_UNAVAILABLE');
        }
      };
      check();
      /** Unverified constrained protected header used only to select declared algorithm/key/type policy. */
      const header = decodeProtectedHeader(token);
      if (
        Object.keys(header).some((k) => !['alg', 'kid', 'typ'].includes(k)) ||
        !config.algorithms.includes(header.alg as JwtAlgorithm) ||
        (header.typ === undefined
          ? config.requireType !== false
          : header.typ !== config.type) ||
        typeof header.kid !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(header.kid)
      ) {
        throw jwtRejected();
      }
      /** Unverified decoded claims used only for shape checks before signature verification. */
      const payload = decodeJwt(token);
      // Validate present NumericDates before native verification; decoded claims are still untrusted.
      for (const claim of ['exp', 'nbf', 'iat'] as const) {
        if (
          payload[claim] !== undefined &&
          (!Number.isSafeInteger(payload[claim]) ||
            payload[claim]! < 0 ||
            payload[claim]! > 253402300799)
        ) {
          throw jwtRejected();
        }
      }
      if (
        (payload.sub !== undefined && !text(payload.sub)) ||
        (payload.jti !== undefined && !text(payload.jti, 256)) ||
        (payload.nbf !== undefined &&
          payload.exp !== undefined &&
          payload.nbf >= payload.exp)
      ) {
        throw jwtRejected();
      }
      /** Trusted validated policy clock in Unix milliseconds; never token-supplied current time. */
      const now = config.now?.() ?? Date.now();
      if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799000) {
        throw new JwtVerificationError('JWT_UNAVAILABLE');
      }
      let candidates: readonly JwtVerificationKey[];
      try {
        candidates =
          keys ??
          (await source!.getKeys(header.kid, {
            signal: controller.signal,
            deadline,
          }));
      } catch (cause) {
        throw new JwtVerificationError('JWT_UNAVAILABLE', { cause });
      }
      check();
      if (!Array.isArray(candidates) || candidates.length > 16) {
        throw jwtRejected();
      }
      /** Exactly one declared kid/algorithm match must exist; ambiguous key selection rejects. */
      const matches = candidates.filter(
        (k) => k.kid === header.kid && k.alg === header.alg
      );
      if (matches.length !== 1) {
        throw jwtRejected();
      }
      /** Revalidated selected verification key; remote sources cannot supply symmetric/private material. */
      const jwk = validateJwtKey(matches[0], Boolean(source));
      /** Imported native JOSE verification key; algorithm/curve policy is already constrained. */
      const key = await importJWK(jwk, jwk.alg);
      check();
      /** Explicit required claims plus subject/JTI/expiry requirements implied by the selected policy. */
      const required = new Set(config.requiredClaims);
      if (config.subject !== 'optional') {
        required.add('sub');
      }
      if (config.jti !== 'optional') {
        required.add('jti');
      }
      if (typeof config.jti === 'object') {
        required.add('exp');
      }
      /** JOSE-verified payload; business permissions and current tenant authorization remain host-owned. */
      const verified = await jwtVerify(token, key, {
        algorithms: config.algorithms,
        issuer: config.issuer,
        audience: config.audience,
        ...(header.typ === undefined && config.requireType === false
          ? {}
          : { typ: config.type }),
        requiredClaims: [...required],
        clockTolerance: config.clockToleranceSeconds,
        currentDate: new Date(now),
        ...(config.maxTokenAgeSeconds === undefined
          ? {}
          : { maxTokenAge: config.maxTokenAgeSeconds }),
        ...(typeof config.subject === 'object'
          ? { subject: config.subject.equals }
          : {}),
      });
      check();
      if (typeof config.jti === 'object') {
        /** Bounded replay-record expiry derived only after signature/claim verification. */
        const expiresAt =
          (verified.payload.exp! + config.clockToleranceSeconds) * 1000;
        if (
          expiresAt <= now ||
          expiresAt - now > config.jti.maxTtlSeconds * 1000
        ) {
          throw jwtRejected();
        }
        let accepted: boolean;
        try {
          accepted = await config.jti.consume.consume(
            {
              key: hashData(
                JSON.stringify([
                  config.issuer,
                  config.audience,
                  config.type,
                  verified.payload.jti,
                ])
              ),
              expiresAt,
            },
            { signal: controller.signal, deadline }
          );
        } catch (cause) {
          throw new JwtVerificationError('JWT_UNAVAILABLE', { cause });
        }
        check();
        if (accepted !== true) {
          throw jwtRejected();
        }
      }
      return {
        payload: verified.payload,
        protectedHeader: Object.freeze({
          alg: header.alg as JwtAlgorithm,
          kid: header.kid,
          ...(header.typ === undefined ? {} : { typ: header.typ }),
        }),
      };
    });
    pending.add(work);
    void work
      .finally(() => {
        pending.delete(work);
        controllers.delete(controller);
      })
      .catch(() => {});
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          cancel = () => reject(new JwtVerificationError('JWT_UNAVAILABLE'));
          controller.signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
        }),
      ]);
    } catch (error) {
      if (error instanceof JwtVerificationError) {
        throw error;
      }
      throw new JwtVerificationError('JWT_REJECTED', { cause: error });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      controller.signal.removeEventListener('abort', cancel);
      request.signal?.removeEventListener('abort', abort);
    }
  }
  return {
    verifyWithHeader,
    /** Return only the verified payload while retaining the same bounded signature/claim/replay policy.
     * @param {string} token - Bounded signed compact JWT.
     * @param {JwtRequest} request - Optional caller cancellation/absolute deadline.
     * @returns {Promise<JWTPayload>} Verified claims; the host must separately validate application claim schema and current permissions.
     */
    async verify(token: string, request: JwtRequest = {}): Promise<JWTPayload> {
      return (await verifyWithHeader(token, request)).payload;
    },
    /** Read fixed verification lifecycle counters without tokens, claims, URLs or keys.
     * @returns {object} Frozen closed/pending counters.
     */
    getDiagnostics() {
      return Object.freeze({ closed, pending: pending.size });
    },
    /** Reject new verification, abort cooperative scopes, drain actual work and close only an explicitly owned JWKS source. Release local key references without promising VM/native zeroization.
     * @returns {Promise<void>} Drained verifier scope; borrowed sources/replay stores stay host-owned.
     */
    close() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        // Request cooperative cancellation before awaiting actual native settlement.
        for (const controller of controllers) {
          controller.abort();
        }
        await Promise.allSettled([...pending]);
        if (own) {
          await source?.close?.();
        }
        if (keys) {
          // Release copied symmetric key references after accepted verification work has settled.
          for (const key of keys) {
            if (key.k) {
              key.k = '';
            }
          }
        }
      }));
    },
  };
}
