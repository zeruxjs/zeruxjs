import { isIP } from 'node:net';
import { createMessageAuthenticator } from './cryptography.js';
export interface AtomicRateLimitClaim {
  /** Opaque43-character HMAC accounting key; raw identity must not reach the store. */
  key: string;
  /** Positive fixed-window milliseconds, at most one day. */
  windowMs: number;
  /** Positive weight allowance through one million. */
  max: number;
  /** Positive claim charge through one million; denial never consumes it. */
  weight: number;
}
export interface AtomicRateLimitDecision {
  /** Whether the entire weight was admitted. */
  allowed: boolean;
  /** Nonnegative remaining quota after the atomic decision. */
  remaining: number;
  /** Unix milliseconds when the store’s fixed window resets. */
  resetAt: number;
  /** Store-authoritative Unix milliseconds for reset/retry calculations. */
  now: number;
  /** Fixed allowed/rate/capacity category; orchestration also reports explicit outage/overload. */
  reason: 'allowed' | 'rate' | 'capacity';
}
export interface RateLimitRequest {
  /** Optional borrowed cooperative cancellation signal. */
  signal?: AbortSignal;
  /** Optional absolute Unix-millisecond deadline; not forced native cancellation. */
  deadline?: number;
}
/** Store operations must perform accounting, expiry and cardinality checks atomically. */
export interface AtomicRateLimitStore {
  /** Exact atomic-fixed-window-v1 accounting/expiry/cardinality capability. */
  readonly capability: 'atomic-fixed-window-v1';
  /** Explicit process/distributed accounting scope; memory is never distributed. */
  readonly scope: 'process' | 'distributed';
  /** Atomically validate/check/charge a fixed-window claim without consuming denied weight. A timeout may have consumed quota; callers must not replay automatically.
   * @param {AtomicRateLimitClaim} input - Validated opaque accounting tuple and positive quota/weight.
   * @param {RateLimitRequest} options - Optional cooperative deadline/cancellation scope.
   * @returns {Promise<AtomicRateLimitDecision>} Explicit allowed/rate/capacity decision with store time and reset metadata.
   */
  claim(
    input: AtomicRateLimitClaim,
    options?: RateLimitRequest
  ): Promise<AtomicRateLimitDecision>;
  /** Reject new operations and release this owner’s state. Cooperative native work drains before owned-store/key cleanup; borrowed dependencies stay host-owned.
   * @returns {void | Promise<void>} Completes cleanup; noncooperative accepted dependencies may delay asynchronous drain.
   */
  close?(): void | Promise<void>;
}
export interface EndpointRateLimitPolicy {
  /** Positive weight allowance through one million. */
  max: number;
  /** Positive fixed-window milliseconds, at most one day. */
  windowMs: number;
  /** Explicit host-selected outage behavior; it does not override quota/capacity denial. */
  failure: 'open' | 'closed';
}
export interface DistributedRateLimitResult extends Omit<
  AtomicRateLimitDecision,
  'reason'
> {
  /** Fixed allowed/rate/capacity category; orchestration also reports explicit outage/overload. */
  reason: AtomicRateLimitDecision['reason'] | 'store-error' | 'overload';
  /** 200 allowance,429 quota denial,503 capacity/outage denial. */
  status: 200 | 429 | 503;
  /** Bounded whole seconds; zero when allowed and at least one on denial. */
  retryAfterSeconds: number;
  /** Whether an explicit outage/overload policy rather than a native quota result was applied. */
  degraded: boolean;
}
export interface RateLimitMetric {
  /** Fixed configured endpoint label only; never append tenant/subject/IP. */
  endpoint: string;
  /** Fixed redacted decision category. */
  outcome: 'allowed' | 'denied' | 'capacity' | 'store-error' | 'overload';
  /** Monotonic observation duration without personal labels. */
  durationMs: number;
}
/** Fixed-category admission failure with no raw identity or backend payload in its public text. */
export class RateLimiterError extends Error {
  /** Construct a fixed-category rate-limit failure; private causes stay trusted-host-only.
   * @param {string} code - Fixed diagnostic code; never embed identities or raw backend values.
   * @param {ErrorOptions} options - Optional private native cause metadata.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code.toLowerCase().replaceAll('_', ' '), options);
    this.name = 'RateLimiterError';
  }
}
/** Construct a fixed-category admission error without recording identity or store inputs.
 * @param {string} code - Fixed public error category.
 * @returns {RateLimiterError} Error retaining no private input values.
 */
const fail = (code: string) => new RateLimiterError(code);
/** Validate the opaque key and finite fixed-window/weight budgets before touching a store.
 * @param {AtomicRateLimitClaim} value - Explicit claim with43-character opaque key and bounded positive integers.
 * @returns {void} Completes only after claim validation; malformed input throws.
 */
export function validateAtomicRateLimitClaim(
  value: AtomicRateLimitClaim
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.key !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.key) ||
    !Number.isSafeInteger(value.windowMs) ||
    value.windowMs < 1 ||
    value.windowMs > 86400000 ||
    !Number.isSafeInteger(value.max) ||
    value.max < 1 ||
    value.max > 1000000 ||
    !Number.isSafeInteger(value.weight) ||
    value.weight < 1 ||
    value.weight > 1000000
  ) {
    throw fail('INVALID_RATE_LIMIT_CLAIM');
  }
}
/** Create an explicit process-scoped atomic reference with lazy expiry and no eviction of live counters. This is not distributed or durable storage.
 * @param {{ maxKeys?: number; now?: () => number }} options - Optional finite live-key budget and trusted clock.
 * @param {number} options.maxKeys - Live-key cap, default 10000, at most 100000.
 * @param {() => number} options.now - Optional trusted Unix-millisecond clock.
 * @returns {AtomicRateLimitStore & {readonly size: number}} Owned local reference store; close clears counters and rejects subsequent claims.
 */
export function createMemoryRateLimitStore(
  options: {
    /** Finite reference-store live-key cap; defaults10000 and at most100000. */
    maxKeys?: number;
    now?: () => number;
  } = {}
): AtomicRateLimitStore & { readonly size: number } {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail('INVALID_RATE_LIMIT_STORE');
  }
  /** Validated process-local live-counter cap; no active subject is evicted to admit another. */
  const cap = options.maxKeys === undefined ? 10000 : options.maxKeys;
  if (
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    cap > 100000 ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw fail('INVALID_RATE_LIMIT_STORE');
  }
  /** Borrowed trusted clock, default Date.now; observations are validated and made nondecreasing. */
  const clock = options.now ?? Date.now;
  /** Owned process-local counters; the reference store never claims distributed durability. */
  const buckets = new Map<string, { count: number; reset: number }>();
  let closed = false,
    last = 0;
  /** Return validated nondecreasing store time for consistent fixed-window expiry.
   * @returns {number} Nondecreasing validated Unix milliseconds.
   */
  const stamp = () => {
    /** Trusted clock result validated before comparing expiry or calculating a new window. */
    const value = clock();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER - 86400000
    ) {
      throw fail('INVALID_RATE_LIMIT_CLOCK');
    }
    return (last = Math.max(last, value));
  };
  /** Lazily delete expired counters only; no live accounting is discarded.
   * @param {number} now - Validated store time captured for this operation.
   * @returns {void} Removes only expired process-local entries.
   */
  const prune = (now: number) => {
    // Expiry is lazy; never evict a live subject just to admit another.
    for (const [key, state] of buckets) {
      if (state.reset <= now) {
        buckets.delete(key);
      }
    }
  };
  return {
    capability: 'atomic-fixed-window-v1',
    scope: 'process',
    /** Atomically validate/check/charge a fixed-window claim without consuming denied weight. A timeout may have consumed quota; callers must not replay automatically.
     * @param {AtomicRateLimitClaim} input - Validated opaque accounting tuple and positive quota/weight.
     * @param {RateLimitRequest} request - Optional cooperative deadline/cancellation scope; defaults empty.
     * @returns {Promise<AtomicRateLimitDecision>} Explicit allowed/rate/capacity decision with store time and reset metadata.
     */
    async claim(input, request = {}) {
      if (closed) {
        throw fail('RATE_LIMIT_CLOSED');
      }
      validateAtomicRateLimitClaim(input);
      /** Validated reference-store time captured once for this atomic claim. */
      const now = stamp();
      if (
        !request ||
        typeof request !== 'object' ||
        (request.signal !== undefined &&
          !(request.signal instanceof AbortSignal)) ||
        (request.deadline !== undefined &&
          (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
      ) {
        throw fail('INVALID_RATE_LIMIT_REQUEST');
      }
      if (
        request.signal?.aborted ||
        (request.deadline !== undefined && request.deadline <= now)
      ) {
        throw fail('RATE_LIMIT_CANCELLED');
      }
      prune(now);
      let state = buckets.get(input.key);
      if (input.weight > input.max) {
        return {
          allowed: false,
          remaining: input.max,
          resetAt: state?.reset ?? now + input.windowMs,
          now,
          reason: 'rate',
        };
      }
      if (!state) {
        if (buckets.size >= cap) {
          return {
            allowed: false,
            remaining: 0,
            resetAt: [...buckets.values()].reduce(
              (earliest, v) => Math.min(earliest, v.reset),
              now + 86400000
            ),
            now,
            reason: 'capacity',
          };
        }
        state = { count: 0, reset: now + input.windowMs };
        buckets.set(input.key, state);
      }
      /** Complete weight admission decision; denied claims never consume quota. */
      const allowed = state.count + input.weight <= input.max;
      if (allowed) {
        state.count += input.weight;
      }
      return {
        allowed,
        remaining: Math.max(0, input.max - state.count),
        resetAt: state.reset,
        now,
        reason: allowed ? 'allowed' : 'rate',
      };
    },
    /** Reject new operations and release this owner’s state. Cooperative native work drains before owned-store/key cleanup; borrowed dependencies stay host-owned.
     * @returns {void | Promise<void>} Completes cleanup; noncooperative accepted dependencies may delay asynchronous drain.
     */
    close() {
      closed = true;
      buckets.clear();
    },
    get size() {
      prune(stamp());
      return buckets.size;
    },
  };
}
/** Trust one forwarded IP only from an exact configured direct proxy. Ignores untrusted forwarding headers; no CIDR or chain discovery is inferred.
 * @param {string} remoteAddress - Verified direct socket IP literal.
 * @param {{ trustedProxies?: readonly string[]; forwardedFor?: string }} options - Explicit trusted-proxy IPs and optional single forwarded IP.
 * @param {readonly string[]} options.trustedProxies - At most 32 exact configured direct-peer IPs.
 * @param {string} options.forwardedFor - Optional single trusted forwarded IP literal.
 * @returns {string} Verified direct or explicitly trusted forwarded IP; malformed trusted data rejects.
 */
export function resolveRateLimitIp(
  remoteAddress: string,
  options: {
    /** At most32 exact direct-proxy IP literals; no wildcard or header trust. */
    trustedProxies?: readonly string[];
    /** Single verified IP from an exact trusted peer; comma chains/ports reject. */
    forwardedFor?: string;
  } = {}
): string {
  if (
    typeof remoteAddress !== 'string' ||
    !isIP(remoteAddress) ||
    !options ||
    typeof options !== 'object' ||
    (options.trustedProxies !== undefined &&
      (!Array.isArray(options.trustedProxies) ||
        options.trustedProxies.length > 32 ||
        options.trustedProxies.some(
          (ip) => typeof ip !== 'string' || !isIP(ip)
        )))
  ) {
    throw fail('INVALID_RATE_LIMIT_ADDRESS');
  }
  if (!options.trustedProxies?.includes(remoteAddress)) {
    return remoteAddress;
  }
  if (options.forwardedFor === undefined) {
    return remoteAddress;
  }
  if (
    typeof options.forwardedFor !== 'string' ||
    options.forwardedFor.length > 64 ||
    !isIP(options.forwardedFor)
  ) {
    throw fail('INVALID_RATE_LIMIT_ADDRESS');
  }
  return options.forwardedFor;
}
/** Create explicit fixed-window endpoint admission over a negotiated atomic store and verified host identity. No fallback to independent local quotas is installed.
 * @param {{
  store: AtomicRateLimitStore;
  secret: Uint8Array;
  policies: Record<string, EndpointRateLimitPolicy>;
  requireDistributed?: boolean;
  ownStore?: boolean;
  maxPending?: number;
  timeoutMs?: number;
  onDecision?: (metric: Readonly<RateLimitMetric>) => void | Promise<void>;
}} options - Explicit shared atomic store, secret, endpoint policy, ownership, deadlines and redacted diagnostic hook.
 * @param {AtomicRateLimitStore} options.store - Explicit compatible atomic accounting owner.
 * @param {Uint8Array} options.secret - Private 32-byte host key copied by the authenticator.
 * @param {Record<string, EndpointRateLimitPolicy>} options.policies - Bounded explicit endpoint quota/outage rules.
 * @param {boolean} options.requireDistributed - Defaults true; false explicitly permits a local reference.
 * @param {boolean} options.ownStore - Transfer store close ownership only with explicit true.
 * @param {number} options.maxPending - Actual native pending cap, default 64, maximum 1024.
 * @param {number} options.timeoutMs - Observation timeout, default 1000 ms, maximum 120000.
 * @param {(metric: Readonly<RateLimitMetric>) => void | Promise<void>} options.onDecision - Optional borrowed redacted bounded diagnostic hook.
 * @returns {object} Owned asynchronous check/diagnostics/close scope; the host must close it before its dependencies.
 */
export function createDistributedRateLimiter(options: {
  /** Explicit compatible atomic accounting store; no get/set emulation. */
  store: AtomicRateLimitStore;
  /** Private host-owned32-byte HMAC secret, copied by the owned authenticator. */
  secret: Uint8Array;
  /** From one through32 named endpoint policies, captured before checks. */
  policies: Record<string, EndpointRateLimitPolicy>;
  /** Require distributed scope by default; local references need explicit false. */
  requireDistributed?: boolean;
  /** Close the store only when the host explicitly transfers ownership. */
  ownStore?: boolean;
  /** Actual native pending limit; defaults64, at most1024. */
  maxPending?: number;
  /** Caller observation timeout; defaults1000 ms, at most120000. */
  timeoutMs?: number;
  /** Borrowed fixed-label metric hook; bounded asynchronous backlog, no identity data. */
  onDecision?: (metric: Readonly<RateLimitMetric>) => void | Promise<void>;
}) {
  if (
    !options ||
    typeof options !== 'object' ||
    !options.store ||
    options.store.capability !== 'atomic-fixed-window-v1' ||
    !['process', 'distributed'].includes(options.store.scope) ||
    typeof options.store.claim !== 'function' ||
    !(options.secret instanceof Uint8Array) ||
    options.secret.byteLength !== 32 ||
    (options.requireDistributed !== undefined &&
      typeof options.requireDistributed !== 'boolean') ||
    (options.ownStore !== undefined && typeof options.ownStore !== 'boolean') ||
    (options.onDecision !== undefined &&
      typeof options.onDecision !== 'function')
  ) {
    throw fail('INVALID_RATE_LIMIT_OPTIONS');
  }
  if (
    options.requireDistributed !== false &&
    options.store.scope !== 'distributed'
  ) {
    throw fail('DISTRIBUTED_RATE_LIMIT_REQUIRED');
  }
  /** Captured bounded explicit endpoint policies; request values cannot select arbitrary policy. */
  const policies = new Map<string, EndpointRateLimitPolicy>();
  if (
    !options.policies ||
    typeof options.policies !== 'object' ||
    Array.isArray(options.policies) ||
    Object.keys(options.policies).length < 1 ||
    Object.keys(options.policies).length > 32
  ) {
    throw fail('INVALID_RATE_LIMIT_POLICIES');
  }
  // Capture every bounded policy before creating private key state or dispatching claims.
  for (const [name, policy] of Object.entries(options.policies)) {
    if (
      !/^[A-Za-z0-9_:/-]{1,64}$/.test(name) ||
      !policy ||
      typeof policy !== 'object' ||
      Array.isArray(policy) ||
      Object.keys(policy).some(
        (key) => !['max', 'windowMs', 'failure'].includes(key)
      ) ||
      !['open', 'closed'].includes(policy.failure)
    ) {
      throw fail('INVALID_RATE_LIMIT_POLICY');
    }
    validateAtomicRateLimitClaim({
      key: 'x'.repeat(43),
      max: policy.max,
      windowMs: policy.windowMs,
      weight: 1,
    });
    policies.set(name, { ...policy });
  }
  /** Actual native-store pending capacity; timeout cannot release unsettled claims. */
  const maxPending = options.maxPending === undefined ? 64 : options.maxPending;
  /** Maximum caller observation budget, further shortened by an explicit deadline. */
  const timeout = options.timeoutMs === undefined ? 1000 : options.timeoutMs;
  if (
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 1024 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000
  ) {
    throw fail('INVALID_RATE_LIMIT_LIMIT');
  }
  /** Borrowed atomic claim owner; native close transfers only with ownStore true. */
  const store = options.store;
  /** Whether the host explicitly transfers store close ownership to this limiter. */
  const own = options.ownStore === true;
  /** Borrowed redacted diagnostic hook; exceptions/overload are isolated and counted. */
  const hook = options.onDecision;
  /** Owned copied HMAC key snapshot; destroyed only after accepted native work drains. */
  const mac = createMessageAuthenticator({
    current: { id: 'rate-v1', key: options.secret },
    maxBytes: 4096,
  });
  /** Actual unsettled store claims, retained beyond caller timeout or cancellation. */
  const pending = new Set<Promise<unknown>>();
  /** Owned cooperative cancellation scopes for accepted claims. */
  const controllers = new Set<AbortController>();
  let closed = false,
    closing: Promise<void> | undefined,
    hookErrors = 0,
    hookPending = 0,
    hookDropped = 0;
  /** Bound asynchronous diagnostic work to fixed labels and isolate hook failures without identity data.
   * @param {RateLimitMetric} metric - Fixed configured endpoint/outcome/duration record only.
   * @returns {void} Schedules bounded hook observation without blocking an admission decision.
   */
  const emit = (metric: RateLimitMetric) => {
    if (!hook) {
      return;
    }
    if (hookPending >= 16) {
      hookDropped++;
      return;
    }
    try {
      /** Actual native-store or diagnostic promise; no implicit side-effect replay occurs. */
      const work = hook(Object.freeze(metric));
      if (work && typeof work.then === 'function') {
        hookPending++;
        void Promise.resolve(work)
          .catch(() => {
            hookErrors++;
          })
          .finally(() => {
            hookPending--;
          });
      }
    } catch {
      hookErrors++;
    }
  };
  return {
    /** Verify bounded host identity inputs, derive an opaque context-bound key, and observe one atomic claim. Admission never authenticates a principal or authorizes business actions.
     * @param {string} endpoint - Exact configured endpoint label.
     * @param {{ tenant: string; subject: string }} identity - Already server-verified tenant/subject; do not pass raw caller claims.
     * @param {string} identity.tenant - Server-verified tenant, not a raw caller header.
     * @param {string} identity.subject - Server-verified subject under that tenant.
     * @param {RateLimitRequest & { weight?: number }} request - Optional finite weight and cooperative deadline/cancellation.
     * @returns {Promise<DistributedRateLimitResult>} Redacted quota/outage result; initiating cancellation rejects even for fail-open endpoints.
     */
    async check(
      endpoint: string,
      identity: { tenant: string; subject: string },
      request: RateLimitRequest & {
        /** Positive claim charge through one million; denial never consumes it. */
        weight?: number;
      } = {}
    ): Promise<DistributedRateLimitResult> {
      if (closed) {
        throw fail('RATE_LIMIT_CLOSED');
      }
      /** Selected captured endpoint quota/outage policy, independent of untrusted identity fields. */
      const policy = policies.get(endpoint);
      if (
        !policy ||
        !identity ||
        [identity.tenant, identity.subject].some(
          (v) =>
            typeof v !== 'string' ||
            !v.length ||
            // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
            /[\x00-\x1f\x7f]/.test(v) ||
            Buffer.byteLength(v) > 512
        ) ||
        !request ||
        typeof request !== 'object' ||
        (request.signal !== undefined &&
          !(request.signal instanceof AbortSignal)) ||
        (request.deadline !== undefined &&
          (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
      ) {
        throw fail('INVALID_RATE_LIMIT_REQUEST');
      }
      /** Opaque HMAC-bound policy/tenant/subject tuple; the store receives no raw identity. */
      const claim = {
        key: mac.sign(
          JSON.stringify([
            endpoint,
            policy.max,
            policy.windowMs,
            identity.tenant,
            identity.subject,
          ]),
          'rate-limit-v1'
        ).tag,
        windowMs: policy.windowMs,
        max: policy.max,
        weight: request.weight === undefined ? 1 : request.weight,
      };
      validateAtomicRateLimitClaim(claim);
      /** Monotonic observation timestamp for a fixed-label redacted metric. */
      const start = performance.now();
      /** Owned per-claim cooperative cancellation controller. */
      const controller = new AbortController();
      /** Request cooperative cancellation; JavaScript/native completion is still owned until settlement.
       * @returns {void} Requests cancellation of this actual native scope.
       */
      const abort = () => controller.abort();
      /** Earliest explicit/default absolute observation deadline. */
      const deadline = Math.min(
        Date.now() + timeout,
        request.deadline ?? Infinity
      );
      let timer: ReturnType<typeof setTimeout> | undefined,
        cancel = () => {};
      /** Apply only the declared open/closed outage policy; capacity denial never becomes fail-open.
       * @param {boolean} overload - Whether actual pending capacity, rather than the store, is unavailable.
       * @returns {DistributedRateLimitResult} Explicit degraded policy result; closed owners never fail open.
       */
      const unavailable = (overload = false): DistributedRateLimitResult => {
        emit({
          endpoint,
          outcome: overload ? 'overload' : 'store-error',
          durationMs: performance.now() - start,
        });
        /** Complete weight admission decision; denied claims never consume quota. */
        const allowed = !closed && policy.failure === 'open';
        return {
          allowed,
          remaining: 0,
          resetAt: Date.now() + 1000,
          now: Date.now(),
          reason: overload ? 'overload' : 'store-error',
          status: allowed ? 200 : 503,
          retryAfterSeconds: allowed ? 0 : 1,
          degraded: true,
        };
      };
      if (request.signal?.aborted || deadline <= Date.now()) {
        throw fail('RATE_LIMIT_CANCELLED');
      }
      if (pending.size >= maxPending) {
        return unavailable(true);
      }
      request.signal?.addEventListener('abort', abort, { once: true });
      controllers.add(controller);
      /** Actual native-store or diagnostic promise; no implicit side-effect replay occurs. */
      const work = Promise.resolve().then(() => {
        if (controller.signal.aborted || closed) {
          throw fail('RATE_LIMIT_CANCELLED');
        }
        return store.claim(claim, { signal: controller.signal, deadline });
      });
      pending.add(work);
      void work
        .finally(() => {
          pending.delete(work);
          controllers.delete(controller);
        })
        .catch(() => {});
      try {
        /** Validated explicit store outcome; arbitrary provider fields never escape to callers. */
        const result = await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            cancel = () => reject(fail('RATE_LIMIT_CANCELLED'));
            controller.signal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
          }),
        ]);
        if (Date.now() >= deadline) {
          throw fail('RATE_LIMIT_CANCELLED');
        }
        if (
          typeof result?.allowed !== 'boolean' ||
          !Number.isSafeInteger(result.remaining) ||
          result.remaining < 0 ||
          result.remaining > policy.max ||
          !Number.isSafeInteger(result.now) ||
          result.now < 0 ||
          !Number.isSafeInteger(result.resetAt) ||
          result.resetAt <= result.now ||
          result.resetAt - result.now > 86400000 ||
          !['allowed', 'rate', 'capacity'].includes(result.reason) ||
          result.allowed !== (result.reason === 'allowed')
        ) {
          throw fail('INVALID_RATE_LIMIT_RESULT');
        }
        emit({
          endpoint,
          outcome: (() => {
            if (result.allowed) {
              return 'allowed';
            }
            if (result.reason === 'capacity') {
              return 'capacity';
            }
            return 'denied';
          })(),
          durationMs: performance.now() - start,
        });
        return {
          allowed: result.allowed,
          remaining: result.remaining,
          resetAt: result.resetAt,
          now: result.now,
          reason: result.reason,
          status: (() => {
            if (result.allowed) {
              return 200;
            }
            if (result.reason === 'capacity') {
              return 503;
            }
            return 429;
          })(),
          retryAfterSeconds: result.allowed
            ? 0
            : Math.max(1, Math.ceil((result.resetAt - result.now) / 1000)),
          degraded: false,
        };
      } catch {
        if (request.signal?.aborted) {
          throw fail('RATE_LIMIT_CANCELLED');
        }
        if (closed) {
          throw fail('RATE_LIMIT_CLOSED');
        }
        return unavailable();
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        controller.signal.removeEventListener('abort', cancel);
        request.signal?.removeEventListener('abort', abort);
      }
    },
    /** Read fixed-label process counters without identities, IPs, keys or raw backend causes.
     * @returns {object} Frozen closed/pending/hook failure/backlog counters.
     */
    getDiagnostics() {
      return Object.freeze({
        closed,
        pending: pending.size,
        hookErrors,
        hookPending,
        hookDropped,
      });
    },
    /** Reject new operations and release this owner’s state. Cooperative native work drains before owned-store/key cleanup; borrowed dependencies stay host-owned.
     * @returns {void | Promise<void>} Completes cleanup; noncooperative accepted dependencies may delay asynchronous drain.
     */
    close() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        // Request cooperative cancellation before awaiting actual native settlement.
        for (const controller of controllers) {
          controller.abort();
        }
        await Promise.allSettled([...pending]);
        try {
          if (own) {
            await store.close?.();
          }
        } finally {
          mac.destroy();
        }
      }));
    },
  };
}
/** Translate a reviewed admission decision to a private safe denial response. Accepted requests continue through the authenticated host handler.
 * @param {DistributedRateLimitResult} result - Validated limiter result; success must use200 and denial must use429/503.
 * @returns {Response | undefined} Undefined for allowance, otherwise no-store JSON with bounded Retry-After.
 */
export function rateLimitHttpResponse(
  result: DistributedRateLimitResult
): Response | undefined {
  if (
    !result ||
    typeof result !== 'object' ||
    typeof result.allowed !== 'boolean' ||
    (result.allowed && result.status !== 200)
  ) {
    throw fail('INVALID_RATE_LIMIT_RESPONSE');
  }
  if (result.allowed) {
    return undefined;
  }
  if (
    ![429, 503].includes(result.status) ||
    !Number.isSafeInteger(result.retryAfterSeconds) ||
    result.retryAfterSeconds < 1 ||
    result.retryAfterSeconds > 86400
  ) {
    throw fail('INVALID_RATE_LIMIT_RESPONSE');
  }
  return Response.json(
    {
      error: {
        code: result.status === 429 ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE',
      },
    },
    {
      status: result.status,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    }
  );
}
