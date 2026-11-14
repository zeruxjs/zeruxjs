/** Server-only, application-owned route data caching. Never caches response headers/cookies. */
import { createHash, randomBytes } from 'node:crypto';
import type { CacheManager, CacheValue } from '@zeruxjs/cache';
import { cached, type CachedResult } from './response.js';
export interface RouteDataScope {
  /** Server-verified tenant scope; never accepted from an unauthenticated query alone. */
  tenant: string;
  /** Required for authenticated/personalized data. */ principal?: string;
}
export interface RouteDataKey {
  /** Stable authored route identity. */
  route: string;
  /** Validated public path without query, fragment or traversal. */
  path: string;
  /** Explicit validated route parameter strings. */
  params?: Record<string, string>;
  /** Bounded explicit locale dimension. */
  locale: string;
  /** Host-verified tenant/principal scope included in every cache identity. */
  scope: RouteDataScope;
}
export interface RouteDataPolicy {
  /** Positive freshness duration up to one day. */
  freshMs: number;
  /** Nonnegative stale allowance up to one day. */
  staleMs: number;
  /** Cache invalidation selectors scoped to application and tenant. */
  tags?: string[];
  /** Explicit opt-in for anonymous public data only. */ public?: boolean;
}
export interface RouteDataContext {
  /** Cooperative producer cancellation signal. */
  signal: AbortSignal;
  /** Host-clock producer deadline in Unix milliseconds. */
  deadline: number;
}
export interface RouteDataResult {
  /** Independent cloned JSON result value. */
  value: CacheValue;
  /** Explicit cache result state, not a durability guarantee. */
  state: 'fresh' | 'stale' | 'loaded';
  /** Project a cloned result through existing HTTP validator/cache policy behavior.
   * @returns {CachedResult} Response wrapper; no cookies or header bags are cached as route data.
   */
  response(): CachedResult;
}
export interface RouteDataCacheOptions {
  /** Private application namespace hashed before backend key construction. */
  application: string;
  /** Borrowed cache manager; closing route scope does not close it. */
  cache: CacheManager;
  /** Only process coordination is implemented; distributed requests reject. */
  coordination?: 'process' | 'distributed';
  /** Maximum process-local entry fences. */
  maxEntries?: number;
  /** Maximum actual pending read/refresh operations. */
  maxPending?: number;
  /** Cooperative producer deadline, not forced JavaScript cancellation. */
  timeoutMs?: number;
  /** Maximum serialized JSON bytes per value. */
  maxBytes?: number;
  /** Explicitly bypass backend reads while preserving validated owner/write behavior. */
  development?: boolean;
  /** Optional host clock for deterministic owner-local behavior. */
  now?: () => number;
}
/** Reject empty, excessive or control-containing cache identity fields without coercion.
 * @param {unknown} value - Untrusted runtime identity candidate.
 * @param {number} max - Maximum supported character count.
 * @returns {void} Validation completion; successful return narrows the candidate to string.
 */
function text(value: unknown, max = 256): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new TypeError('Invalid route cache identifier');
  }
}
/** Validate a positive safe integer cache budget.
 * @param {number} value - Candidate configured budget.
 * @param {number} max - Maximum supported value.
 * @returns {number} Validated positive integer.
 */
function integer(value: number, max: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError('Invalid route cache budget');
  }
  return value;
}
/** Hash an internally assembled JSON cache identity; hashing does not establish authorization.
 * @param {unknown} value - Validated internal identity tuple.
 * @returns {string} SHA-256 hexadecimal identity.
 */
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Build a deterministic scoped key from host-verified tenant/principal and explicit route facts.
 * @param {string} application - Verified application namespace.
 * @param {RouteDataKey} input - Validated route facts and host-verified authenticated scope.
 * @returns {string} Stable digest; caller input alone never proves scope authorization.
 */
export function routeDataCacheKey(
  application: string,
  input: RouteDataKey
): string {
  text(application);
  text(input.route);
  text(input.path, 2048);
  text(input.locale, 64);
  text(input.scope?.tenant);
  if (input.scope.principal !== undefined) {
    text(input.scope.principal);
  }
  if (
    !input.path.startsWith('/') ||
    input.path.includes('?') ||
    input.path.includes('#') ||
    input.path.includes('\\') ||
    input.path.split('/').some((x) => x === '.' || x === '..')
  ) {
    throw new TypeError('Invalid route cache path');
  }
  /** Explicit route parameters; own keys are sorted before key hashing. */
  const params = input.params ?? {};
  if (
    !params ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    Object.keys(params).length > 32
  ) {
    throw new TypeError('Invalid route cache parameters');
  }
  /** Bounded validated route key/value pairs in deterministic order. */
  const pairs = Object.keys(params)
    .sort()
    .map((k) => {
      text(k, 128);
      text(params[k], 2048);
      return [k, params[k]];
    });
  return digest([
    application,
    input.scope.tenant,
    input.scope.principal ?? null,
    input.route,
    input.path,
    input.locale,
    pairs,
  ]);
}
/** Create an explicit process-coordinated route-data owner borrowing a cache manager; distributed fencing is unavailable.
 * @param {RouteDataCacheOptions} options - Private application namespace, borrowed manager and resource ceilings.
 * @returns {object} Owned cache scope; await close before closing the borrowed manager.
 */
export function createRouteDataCache(options: RouteDataCacheOptions) {
  text(options.application);
  if (
    options.coordination !== undefined &&
    options.coordination !== 'process'
  ) {
    throw new TypeError(
      'Distributed invalidation requires an atomic fencing contract; unavailable'
    );
  }
  if (
    !options.cache ||
    typeof options.cache.get !== 'function' ||
    typeof options.cache.set !== 'function'
  ) {
    throw new TypeError('Invalid cache manager');
  }
  /** Validated process-local route-entry ceiling. */
  const maxEntries = integer(options.maxEntries ?? 1024, 100000);
  /** Validated ceiling covering actual cache reads and refresh work. */
  const maxPending = integer(options.maxPending ?? 16, 1024);
  /** Validated cooperative producer deadline in milliseconds. */
  const timeout = integer(options.timeoutMs ?? 5000, 60000);
  /** Validated serialized JSON byte ceiling for every returned/stored copy. */
  const maxBytes = integer(options.maxBytes ?? 1048576, 16777216);
  /** Explicit host clock or Date.now, retained per cache owner. */
  const now = options.now ?? Date.now;
  /** Application-hashed random generation namespace; no cross-process coordination is claimed. */
  const namespace = `rd:${digest(options.application)}:${randomBytes(16).toString('hex')}:`;
  /** Cache-owner shutdown signal propagated to accepted producers. */
  const shutdown = new AbortController();
  type Entry = {
    /** Opaque entry identity fencing in-flight refresh commits. */
    token: object;
    /** Random generation-scoped backend key; no raw route/principal labels. */
    storage: string;
    /** Server-verified tenant scope; never accepted from an unauthenticated query alone. */
    tenant: string;
    /** Validated public path without query, fragment or traversal. */
    path: string;
    /** Cache invalidation selectors scoped to application and tenant. */
    tags: string[];
    /** Digest of freshness, staleness, tags and publication policy. */
    policy: string;
  };
  /** Process-local key/token fences; invalidation removes authority rather than deleting arbitrary backend keys. */
  const entries = new Map<string, Entry>();
  /** Per-entry token refresh coalescing retained until actual settlement. */
  const pending = new Map<object, Promise<RouteDataResult>>();
  /** All accepted actual read/refresh work retained for capacity and close draining. */
  const work = new Set<Promise<unknown>>();
  let closed = false;
  /** Validate and clone bounded plain JSON without invoking accessors or preserving mutable result aliases.
   * @param {unknown} value - Untrusted producer/backend value.
   * @returns {CacheValue} Independent bounded JSON snapshot.
   */
  function copy(value: unknown): CacheValue {
    /** Current JSON recursion path used to reject cycles without rejecting repeated noncyclic references. */
    const seen = new Set<object>();
    /** Inspect own plain JSON recursively under cycle and depth constraints.
     * @param {unknown} v - Candidate nested value.
     * @param {number} depth - Current recursion depth, beginning at zero.
     * @returns {void} Validation completion without executing property accessors.
     */
    function check(v: unknown, depth: number): void {
      if (depth > 32) {
        throw new TypeError('Route data nesting exceeded');
      }
      if (
        v === null ||
        typeof v === 'string' ||
        typeof v === 'boolean' ||
        (typeof v === 'number' && Number.isFinite(v))
      ) {
        return;
      }
      if (!v || typeof v !== 'object' || seen.has(v)) {
        throw new TypeError('Route data must be public JSON');
      }
      if (
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      ) {
        throw new TypeError('Route data must be plain JSON');
      }
      seen.add(v);
      for (const key of Object.keys(v)) {
        /** Own property descriptor inspected without invoking accessors. */
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !('value' in d)) {
          throw new TypeError('Route data accessor denied');
        }
        check(d.value, depth + 1);
      }
      seen.delete(v);
    }
    check(value, 0);
    /** Bounded serializable plain JSON snapshot; typed/custom object values reject. */
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > maxBytes) {
      throw new RangeError('Route data budget exceeded');
    }
    return JSON.parse(json);
  }
  /** Create a result receipt that never exposes the stored snapshot by mutable reference.
   * @param {CacheValue} value - Validated JSON snapshot.
   * @param {RouteDataResult['state']} state - Explicit fresh/stale/loaded result state.
   * @param {boolean} isPublic - Anonymous explicit publication policy; stale results always pass false.
   * @param {number} fresh - Remaining freshness duration in milliseconds.
   * @returns {RouteDataResult} Receipt projecting copies and explicit HTTP cache policy.
   */
  function result(
    value: CacheValue,
    state: RouteDataResult['state'],
    isPublic: boolean,
    fresh: number
  ): RouteDataResult {
    /** Private cloned value copied again for every read/response projection. */
    const snapshot = copy(value);
    return {
      /** Read an independent copy rather than exposing stored mutable references.
       * @returns {CacheValue} Cloned bounded JSON snapshot.
       */
      get value() {
        return copy(snapshot);
      },
      state,
      response: () =>
        cached(
          copy(snapshot),
          isPublic
            ? {
                visibility: 'public',
                maxAge: Math.floor(fresh / 1000),
                etag: true,
              }
            : { visibility: 'no-store', etag: true }
        ),
    };
  }
  /** Cancel one caller’s wait without cancelling shared producer ownership or freeing actual-work capacity early.
   * @param {Promise<T>} job - Accepted actual operation.
   * @param {AbortSignal} signal - Optional caller wait cancellation.
   * @returns {Promise<T>} Caller-visible result/cancellation; shared work remains retained until settlement.
   */
  function wait<T>(job: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return job;
    }
    if (signal.aborted) {
      return Promise.reject(new Error('Route data cancelled'));
    }
    return new Promise((resolve, reject) => {
      /** Cooperative cancellation callback for caller wait or owned producer work.
       * @returns {void} Cancellation notification completion.
       */
      const abort = () => reject(new Error('Route data cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      job
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }
  return {
    coordination: 'process' as const,
    capabilities: options.cache.capabilities,
    /** Load scoped data, serving valid stale values while bounded refresh work runs without automatic outage fallback.
     * @param {RouteDataKey} input - Verified scope and validated route identity.
     * @param {RouteDataPolicy} policy - Explicit fresh/stale/tag/public policy.
     * @param {(context: RouteDataContext) => CacheValue | Promise<CacheValue>} producer - Trusted signal-aware data producer; side effects are not automatically retried.
     * @param {AbortSignal} signal - Optional individual caller cancellation.
     * @returns {Promise<RouteDataResult>} Independent result receipt or explicit invalidation/outage/capacity failure.
     */
    async load(
      input: RouteDataKey,
      policy: RouteDataPolicy,
      producer: (context: RouteDataContext) => CacheValue | Promise<CacheValue>,
      signal?: AbortSignal
    ): Promise<RouteDataResult> {
      if (closed) {
        throw new Error('Route cache closed');
      }
      signal?.throwIfAborted();
      /** Stable application/tenant/principal/route/locale/parameter digest from verified host scope. */
      const key = routeDataCacheKey(options.application, input);
      /** Validated freshness duration in milliseconds. */
      const fresh = integer(policy.freshMs, 86400000);
      if (
        !Number.isSafeInteger(policy.staleMs) ||
        policy.staleMs < 0 ||
        policy.staleMs > 86400000
      ) {
        throw new TypeError('Invalid stale window');
      }
      if (
        (policy.public !== undefined && typeof policy.public !== 'boolean') ||
        (policy.public && input.scope.principal !== undefined)
      ) {
        throw new TypeError('Personalized data cannot be public');
      }
      /** Deduplicated bounded cache invalidation tags; unrelated to tracking tag containers. */
      const tags = [...new Set(policy.tags ?? [])];
      if (!Array.isArray(policy.tags ?? []) || tags.length > 32) {
        throw new TypeError('Invalid cache tags');
      }
      for (const tag of tags) {
        text(tag, 128);
      }
      /** Validated stale allowance after freshness ends. */
      const stale = policy.staleMs;
      /** Explicit anonymous-only publication policy; personalized scopes reject public caching. */
      const isPublic = policy.public === true;
      /** Policy identity preventing reuse under a changed TTL/tag/public contract. */
      const fingerprint = digest([fresh, stale, tags.slice().sort(), isPublic]);
      let entry = entries.get(key);
      if (entry && entry.policy !== fingerprint) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        if (entries.size >= maxEntries) {
          entries.delete(entries.keys().next().value!);
        }
        entry = {
          token: {},
          storage: namespace + randomBytes(16).toString('hex'),
          tenant: digest(input.scope.tenant),
          path: input.path,
          tags,
          policy: fingerprint,
        };
        entries.set(key, entry);
      }
      /** Entry identity fence checked before and after backend write/read settlement. */
      const captured = entry;
      /** Coalesce one producer per captured entry while retaining its actual capacity and invalidation fence.
       * @returns {Promise<RouteDataResult>} Loaded result, or explicit capacity/cancellation/outage/invalidation failure.
       */
      const refresh = () => {
        let job = pending.get(captured.token);
        if (job) {
          return job;
        }
        if (work.size >= maxPending) {
          throw new Error('Route cache refresh capacity exceeded');
        }
        /** Refresh-owned cooperative cancellation owner, separate from an individual waiting caller. */
        const controller = new AbortController();
        /** Host-clock producer deadline supplied as context, not a forced cancellation guarantee. */
        const deadline = now() + timeout;
        /** Cooperative cancellation callback for caller wait or owned producer work.
         * @returns {void} Cancellation notification completion.
         */
        const abort = () => controller.abort();
        shutdown.signal.addEventListener('abort', abort, { once: true });
        /** Owned cooperative producer deadline timer cleared on actual settlement. */
        const timer = setTimeout(abort, timeout);
        job = (async () => {
          /** Validated bounded producer JSON snapshot before backend persistence. */
          const value = copy(
            await producer({ signal: controller.signal, deadline })
          );
          controller.signal.throwIfAborted();
          if (entries.get(key) !== captured) {
            throw new Error('Route data invalidated during refresh');
          }
          /** Host-clock successful producer completion time stored with the value. */
          const at = now();
          await options.cache.set(
            captured.storage,
            { version: 1, at, value },
            { ttlSeconds: Math.ceil((fresh + stale) / 1000) }
          );
          controller.signal.throwIfAborted();
          if (entries.get(key) !== captured) {
            throw new Error('Route data invalidated during refresh');
          }
          return result(value, 'loaded', isPublic, fresh);
        })();
        pending.set(captured.token, job);
        work.add(job);
        void job
          .finally(() => {
            clearTimeout(timer);
            shutdown.signal.removeEventListener('abort', abort);
            pending.delete(captured.token);
            work.delete(job!);
          })
          .catch(() => {});
        return job;
      };
      // A cache outage is explicit. Never call a producer as a silent outage fallback.
      if (work.size >= maxPending) {
        throw new Error('Route cache capacity exceeded');
      }
      /** Actual backend read tracked independently from caller cancellation. */
      const read = Promise.resolve().then(() =>
        options.development ? undefined : options.cache.get(captured.storage)
      );
      work.add(read);
      void read.finally(() => work.delete(read)).catch(() => {});
      /** Untrusted backend record checked for schema/time/value before reuse. */
      const raw = await wait(read, signal);
      signal?.throwIfAborted();
      if (closed) {
        throw new Error('Route cache closed');
      }
      if (entries.get(key) !== captured) {
        throw new Error('Route data invalidated during read');
      }
      if (raw !== undefined) {
        if (
          !raw ||
          typeof raw !== 'object' ||
          Array.isArray(raw) ||
          raw.version !== 1 ||
          typeof raw.at !== 'number' ||
          !Number.isFinite(raw.at) ||
          !('value' in raw)
        ) {
          throw new Error('Invalid route cache record');
        }
        /** Host-clock elapsed age; negative/future records are never treated as fresh. */
        const age = now() - raw.at;
        if (age >= 0 && age < fresh) {
          return result(raw.value, 'fresh', isPublic, fresh - age);
        }
        if (age >= fresh && age < fresh + stale) {
          try {
            void refresh().catch(() => {});
          } catch {
            /* Refresh admission can fail; serving the already-valid stale value remains allowed. */
          }
          return result(raw.value, 'stale', false, 0);
        }
      }
      return wait(refresh(), signal);
    },
    /** Invalidate matching process-local tenant fences; HTTP callers must authorize before invoking this server-only operation.
     * @param {object} input - Verified tenant and exactly one tag or path selector.
     * @param {string} input.tenant - Server-verified tenant authorized by the calling boundary.
     * @param {string} input.tag - Optional exact invalidation tag.
     * @param {string} input.path - Optional exact path, mutually exclusive with tag.
     * @returns {number} Removed entry fences; backend TTL cleanup and other processes remain separate.
     */
    invalidate(input: {
      /** Server-verified tenant scope; never accepted from an unauthenticated query alone. */
      tenant: string;
      tag?: string; /** Validated public path without query, fragment or traversal. */
      path?: string;
    }) {
      if (closed) {
        throw new Error('Route cache closed');
      }
      text(input.tenant);
      if ((input.tag === undefined) === (input.path === undefined)) {
        throw new TypeError('Select one tag or path');
      }
      if (input.tag !== undefined) {
        text(input.tag, 128);
      }
      if (input.path !== undefined) {
        text(input.path, 2048);
      }
      let count = 0;
      for (const [key, e] of entries) {
        if (
          e.tenant === digest(input.tenant) &&
          (input.tag !== undefined
            ? e.tags.includes(input.tag)
            : e.path === input.path)
        ) {
          entries.delete(key);
          count++;
        }
      }
      return count;
    },
    /** Read fixed owner-local capacity counters without identities or values.
     * @returns {{entries: number; pending: number}} Current retained entries and actual in-flight work.
     */
    status() {
      return { entries: entries.size, pending: work.size };
    },
    /** Reject new work, invalidate local fences, abort producer observation and drain actual accepted operations.
     * @returns {Promise<void>} Cache-owner settlement; the borrowed manager remains host-owned.
     */
    async close() {
      closed = true;
      shutdown.abort();
      entries.clear();
      await Promise.allSettled([...work]);
    },
  };
}
