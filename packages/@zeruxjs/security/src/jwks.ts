import {
  JwtVerificationError,
  validateJwtKey,
  type JwtKeySource,
  type JwtVerificationKey,
  type JwtRequest,
} from './jwt.js';
export interface JwtJwksOptions {
  /** One fixed configured HTTPS JWKS URL; never supplied by a token. */
  url: string;
  /** From one through eight exact approved HTTPS URLs; redirects are forbidden. */
  allowedUrls: readonly string[];
  /** Mandatory borrowed host transport with TLS/DNS/IP authorization and signal support. */
  transport: (url: string, init: RequestInit) => Promise<Response>;
  /** Finite fetch/caller timeout, default1000 ms and maximum10000. */
  timeoutMs?: number;
  /** Finite cached-key lifetime, default60000 ms and maximum600000. */
  cacheMs?: number;
  /** Unknown-kid refresh cooldown, default1000 ms and maximum60000. */
  cooldownMs?: number;
  /** Streamed response cap, default65536 bytes and maximum262144. */
  maxBytes?: number;
  /** Waiting caller cap, default32 and maximum256. */
  maxPending?: number;
}
/** Create one explicit allowlisted HTTPS public-key source with coalesced bounded refresh and fail-closed cache expiry. Host transport must enforce TLS/DNS/IP/egress; no network starts before an explicit lookup.
 * @param {JwtJwksOptions} options - Bounded URL/cache/transport policy; token-provided URLs and redirects are never accepted.
 * @returns {JwtKeySource & {getDiagnostics(): object, close(): Promise<void>}} Owned lookup/cache scope; close aborts/drains its accepted fetch without closing borrowed transports.
 */
export function createJwtJwks(options: JwtJwksOptions): JwtKeySource & {
  /** Read fixed lookup counts without endpoint URLs, tokens, keys or transport causes.
   * @returns {object} Closed/cache-count/in-flight-fetch metadata only.
   */
  getDiagnostics(): {
    /** Whether new lookup work is rejected. */
    closed: boolean;
    /** Current cached public-key count; key material is not exposed. */
    cachedKeys: number;
    /** Whether one actual refresh is unsettled. */
    pending: boolean;
  };
  /** Reject future lookups, request cooperative fetch cancellation and clear cached public-key references after actual settlement.
   * @returns {Promise<void>} Drained lookup scope; borrowed host transport/global pools remain open.
   */
  close(): Promise<void>;
} {
  /** Construct a fixed public unavailable category; raw transport causes remain trusted-host-only.
   * @param {unknown} cause - Optional private original failure.
   * @returns {JwtVerificationError} Fixed JWT_UNAVAILABLE failure with no public raw cause.
   */
  const unavailable = (cause?: unknown) =>
    new JwtVerificationError(
      'JWT_UNAVAILABLE',
      cause === undefined ? undefined : { cause }
    );
  /** Normalize the explicit HTTPS destination; this validates URL shape, not DNS/IP/egress authorization.
   * @param {unknown} value - Explicit configured URL candidate.
   * @returns {string} Normalized HTTPS URL without credentials, fragment or query.
   */
  const url = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 2048) {
      throw new TypeError('Invalid JWKS destination');
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError('Invalid JWKS destination');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    ) {
      throw new TypeError('Invalid JWKS destination');
    }
    return parsed.href;
  };
  if (
    !options ||
    typeof options !== 'object' ||
    !Array.isArray(options.allowedUrls) ||
    options.allowedUrls.length < 1 ||
    options.allowedUrls.length > 8 ||
    typeof options.transport !== 'function'
  ) {
    throw new TypeError('Invalid JWKS options');
  }
  /** Captured exact approved JWKS destination; token headers never select it. */
  const target = url(options.url);
  /** Normalized bounded host allowlist; no discovery or speculative fallback occurs. */
  const allowed = options.allowedUrls.map(url);
  if (!allowed.includes(target)) {
    throw new TypeError('JWKS destination denied');
  }
  /** Resolve a finite safe-integer policy bound before issuing any transport request.
   * @param {unknown} value - Optional explicit numeric setting.
   * @param {number} fallback - Default when the value is undefined.
   * @param {number} max - Inclusive hard maximum.
   * @param {number} min - Inclusive minimum, default one.
   * @returns {number} Validated finite integer; unsupported values throw.
   */
  const n = (value: unknown, fallback: number, max: number, min = 1) => {
    /** Resolved bounded numeric policy setting. */
    const result = value === undefined ? fallback : value;
    if (
      typeof result !== 'number' ||
      !Number.isSafeInteger(result) ||
      result < min ||
      result > max
    ) {
      throw new TypeError('Invalid JWKS limit');
    }
    return result;
  };
  /** Maximum waiting callers, distinct from the single in-flight refresh promise. */
  const cap = n(options.maxPending, 32, 256);
  /** Bounded native-fetch and caller observation timeout, default one second. */
  const timeout = n(options.timeoutMs, 1000, 10000);
  /** Explicit cache lifetime, default one minute; response headers cannot widen it. */
  const ttl = n(options.cacheMs, 60000, 600000);
  /** Finite unknown-key refresh cooldown to prevent fetch storms. */
  const cooldown = n(options.cooldownMs, 1000, 60000);
  /** Preparse streamed body byte ceiling; defaults64 KiB and caps at256 KiB. */
  const maxBytes = n(options.maxBytes, 65536, 262144);
  /** Borrowed mandatory host transport; owns TLS/DNS/IP authorization and cooperative cancellation. */
  const transport = options.transport;
  let waiters = 0;
  let closed = false,
    cache: JwtVerificationKey[] = [],
    expires = 0,
    nextRefresh = 0,
    pending: Promise<void> | undefined,
    controller: AbortController | undefined,
    closing: Promise<void> | undefined;
  /** Coalesce one refresh and enforce cooldown before transport. Reader/response/timer cleanup belongs to the actual native work, not merely caller observation.
   * @returns {Promise<void>} Settles after full bounded key validation and cleanup; failed refresh never authorizes stale expired keys.
   */
  function refresh(): Promise<void> {
    if (pending) {
      return pending;
    }
    if (Date.now() < nextRefresh) {
      return Promise.reject(unavailable());
    }
    nextRefresh = Date.now() + cooldown;
    /** Owned controller for the single accepted fetch; close/timeout request cancellation. */
    const active = new AbortController();
    controller = active;
    /** Actual refresh settlement promise retained until reader and response cleanup completes. */
    const work = Promise.resolve().then(async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        response: Response | undefined;
      let success = false;
      /** Cooperatively release a held response read when timeout/close aborts the fetch.
       * @returns {void} Requests reader cancellation without leaking native rejection text.
       */
      const cancelReader = () => {
        void reader?.cancel().catch(() => {});
      };
      active.signal.addEventListener('abort', cancelReader, { once: true });
      /** Owned fetch deadline timer removed in finally even after parse or validation failure. */
      const timer = setTimeout(() => active.abort(), timeout);
      try {
        response = await transport(target, {
          signal: active.signal,
          redirect: 'error',
          credentials: 'omit',
          headers: { accept: 'application/jwk-set+json, application/json' },
        });
        if (
          closed ||
          active.signal.aborted ||
          response.status !== 200 ||
          response.redirected ||
          (response.url && response.url !== target) ||
          !/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(
            response.headers.get('content-type') ?? ''
          )
        ) {
          throw unavailable();
        }
        /** Optional Content-Length checked before response streaming; actual bytes are still charged. */
        const declared = response.headers.get('content-length');
        if (
          declared !== null &&
          (!/^\d+$/.test(declared) || Number(declared) > maxBytes)
        ) {
          throw unavailable();
        }
        if (!response.body) {
          throw unavailable();
        }
        reader = response.body.getReader();
        let size = 0;
        /** Bounded retained response chunks; no parsing occurs before the byte ceiling is enforced. */
        const chunks: Uint8Array[] = [];
        // Charge each streamed chunk before retention or JSON/key evaluation.
        while (true) {
          if (closed || active.signal.aborted) {
            throw unavailable();
          }
          /** One owned-reader chunk charged before retention. */
          const part = await reader.read();
          if (part.done) {
            break;
          }
          size += part.value.byteLength;
          if (size > maxBytes) {
            throw unavailable();
          }
          chunks.push(part.value);
        }
        if (closed || active.signal.aborted) {
          throw unavailable();
        }
        /** Fatal UTF-8 decoded JSON envelope; only bounded public asymmetric key sets are accepted. */
        const body = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks, size)
          )
        ) as { keys?: unknown };
        if (
          !body ||
          !Array.isArray(body.keys) ||
          body.keys.length < 1 ||
          body.keys.length > 16
        ) {
          throw unavailable();
        }
        /** Validated unique-kid public signing-key snapshots; remote symmetric/private keys reject. */
        const keys = body.keys.map((key) => validateJwtKey(key, true));
        if (new Set(keys.map((k) => k.kid)).size !== keys.length) {
          throw unavailable();
        }
        cache = keys;
        expires = Date.now() + ttl;
        success = true;
      } catch (cause) {
        throw unavailable(cause);
      } finally {
        clearTimeout(timer);
        active.signal.removeEventListener('abort', cancelReader);
        if (!success) {
          active.abort();
          try {
            if (reader) {
              await reader.cancel();
            } else {
              await response?.body?.cancel();
            }
          } catch {
            /* Preserve the primary private failure. */
          }
        }
        reader?.releaseLock();
      }
    });
    pending = work;
    void work
      .finally(() => {
        if (pending === work) {
          pending = undefined;
          controller = undefined;
        }
      })
      .catch(() => {});
    return work;
  }
  return {
    /** Return independent validated public keys only for a current cached requested kid or a bounded successful refresh. Caller cancellation stops its wait, not another caller’s shared refresh.
     * @param {string} kid - Bounded explicit key label from a previously constrained JWT header.
     * @param {JwtRequest} request - Optional borrowed cooperative signal and absolute Unix-millisecond deadline.
     * @returns {Promise<readonly JwtVerificationKey[]>} Fresh validated key snapshots; unknown/expired/unavailable/closed lookups reject with fixed public categories.
     */
    async getKeys(kid: string, request: JwtRequest = {}) {
      if (closed) {
        throw new JwtVerificationError('JWT_CLOSED');
      }
      if (
        typeof kid !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(kid) ||
        !request ||
        typeof request !== 'object' ||
        (request.signal !== undefined &&
          !(request.signal instanceof AbortSignal)) ||
        (request.deadline !== undefined &&
          (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
      ) {
        throw unavailable();
      }
      request = { signal: request.signal, deadline: request.deadline };
      if (
        request.signal?.aborted ||
        (request.deadline !== undefined && request.deadline <= Date.now())
      ) {
        throw unavailable();
      }
      if (Date.now() < expires && cache.some((key) => key.kid === kid)) {
        return cache.map((key) => validateJwtKey(key, true));
      }
      if (waiters >= cap) {
        throw unavailable();
      }
      waiters++;
      /** Actual refresh settlement promise retained until reader and response cleanup completes. */
      const work = refresh();
      let timer: ReturnType<typeof setTimeout> | undefined,
        abort = () => {};
      try {
        await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            abort = () => reject(unavailable());
            request.signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(
              abort,
              Math.max(
                1,
                Math.min(timeout, (request.deadline ?? Infinity) - Date.now())
              )
            );
            if (request.signal?.aborted) {
              abort();
            }
          }),
        ]);
        if (
          closed ||
          Date.now() >= expires ||
          !cache.some((key) => key.kid === kid)
        ) {
          throw unavailable();
        }
        return cache.map((key) => validateJwtKey(key, true));
      } finally {
        waiters--;
        if (timer) {
          clearTimeout(timer);
        }
        request.signal?.removeEventListener('abort', abort);
      }
    },
    /** Read fixed lookup counts without endpoint URLs, tokens, keys or transport causes.
     * @returns {object} Closed/cache-count/in-flight-fetch metadata only.
     */
    getDiagnostics() {
      return { closed, cachedKeys: cache.length, pending: Boolean(pending) };
    },
    /** Reject future lookups, request cooperative fetch cancellation and clear cached public-key references after actual settlement.
     * @returns {Promise<void>} Drained lookup scope; borrowed host transport/global pools remain open.
     */
    close() {
      closed = true;
      controller?.abort();
      cache = [];
      return (closing ??= Promise.resolve().then(async () => {
        try {
          await pending;
        } catch {
          /* A failing fetch has already rejected its callers. */
        }
        cache = [];
      }));
    },
  };
}
