import { timingSafeEqual } from 'node:crypto';
import type { AnalyticsManager } from './manager.js';
import type { AnalyticsEventInput } from './types.js';
import { validateEvent } from './validation.js';
import {
  createRequestId,
  requestUtcDay,
  validRequestId,
} from './request-id.js';
import type { RequestIdStore } from './request-id.js';
/** Explicit collection boundary settings; browser origin acceptance never grants tenant administration. */
export interface CollectorOptions {
  /** Borrowed analytics manager; collector never owns database or service shutdown. */
  analytics: AnalyticsManager;
  /** Atomic per-day reservation store; supply a shared durable implementation on replicas. */
  requestIdStore?: RequestIdStore;
  /** Reject requests with no client-generated correlation ID. */
  requireRequestId?: boolean;
  /** Allow CORS-simple text/plain JSON for sendBeacon; only enable on origin-checked tag collectors. */
  allowTextPlainBeacon?: boolean;
  /** Optional tag-manager pipeline. Replaces direct analytics.track in this collector. */
  dispatch?: (
    input: AnalyticsEventInput,
    context: {
      /** Opaque correlation identity; reservation and event persistence remain distinct outcomes. */
      requestId: string; /** Trusted server UTC day attached to this correlation/dispatch context. */
      utcDay: string; /** Observed request origin; configured allowlist grants collection only, never administrator permission. */
      origin?: string;
    }
  ) => Promise<unknown>;
  /** Collector mount prefix, default /_analytics; root/traversal prefixes reject. */
  prefix?: string;
  /** Exact origins; '*' is deliberately unsupported when browser collection is enabled. */
  allowedOrigins?: readonly string[];
  /** Server-to-server bearer token; required for requests without an allowed Origin. */
  serverToken?: string;
  /** Body byte ceiling, default 16384, within 256 through 65536. */
  maxBodyBytes?: number;
  /** Maximum wall-clock time allowed to receive and decode a request body. */
  bodyTimeoutMs?: number;
  /** Concurrent parsing waits, default 64; native reader cancellation remains cooperative. */
  maxConcurrentReads?: number;
  /** Process-local per-origin/server admission rate, default 120, within 1 through 10000. */
  maxEventsPerMinute?: number;
  /** Respond promptly even if the database operation is stalled. */
  storageTimeoutMs?: number;
  /** Prevent indefinitely pending database operations accumulating unboundedly. */
  maxPendingEvents?: number;
  /** Hard tenant binding for public origins; supplied browser site may not override mapping. */
  siteByOrigin?: Record<string, string>;
  /** When true, unknown-consent browser events are ignored without writing. */
  requireBrowserConsent?: boolean;
  /** Optional conservative known crawler, prefetch and link preview filtering for browser events. */
  botPolicy?: 'allow' | 'drop-known';
}
/**
 * Build an uncacheable collector error response using selected public message text.
 * @param {number} status - Explicit response status selected by the collector failure path.
 * @param {string} error - Selected public message; never intentionally pass private body or secret values.
 * @param {Record<string, string>} cors - Response-local exact-origin CORS headers, default empty. Defaults to {}.
 * @returns {Response} JSON response carrying the supplied status and allowed CORS headers.
 */
const json = (
  status: number,
  error: string,
  cors: Record<string, string> = {}
) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
/**
 * Compare equal-length secret bytes without a value-dependent native comparison.
 * @param {string} a - Received/configured secret value, retained only for this local comparison.
 * @param {string} b - Comparison secret value, never exposed in the response.
 * @returns {boolean} Equality result; neither secret is logged or included in a response.
 */
function sameSecret(a: string, b: string) {
  /** First secret’s UTF-8 bytes; compare only equal-length buffers with the native constant-time primitive. */
  const aa = Buffer.from(a);
  /** Configured/received comparison bytes stay local and are never included in responses. */
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
/**
 * Read a bounded request body under one absolute deadline without indefinitely waiting on cancellation.
 * @param {Request} request - Incoming Fetch request; method, origin, tenant and body remain untrusted.
 * @param {number} max - Configured byte/character ceiling for this owning validation path.
 * @param {number} timeoutMs - Absolute receive/decode deadline in milliseconds, not a resettable idle timeout.
 * @param {unknown} allowTextPlain - Explicit beacon compatibility opt-in; origin and body validation remain mandatory. Defaults to false.
 * @returns {Promise<unknown>} Parsed JSON; status-coded size/type/timeout/parse failures propagate.
 */
async function boundedJson(
  request: Request,
  max: number,
  timeoutMs: number,
  allowTextPlain = false
): Promise<unknown> {
  /** Existing JSON/text prefix policy is checked before acquiring the request-body reader. */
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (
    !contentType.startsWith('application/json') &&
    !(allowTextPlain && contentType.startsWith('text/plain'))
  ) {
    throw Object.assign(new Error('Unsupported type'), { status: 415 });
  }
  /** Declared length can reject early; cumulative streamed-byte enforcement remains authoritative. */
  const indicated = request.headers.get('content-length');
  if (
    indicated !== null &&
    /^\d+$/.test(indicated) &&
    Number(indicated) > max
  ) {
    throw Object.assign(new Error('Request exceeds limit'), { status: 413 });
  }
  if (!request.body) {
    throw Object.assign(new Error('Missing body'), { status: 400 });
  }
  /** Exclusive body reader; timeout cancellation is best effort so hostile streams cannot stall a response. */
  const reader = request.body.getReader();
  let n = 0;
  /** Retained fragments are charged to the cumulative body budget before insertion. */
  const parts: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** One absolute read deadline also bounds slow-drip streams; it is not reset for every chunk. */
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error('Request body timeout'), { status: 408 })
        ),
      timeoutMs
    );
  });
  try {
    // Read bounded chunks while checking parser cancellation and total byte limits.
    while (true) {
      // One absolute deadline bounds a slow-drip stream as well as an idle one.
      /** One reader outcome is raced against the existing absolute deadline. */
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) {
        break;
      }
      n += value.byteLength;
      if (n > max) {
        throw Object.assign(new Error('Request exceeds limit'), {
          status: 413,
        });
      }
      parts.push(value);
    }
  } catch (error) {
    // Cancellation is best effort; waiting for an uncooperative stream's
    // cancellation would defeat the response deadline.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    try {
      reader.releaseLock();
    } catch {
      /* A hostile stream may still be canceling. */
    }
  }
  try {
    return JSON.parse(
      Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8')
    );
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}
/**
 * Create an inert Fetch collector with instance-local admission, origin/site and best-effort dispatch bounds.
 * @param {CollectorOptions} options - Host-owned configuration; nested declarations describe bounds, consent and borrowed resources.
 * @returns {object} Path/handler/routes descriptors; host owns endpoint registration, auth policy and service shutdown.
 * @throws {TypeError | RangeError} Invalid origin/site configuration, mount path or admission policy rejects before registration.
 */
export function createAnalyticsCollector(options: CollectorOptions) {
  /** Configured mount path has its trailing slash removed before route validation. */
  const prefix = (options.prefix ?? '/_analytics').replace(/\/$/, '');
  if (options.requireRequestId && !options.requestIdStore) {
    throw new TypeError('Request ID reservation store required');
  }
  if (!prefix.startsWith('/') || prefix === '/' || prefix.includes('..')) {
    throw new TypeError('Invalid analytics prefix');
  }
  /** Maximum body bytes, default 16384, validated within 256 through 65536. */
  const max = options.maxBodyBytes ?? 16_384;
  /** Per-origin/server minute ceiling, default 120; this is process-local admission, not distributed abuse control. */
  const rate = options.maxEventsPerMinute ?? 120;
  /** Absolute body read/decode wait in milliseconds, default 3000, from 10 through 60000. */
  const bodyTimeout = options.bodyTimeoutMs ?? 3000;
  /** Concurrent body-parser ceiling, default 64, from 1 through 1000 per instance. */
  const maxReads = options.maxConcurrentReads ?? 64;
  /** Caller-facing storage wait, default 350 milliseconds, from 10 through 10000. */
  const timeoutMs = options.storageTimeoutMs ?? 350;
  /** Actual unsettled dispatch/storage ceiling, default 64, from 1 through 1000. */
  const maxPending = options.maxPendingEvents ?? 64;
  if (
    !Number.isSafeInteger(max) ||
    max < 256 ||
    max > 65536 ||
    !Number.isSafeInteger(rate) ||
    rate < 1 ||
    rate > 10000 ||
    !Number.isSafeInteger(bodyTimeout) ||
    bodyTimeout < 10 ||
    bodyTimeout > 60_000 ||
    !Number.isSafeInteger(maxReads) ||
    maxReads < 1 ||
    maxReads > 1000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 10_000 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 1000
  ) {
    throw new RangeError('Invalid collection limits');
  }
  /** Exact normalized host-owned origin allowlist; wildcard policy is not inferred. */
  const origins = new Set(
    (options.allowedOrigins ?? []).map((value) => {
      /** One configured origin is validated as an origin only, excluding credentials/path/query/fragment. */
      const url = new URL(value);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        return 'invalid';
      }
      return url.origin;
    })
  );
  if (origins.has('invalid')) {
    throw new TypeError('Invalid allowed origin');
  }
  /** Trusted browser-origin to site binding; payload site cannot override an existing mapping. */
  const siteByOrigin = new Map<string, string>();
  // Validate every configured origin-to-site binding before accepting public requests.
  for (const [origin, site] of Object.entries(options.siteByOrigin ?? {})) {
    if (
      !origins.has(origin) ||
      typeof site !== 'string' ||
      !site ||
      site.length > 200 ||
      // eslint-disable-next-line no-control-regex -- Intentionally rejects control characters; preserve the existing validation range.
      /[\x00-\x1f]/.test(site)
    ) {
      throw new TypeError('Invalid analytics origin-to-site mapping');
    }
    siteByOrigin.set(origin, site);
  }
  if (
    options.botPolicy !== undefined &&
    !['allow', 'drop-known'].includes(options.botPolicy)
  ) {
    throw new TypeError('Invalid bot policy');
  }
  /** Process-local fixed-minute counters, never identity or administrative authorization. */
  const windows = new Map<
    string,
    {
      /** Server minute defining this process-local admission window. */
      minute: number; /** Admitted requests within this local minute; not an identity or durable delivery counter. */
      count: number;
    }
  >();
  let pending = 0,
    activeReads = 0;
  /**
   * Bound caller storage waiting while retaining pending capacity through actual dispatch settlement.
   * @param {AnalyticsEventInput} input - Untrusted event input; host authentication and tenant authorization remain separate.
   * @param {object} context - Trusted reservation day/correlation plus observed origin for the configured pipeline.
   * @param {string} context.requestId - See the typed field contract.
   * @param {string} context.utcDay - See the typed field contract.
   * @param {string | undefined} context.origin - See the typed field contract.
   * @returns {Promise<void>} Resolves after storage settles or response deadline; neither outcome proves durable delivery.
   */
  async function track(
    input: AnalyticsEventInput,
    context: {
      /** Opaque correlation identity; reservation and event persistence remain distinct outcomes. */
      requestId: string; /** Trusted server UTC day attached to this correlation/dispatch context. */
      utcDay: string; /** Observed request origin; configured allowlist grants collection only, never administrator permission. */
      origin?: string;
    }
  ): Promise<void> {
    if (pending >= maxPending) {
      return;
    }
    pending++;
    /** Actual storage/dispatch promise retains pending capacity until settlement after a timed response. */
    const operation = Promise.resolve()
      .then(() =>
        options.dispatch
          ? options.dispatch(input, context)
          : options.analytics.track(input)
      )
      .then(
        () => {},
        () => {}
      )
      .finally(() => {
        pending--;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  /**
   * Enforce the configured method/origin/body/tenant/consent/correlation boundary before dispatch.
   * @param {Request} request - Incoming Fetch request; method, origin, tenant and body remain untrusted.
   * @returns {Promise<Response>} Uncacheable collection response; 204 acknowledges best-effort acceptance only.
   */
  const handler = async (request: Request): Promise<Response> => {
    /** Untrusted incoming Origin is compared only against configured exact origins. */
    const origin = request.headers.get('origin');
    /** Allowed origin permits public collection, not user identity, tenant admin rights or durable delivery. */
    const allowed = !!origin && origins.has(origin);
    /** Response-local CORS headers are emitted only for a configured origin. */
    const cors: Record<string, string> = {};
    if (allowed) {
      cors['access-control-allow-origin'] = origin!;
      cors.vary = 'Origin';
    }
    if (request.method === 'OPTIONS') {
      if (!allowed) {
        return json(403, 'Origin not allowed', cors);
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'Content-Type',
          'access-control-max-age': '600',
        },
      });
    }
    if (request.method !== 'POST') {
      return json(405, 'Method not allowed', cors);
    }
    /** Received bearer value is compared locally; it never appears in collector output. */
    const token = request.headers
      .get('authorization')
      ?.replace(/^Bearer /i, '');
    if (
      !allowed &&
      (!options.serverToken ||
        !token ||
        !sameSecret(token, options.serverToken))
    ) {
      return json(403, 'Collector authorization required', cors);
    }
    // Browser origins enable collection, not user identity or administrative access.
    if (allowed && options.botPolicy === 'drop-known') {
      /** Untrusted user-agent is used only for the explicit conservative known-bot drop policy. */
      const agent = request.headers.get('user-agent') ?? '';
      /** Prefetch/prerender hint can suppress collection, never grant access or identity. */
      const purpose = (
        request.headers.get('sec-purpose') ??
        request.headers.get('purpose') ??
        ''
      ).toLowerCase();
      if (
        /(?:bot|crawler|spider|headless|bingpreview|google-other)/i.test(
          agent
        ) ||
        /(?:prefetch|prerender)/.test(purpose)
      ) {
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'cache-control': 'no-store' },
        });
      }
    }
    /** Counter scope is an approved public origin or fixed server bucket, not an arbitrary user label. */
    const key = allowed ? `origin:${origin}` : 'server';
    /** Current server minute defines the local admission window. */
    const minute = Math.floor(Date.now() / 60_000);
    if (windows.size > 1024) {
      // Discard expired process-local rate windows without inspecting event payloads.
      for (const [k, v] of windows) {
        if (v.minute !== minute) {
          windows.delete(k);
        }
      }
    }
    /** Prior local counter applies only while its recorded minute matches the current one. */
    const window = windows.get(key);
    if (window && window.minute === minute && window.count >= rate) {
      return json(429, 'Collector rate exceeded', cors);
    }
    if (activeReads >= maxReads) {
      return json(429, 'Collector request concurrency exceeded', cors);
    }
    windows.set(key, {
      minute,
      count: window?.minute === minute ? window.count + 1 : 1,
    });
    try {
      activeReads++;
      let data: unknown;
      try {
        data = await boundedJson(
          request,
          max,
          bodyTimeout,
          options.allowTextPlainBeacon === true
        );
      } finally {
        // Release parser waiting admission; an uncooperative reader can still be cancelling.
        activeReads--;
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return json(400, 'Invalid event', cors);
      }
      /** Parsed JSON remains untrusted until event and registered-schema validation complete. */
      const input = data as AnalyticsEventInput;
      // Public web endpoint cannot impersonate email or server-side event sources.
      if (allowed && input.source && input.source !== 'web') {
        return json(403, 'Invalid client event source', cors);
      }
      /** Host origin mapping overrides authority; a conflicting supplied site is rejected first. */
      const boundSite = allowed ? siteByOrigin.get(origin!) : undefined;
      if (
        boundSite !== undefined &&
        input.site !== undefined &&
        input.site !== boundSite
      ) {
        return json(403, 'Site does not match origin', cors);
      }
      if (
        input.consent === 'denied' ||
        (allowed &&
          options.requireBrowserConsent &&
          input.consent !== 'granted')
      ) {
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'cache-control': 'no-store' },
        });
      }
      let id = input.requestId;
      if (id !== undefined && !validRequestId(id)) {
        return json(422, 'Invalid request ID', cors);
      }
      if (options.requireRequestId && !id) {
        return json(422, 'Request ID required', cors);
      }
      /** Trusted server UTC day scopes atomic request-ID reservation. */
      const day = requestUtcDay();
      try {
        /** Validated preview precedes request-ID reservation; it neither runs filters nor persists an event. */
        const candidate = {
          ...input,
          source: allowed
            ? ('web' as const)
            : (input.source ?? ('server' as const)),
          ...(boundSite ? { site: boundSite } : {}),
          ...(id ? { requestId: id, requestUtcDay: day } : {}),
        };
        validateEvent(candidate);
        options.analytics.validateInput?.(candidate);
      } catch {
        return json(422, 'Invalid event data', cors);
      }
      try {
        if (options.requestIdStore) {
          if (id) {
            if (!(await options.requestIdStore.reserve(day, id))) {
              return json(409, 'Duplicate request ID', cors);
            }
          } else {
            let success = false;
            // Bound server-generated request-ID collision attempts before returning a failure.
            for (let i = 0; i < 5; i++) {
              /** Fresh correlation candidate is reserved atomically; bounded collisions cannot loop indefinitely. */
              const next = createRequestId();
              if (await options.requestIdStore.reserve(day, next)) {
                id = next;
                success = true;
                break;
              }
            }
            if (!success) {
              return json(503, 'Request ID allocation failed', cors);
            }
          }
        }
      } catch {
        return json(503, 'Request ID reservation unavailable', cors);
      }
      if (id && !options.requestIdStore) {
        return json(503, 'Request ID reservation not configured', cors);
      }
      // Storage is best-effort. Delivery of the identifier never claims storage durability.
      /** Trusted correlation/day plus observed origin is handed only to the configured pipeline. */
      const context = {
        requestId: id ?? '',
        utcDay: day,
        origin: origin ?? undefined,
      };
      await track(
        {
          ...input,
          source: allowed ? 'web' : (input.source ?? 'server'),
          ...(boundSite ? { site: boundSite } : {}),
          ...(id ? { requestId: id, requestUtcDay: day } : {}),
        },
        context
      );
      /** Uncacheable final response may echo a reserved ID, without claiming event persistence. */
      const headers: Record<string, string> = {
        ...cors,
        'cache-control': 'no-store',
        ...(id ? { 'x-zerux-request-id': id, 'x-zerux-request-day': day } : {}),
      };
      if (allowed) {
        headers['access-control-expose-headers'] =
          'x-zerux-request-id, x-zerux-request-day';
      }
      return new Response(null, { status: 204, headers });
    } catch (error) {
      /** Only existing status-coded errors select this explicit failure response path. */
      const code = (
        error as {
          /** Explicit HTTP error status carried by the existing collector failure path. */
          status?: number;
        }
      ).status;
      if (code) {
        return json(code, (error as Error).message, cors);
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        return json(422, 'Invalid event data', cors);
      }
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'cache-control': 'no-store' },
      });
    }
  };
  return {
    path: `${prefix}/collect`,
    handler,
    /**
     * Describe this collector’s Fetch route without registering a server or listener.
     * @returns {object[]} A route descriptor borrowing this instance’s fixed handler.
     */
    routes() {
      return [{ pattern: `${prefix}/collect`, handler }];
    },
  };
}
