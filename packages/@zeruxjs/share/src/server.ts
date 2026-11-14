import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { validatedShareUrl } from './url.js';
export interface ShortLinkRecord {
  /** Persisted wire schema version; only V1 is supported. */
  schema: 1;
  /** Configured public origin and prefix namespace; must match this service. */
  scope: string;
  /** Case-sensitive reserved URL identifier; never reused after expiry or revocation. */
  slug: string;
  /** Fresh host-verified tenant binding, not a caller-selected identity. */
  tenant: string;
  /** Fresh host-verified subject owning this reservation. */
  owner: string;
  /** Normalized permitted absolute URL; policy is rechecked before redirecting. */
  destination: string;
  /** Opaque optimistic revision; management writes must compare the current value. */
  revision: string;
  /** Validated UTC creation timestamp in epoch milliseconds. */
  createdAt: number;
  /** UTC expiry in milliseconds, or explicit null for a nonexpiring link. */
  expiresAt: number | null;
  /** Explicit 301/302/307/308 policy; default creation uses 302. */
  status: 301 | 302 | 307 | 308;
  /** Explicit destination edit permission; permanent redirects require false. */
  editable: boolean;
  /** Whether irreversible revocation is allowed; permanent redirects require false. */
  revocable: boolean;
  /** Permanent revocation tombstone; the slug remains reserved. */
  revoked: boolean;
}
export interface ShortLinkStore {
  /** Required linearizable create-only and revision-CAS storage contract identifier. */
  readonly capability: 'short-links-cas-v1';
  /** Explicit host qualification of persistent storage; memory adapters do not qualify. */
  readonly durable: true;
  /** Linearizable create-only reservation; never reuse a slug, even after expiry/revocation. */
  reserve(
    key: string,
    value: Readonly<ShortLinkRecord>,
    signal: AbortSignal
  ): Promise<boolean>;
  read(key: string, signal: AbortSignal): Promise<ShortLinkRecord | null>;
  compareAndSwap(
    key: string,
    expectedRevision: string,
    value: Readonly<ShortLinkRecord>,
    signal: AbortSignal
  ): Promise<boolean>;
}
export interface ShortLinkPrincipal {
  /** Fresh host-verified tenant binding, not a caller-selected identity. */
  tenant: string;
  /** Fresh host-verified initiating subject identifier. */
  subject: string;
  /** Trusted host grant, still restricted to this tenant. */ manageTenant?: boolean;
}
export type ShortLinkOperation = 'create' | 'read' | 'edit' | 'revoke';
export interface ShortLinkOptions {
  /** Explicit public origin; forwarded headers cannot change this value. */
  origin: string;
  /** Optional safe URL namespace, default /s/, maximum 128 characters. */
  prefix?: string;
  /** Borrowed host-owned durable store; close it only after the service drains. */
  store: ShortLinkStore;
  authorize(
    context: unknown,
    operation: ShortLinkOperation,
    signal: AbortSignal
  ): Promise<ShortLinkPrincipal | null> | ShortLinkPrincipal | null;
  /** Exact normalized HTTP(S) destination origins; no wildcard host expansion. */
  allowedOrigins: readonly string[];
  /** Optional synchronous additional destination restriction; only literal true permits. */
  allowDestination?: (destination: string) => boolean;
  /** Additional case-insensitive URL reservations beyond built-in framework paths. */
  reservedPaths?: readonly string[];
  /** Default expiry lifetime, 30 days unless configured; cannot exceed maxTtlMs. */
  defaultTtlMs?: number;
  /** Maximum expiry lifetime, default one year; validated before startup. */
  maxTtlMs?: number;
  /** Explicitly enables permanent redirects with the required immutable/nonexpiring policy. */ permanentCacheSeconds?: number;
  /** Observation deadline in milliseconds; caller overrides cannot exceed the service limit. */
  timeoutMs?: number;
  /** Bounded pending operation count; actual unsettled work retains capacity. */
  maxPending?: number;
  /** Optional trusted UTC millisecond clock, default Date.now; each reading is validated. */
  now?: () => number;
  /** Optional consented daily link-pseudonym recording; never required for redirects. */
  analytics?: {
    /** Exactly 32-byte analytics HMAC key copied by the service and cleared after drain. */
    key: Uint8Array;
    consent(request: Request): boolean;
    record(
      event: Readonly<{
        /** Persisted wire schema version; only V1 is supported. */
        schema: 1;
        link: string;
        day: string;
        action: 'redirect';
      }>,
      signal: AbortSignal
    ): void | Promise<void>;
    /** Bounded pending operation count; actual unsettled work retains capacity. */
    maxPending?: number;
    /** Observation deadline in milliseconds; caller overrides cannot exceed the service limit. */
    timeoutMs?: number;
  };
}
export interface CreateShortLink {
  /** Case-sensitive reserved URL identifier; never reused after expiry or revocation. */
  slug?: string;
  /** Normalized permitted absolute URL; policy is rechecked before redirecting. */
  destination: string;
  /** UTC expiry in milliseconds, or explicit null for a nonexpiring link. */
  expiresAt?: number | null;
  /** Explicit 301/302/307/308 policy; default creation uses 302. */
  status?: 301 | 302 | 307 | 308;
  /** Explicit destination edit permission; permanent redirects require false. */
  editable?: boolean;
  /** Whether irreversible revocation is allowed; permanent redirects require false. */
  revocable?: boolean;
}
export interface ShortLinkControl {
  /** Optional cooperative initiating AbortSignal; abort does not prove write rollback. */
  signal?: AbortSignal;
  /** Observation deadline in milliseconds; caller overrides cannot exceed the service limit. */
  timeoutMs?: number;
}
/** Redacted public failure with private native cause and explicit write uncertainty. */
export class ShortLinkError extends Error {
  /** Construct a failure without serializing the private underlying cause.
   * @param {ShortLinkError['code']} code - Fixed public error category.
   * @param {'not-started' | 'unknown'} outcome - Whether persistence may have happened; defaults not-started.
   * @param {unknown} cause - Private underlying cause retained for trusted host inspection.
   * @param {string} uncertainSlug - Optional reservation reference for authorized reconciliation.
   */
  constructor(
    readonly code:
      | 'INVALID'
      | 'DENIED'
      | 'CONFLICT'
      | 'UNAVAILABLE'
      | 'CLOSED'
      | 'LIMIT'
      | 'CANCELLED'
      | 'DEADLINE',
    readonly outcome: 'not-started' | 'unknown' = 'not-started',
    cause?: unknown,
    readonly uncertainSlug?: string
  ) {
    super(`Short link operation failed (${code})`, { cause });
    this.name = 'ShortLinkError';
  }
}
/** Throw a fixed public error category without including private payloads.
 * @param {ShortLinkError['code']} code - Fixed public failure category.
 * @returns {never} Always throws a redacted ShortLinkError.
 */
const fail = (code: ShortLinkError['code']): never => {
  throw new ShortLinkError(code);
};
/** Reject unknown fields, symbols, accessors and nonplain records before reading untrusted options.
 * @param {unknown} v - Candidate own-data record; property getters are never invoked.
 * @param {readonly string[]} keys - Explicit allowed field names for this operation.
 * @returns {void} Completes only when the candidate satisfies the inert record boundary.
 */
function plain(
  v: unknown,
  keys: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== 'string' ||
        !keys.includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(v, k)!)
    )
  ) {
    fail('INVALID');
  }
}
/** Check a bounded safe-integer resource budget.
 * @param {unknown} v - Candidate budget.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {boolean} Whether the candidate is a safe integer within bounds.
 */
const integer = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
/** Check bounded identity label syntax without authenticating it.
 * @param {unknown} v - Host-returned candidate identity label.
 * @returns {boolean} Whether the candidate is a supported opaque string.
 */
const opaque = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
/** Normalize a credential-free HTTP(S) origin without fetching it or trusting request forwarding headers.
 * @param {unknown} value - Explicit host origin with no path, query or fragment.
 * @returns {string} Validated canonical origin; malformed values reject.
 */
function origin(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f\\]/.test(value)
  ) {
    return fail('INVALID');
  }
  /** Parsed explicit public origin; never derived from untrusted forwarded headers. */
  const u = new URL(validatedShareUrl(value));
  if (u.pathname !== '/' || u.search || u.hash) {
    return fail('INVALID');
  }
  return u.origin;
}
/** Exact persisted V1 scalar field allowlist, including permanent reservation and revocation state. */
const recordKeys = [
  'schema',
  'scope',
  'slug',
  'tenant',
  'owner',
  'destination',
  'revision',
  'createdAt',
  'expiresAt',
  'status',
  'editable',
  'revocable',
  'revoked',
];
/** Create an explicitly authorized server service over a borrowed durable reservation/CAS store. Owns pending work and a copied analytics key, but no listener or store connection. Close drains actual settlement before clearing the key.
 * @param {ShortLinkOptions} input - Host authorization, exact destination policy, namespace and bounded execution configuration.
 * @returns {object} Management, public redirect and drain methods; store lifetime remains host-owned.
 */
export function createShortLinkService(input: ShortLinkOptions) {
  plain(input, [
    'origin',
    'prefix',
    'store',
    'authorize',
    'allowedOrigins',
    'allowDestination',
    'reservedPaths',
    'defaultTtlMs',
    'maxTtlMs',
    'permanentCacheSeconds',
    'timeoutMs',
    'maxPending',
    'now',
    'analytics',
  ]);
  if (
    input.store?.capability !== 'short-links-cas-v1' ||
    input.store.durable !== true ||
    ['reserve', 'read', 'compareAndSwap'].some(
      (k) => typeof (input.store as any)[k] !== 'function'
    ) ||
    typeof input.authorize !== 'function' ||
    (input.now !== undefined && typeof input.now !== 'function') ||
    (input.allowDestination !== undefined &&
      typeof input.allowDestination !== 'function')
  ) {
    fail('INVALID');
  }
  /** Normalized host-configured origin shared by management URLs and public resolution. */
  const publicOrigin = origin(input.origin);
  /** Explicit URL namespace, default /s/; independent of an application filesystem path. */
  const prefix = input.prefix ?? '/s/';
  if (
    typeof prefix !== 'string' ||
    !/^\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*$/.test(prefix) ||
    prefix.length > 128
  ) {
    fail('INVALID');
  }
  /** Framework/public endpoint names that cannot be claimed as short links. */
  const builtins = [
    'api',
    'admin',
    'auth',
    'login',
    'logout',
    'health',
    'ready',
    'metrics',
    'robots.txt',
    'sitemap.xml',
    'trust.txt',
    'favicon.ico',
    'assets',
    'public',
    '_tags',
    '_actions',
    '.well-known',
  ];
  if (
    prefix !== '/' &&
    builtins.includes(prefix.split('/')[1]?.toLowerCase() ?? '')
  ) {
    fail('DENIED');
  }
  if (
    !Array.isArray(input.allowedOrigins) ||
    !input.allowedOrigins.length ||
    input.allowedOrigins.length > 32 ||
    !Array.isArray(input.reservedPaths ?? []) ||
    (input.reservedPaths?.length ?? 0) > 128
  ) {
    fail('INVALID');
  }
  /** Exact normalized destination-origin allowlist; wildcard hosts are unsupported. */
  const allowed = new Set(input.allowedOrigins.map(origin));
  /** Case-insensitive reserved URL paths including host additions. */
  const reserved = [
    ...builtins.map((v) => '/' + v),
    ...(input.reservedPaths ?? []),
  ];
  // Validate every host reservation before admitting any management work.
  for (const path of reserved) {
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x20\x7f\\?#%]/.test(path)
    ) {
      fail('INVALID');
    }
  }
  if (
    prefix !== '/' &&
    reserved.some((path) =>
      prefix
        .toLowerCase()
        .startsWith(path.toLowerCase().replace(/\/$/, '') + '/')
    )
  ) {
    fail('DENIED');
  }
  /** Maximum expiring-link lifetime, default one year in milliseconds. */
  const maxTtl = input.maxTtlMs ?? 31536000000;
  /** Default expiring-link lifetime, bounded by the configured maximum. */
  const defaultTtl = input.defaultTtlMs ?? 2592000000;
  /** Maximum caller observation deadline; native work may settle later. */
  const timeout = input.timeoutMs ?? 5000;
  /** Native management/read work ceiling; timed-out operations retain their slots. */
  const maxPending = input.maxPending ?? 32;
  /** Explicit permanent redirect cache policy; immutable nonexpiring records are required. */
  const permanent = input.permanentCacheSeconds;
  if (
    !integer(maxTtl, 1, 31536000000) ||
    !integer(defaultTtl, 1, maxTtl) ||
    !integer(timeout, 1, 60000) ||
    !integer(maxPending, 1, 128) ||
    (permanent !== undefined && !integer(permanent, 1, 31536000))
  ) {
    fail('INVALID');
  }
  /** Borrowed durable linearizable store; service close never closes this dependency. */
  const store = input.store;
  /** Trusted host authorization callback invoked afresh for each management operation. */
  const authorize = input.authorize;
  /** Borrowed host clock, default Date.now, validated at each policy decision. */
  const now = input.now ?? Date.now;
  /** Optional synchronous host restriction layered over the exact origin allowlist. */
  const allowDestination = input.allowDestination;
  /** Fixed origin plus prefix namespace bound into reservation keys and stored records. */
  const scope = publicOrigin + prefix;
  /** Owned lifetime signal linking close to cooperative in-flight operations. */
  const lifetime = new AbortController();
  /** Actual native operation settlements retained independently of caller timeouts. */
  const pending = new Set<Promise<unknown>>();
  /** Actual optional analytics settlements retained until close drains them. */
  const clicks = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined,
    dropped = 0,
    analyticsErrors = 0;
  /** Validated shallow snapshot of explicitly configured optional analytics callbacks and limits. */
  const analytics = (() => {
    /** Borrowed optional analytics configuration checked before copying its fields. */
    const config = input.analytics;
    if (config) {
      plain(config, ['key', 'consent', 'record', 'maxPending', 'timeoutMs']);
    }
    return config && { ...config };
  })();
  if (analytics) {
    plain(analytics, ['key', 'consent', 'record', 'maxPending', 'timeoutMs']);
    if (
      !(analytics.key instanceof Uint8Array) ||
      analytics.key.length !== 32 ||
      typeof analytics.consent !== 'function' ||
      typeof analytics.record !== 'function' ||
      !integer(analytics.maxPending ?? 16, 1, 128) ||
      !integer(analytics.timeoutMs ?? 1000, 1, 10000)
    ) {
      fail('INVALID');
    }
  }
  /** Owned copy of the analytics HMAC key, cleared after pending work drains. */
  const clickKey = analytics && Buffer.from(analytics.key);
  /** Read and validate the injected host clock before expiry decisions.
   * @returns {number} Bounded safe-integer UTC epoch milliseconds.
   */
  function clock() {
    /** Candidate or host-returned value validated before use in the current operation. */
    const value = now();
    if (!integer(value, 0, 253402300799999)) {
      return fail('INVALID');
    }
    return value;
  }
  /** Check URL-safe slug syntax and case-insensitive reserved framework paths without changing case-sensitive identity.
   * @param {unknown} value - Candidate custom, stored or generated slug.
   * @returns {void} Completes only for a usable namespace path.
   */
  function slug(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(value)) {
      return fail('INVALID');
    }
    /** Normalized URL path used for reserved-path or request namespace checks. */
    const path = (prefix + value).toLowerCase();
    if (
      builtins.includes(value.toLowerCase()) ||
      reserved.some(
        (r) =>
          path === r.toLowerCase() ||
          path.startsWith(r.toLowerCase().replace(/\/$/, '') + '/')
      )
    ) {
      fail('DENIED');
    }
  }
  /** Hash the fixed namespace and slug into a durable reservation key.
   * @param {string} value - Validated case-sensitive slug.
   * @returns {string} Hex SHA-256 reservation key, not an authorization token.
   */
  const key = (value: string) =>
    createHash('sha256')
      .update(JSON.stringify([scope, value]))
      .digest('hex');
  /** Recheck exact configured origin and synchronous host destination policy. No DNS resolution or remote request occurs.
   * @param {unknown} value - Absolute destination URL; ambiguous paths and local redirect chains reject.
   * @returns {string} Normalized permitted URL; host permission must return literal true.
   */
  function destination(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 4096 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x20\x7f\\]/.test(value)
    ) {
      return fail('INVALID');
    }
    let url: URL;
    try {
      url = new URL(validatedShareUrl(value));
    } catch {
      return fail('INVALID');
    }
    if (url.href.length > 4096 || /%2f|%5c|%25/i.test(url.pathname)) {
      return fail('DENIED');
    }
    if (
      !allowed.has(url.origin) ||
      (url.origin === publicOrigin && url.pathname.startsWith(prefix))
    ) {
      return fail('DENIED');
    }
    if (allowDestination) {
      /** Explicit destination-policy or resolution outcome; unknown values are not treated as success. */
      const result = allowDestination(url.href);
      if (result !== true) {
        if (result && typeof (result as any).then === 'function') {
          void Promise.resolve(result).catch(() => {});
        }
        return fail('DENIED');
      }
    }
    return url.href;
  }
  /** Validate a stored record against its requested slug and service namespace before exposing a clone. Destination policy is rechecked separately when redirecting or editing.
   * @param {unknown} value - Untrusted store result with only known own scalar fields.
   * @param {string} expectedSlug - Validated requested slug whose reservation was read.
   * @returns {ShortLinkRecord} Independent validated record; malformed or incompatible permanent policy rejects.
   */
  function record(value: unknown, expectedSlug: string): ShortLinkRecord {
    plain(value, recordKeys);
    if (
      value.schema !== 1 ||
      value.scope !== scope ||
      value.slug !== expectedSlug ||
      !opaque(value.tenant) ||
      !opaque(value.owner) ||
      typeof value.revision !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(value.revision) ||
      !integer(value.createdAt, 0, 253402300799999) ||
      (value.expiresAt !== null &&
        !integer(value.expiresAt, value.createdAt + 1, 253402300799999)) ||
      ![301, 302, 307, 308].includes(value.status) ||
      ['editable', 'revocable', 'revoked'].some(
        (k) => typeof value[k] !== 'boolean'
      )
    ) {
      return fail('INVALID');
    }
    if (
      [301, 308].includes(value.status) &&
      (permanent === undefined ||
        value.editable ||
        value.revocable ||
        value.expiresAt !== null)
    ) {
      return fail('DENIED');
    }
    if (typeof value.destination !== 'string') {
      return fail('INVALID');
    }
    return { ...value } as ShortLinkRecord;
  }
  /** Obtain fresh host authorization for each management invocation; tenant-wide grants never cross tenant boundaries.
   * @param {unknown} context - Opaque host request/session context, never a browser role assertion.
   * @param {ShortLinkOperation} op - Explicit management operation to authorize.
   * @param {AbortSignal} signal - Cooperative initiating execution signal.
   * @returns {Promise<Record<string, any>>} Copied verified tenant/subject grant; missing or malformed authorization denies.
   */
  async function principal(
    context: unknown,
    op: ShortLinkOperation,
    signal: AbortSignal
  ) {
    /** Candidate or host-returned value validated before use in the current operation. */
    const value = await authorize(context, op, signal);
    signal.throwIfAborted();
    if (!value) {
      return fail('DENIED');
    }
    plain(value, ['tenant', 'subject', 'manageTenant']);
    if (
      !opaque(value.tenant) ||
      !opaque(value.subject) ||
      (value.manageTenant !== undefined &&
        typeof value.manageTenant !== 'boolean')
    ) {
      return fail('DENIED');
    }
    return { ...value };
  }
  /** Read and validate one durable reservation while retaining native work until settlement.
   * @param {string} value - Validated case-sensitive slug.
   * @param {AbortSignal} signal - Borrowed cooperative store-operation signal.
   * @returns {Promise<ShortLinkRecord | null>} Independent validated record or null; store failures are not interpreted as absence.
   */
  async function read(value: string, signal: AbortSignal) {
    /** Current validated durable reservation; absence and unauthorized access remain distinct internally. */
    const found = await store.read(key(value), signal);
    signal.throwIfAborted();
    return found === null ? null : record(found, value);
  }
  /** Reauthorize and enforce owner or explicit same-tenant management permission before accessing a reservation.
   * @param {unknown} context - Host-authenticated initiating context.
   * @param {ShortLinkOperation} op - Management operation requiring a fresh grant.
   * @param {string} value - Validated reservation slug.
   * @param {AbortSignal} signal - Borrowed cooperative operation signal.
   * @returns {Promise<ShortLinkRecord>} Authorized current record; missing and inaccessible records both deny.
   */
  async function managed(
    context: unknown,
    op: ShortLinkOperation,
    value: string,
    signal: AbortSignal
  ) {
    /** Fresh host-verified tenant and subject grant; never taken from link input. */
    const who = await principal(context, op, signal);
    /** Current validated durable reservation; absence and unauthorized access remain distinct internally. */
    const found = await read(value, signal);
    if (
      !found ||
      found.tenant !== who.tenant ||
      (found.owner !== who.subject && who.manageTenant !== true)
    ) {
      return fail('DENIED');
    }
    return found;
  }
  /** Bound caller observation and pending native work separately. Timeout/cancellation does not prove rollback; writes with unknown outcomes are never automatically replayed.
   * @param {ShortLinkControl} control - Optional initiating signal and deadline no greater than the configured service deadline.
   * @param {(signal: AbortSignal) => Promise<T>} work - Trusted cooperative operation retained in the pending set until actual settlement.
   * @param {boolean} write - Whether an interrupted operation can have an uncertain persisted side effect; defaults false.
   * @returns {Promise<T>} Observed operation result or redacted failure; unsettled work still consumes capacity.
   */
  async function run<T>(
    control: ShortLinkControl,
    work: (signal: AbortSignal) => Promise<T>,
    write = false
  ): Promise<T> {
    plain(control, ['signal', 'timeoutMs']);
    if (
      (control.signal !== undefined &&
        !(control.signal instanceof AbortSignal)) ||
      !integer(control.timeoutMs ?? timeout, 1, timeout)
    ) {
      return fail('INVALID');
    }
    if (closed) {
      return fail('CLOSED');
    }
    if (control.signal?.aborted) {
      return fail('CANCELLED');
    }
    if (pending.size >= maxPending) {
      return fail('LIMIT');
    }
    /** Owned cooperative controller; abort cannot force-cancel arbitrary host JavaScript. */
    const controller = new AbortController();
    /** Combined initiating, lifetime and operation cancellation signal. */
    const signal = AbortSignal.any([
      lifetime.signal,
      controller.signal,
      ...(control.signal ? [control.signal] : []),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    /** Caller-observation rejection signal; native settlement remains separately retained. */
    const stopped = new Promise<never>((_, reject) => {
      abort = () =>
        reject(
          new ShortLinkError(
            control.signal?.aborted || lifetime.signal.aborted
              ? 'CANCELLED'
              : 'DEADLINE',
            write ? 'unknown' : 'not-started'
          )
        );
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () => controller.abort(),
        control.timeoutMs ?? timeout
      );
    });
    /** Actual dependency operation promise retained through completion even after timeout. */
    const native = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work(signal);
    });
    pending.add(native);
    void native.finally(() => pending.delete(native)).catch(() => {});
    try {
      return await Promise.race([native, stopped]);
    } catch (cause) {
      if (cause instanceof ShortLinkError) {
        throw cause;
      }
      throw new ShortLinkError(
        'UNAVAILABLE',
        write ? 'unknown' : 'not-started',
        cause
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', abort);
    }
  }
  /** Schedule optional consented UTC/link-pseudonym analytics independently of a valid redirect. Bounded failures never invalidate the redirect, and payloads exclude destination and identity.
   * @param {Request} request - Borrowed public request used only by the explicit consent callback.
   * @param {ShortLinkRecord} link - Validated resolved record used to derive a keyed daily pseudonym.
   * @returns {void} Returns immediately; retained analytics work drains on service close.
   */
  function click(request: Request, link: ShortLinkRecord) {
    if (!analytics || !clickKey || request.method !== 'GET') {
      return;
    }
    if (clicks.size >= (analytics.maxPending ?? 16)) {
      dropped++;
      return;
    }
    /** Owned cooperative controller; abort cannot force-cancel arbitrary host JavaScript. */
    const controller = new AbortController();
    /** Combined initiating, lifetime and operation cancellation signal. */
    const signal = AbortSignal.any([lifetime.signal, controller.signal]);
    /** Owned bounded deadline timer cleared when its associated operation settles. */
    const timer = setTimeout(
      () => controller.abort(),
      analytics.timeoutMs ?? 1000
    );
    /** Optional bounded analytics task whose errors are isolated from public redirects. */
    const job = Promise.resolve()
      .then(async () => {
        /** Fresh explicit consent result; only literal true permits analytics recording. */
        const consent = analytics.consent(request);
        if (consent !== true) {
          if (consent && typeof (consent as any).then === 'function') {
            void Promise.resolve(consent).catch(() => {});
          }
          return;
        }
        signal.throwIfAborted();
        /** Frozen daily link pseudonym event without raw destination or recipient identity. */
        const event = Object.freeze({
          schema: 1 as const,
          link: createHmac('sha256', clickKey)
            .update(JSON.stringify([scope, link.tenant, link.slug]))
            .digest('base64url'),
          day: new Date(clock()).toISOString().slice(0, 10),
          action: 'redirect' as const,
        });
        await analytics.record(event, signal);
      })
      .catch(() => {
        analyticsErrors++;
      })
      .finally(() => {
        clearTimeout(timer);
        clicks.delete(job);
      });
    clicks.add(job);
  }
  /** Owned short-link API; the host must await close before releasing borrowed dependencies. */
  const service = {
    /** Reserve an authorized tenant/owner-bound link with explicit expiry and redirect policy.
     * @param {unknown} context - Host-authenticated initiating context.
     * @param {CreateShortLink} value - Validated destination and optional creation policy.
     * @param {ShortLinkControl} control - Optional cancellation and bounded observation deadline.
     * @returns {Promise<object>} Frozen committed record and public URL; unknown writes never auto-replay.
     */
    create(
      context: unknown,
      value: CreateShortLink,
      control: ShortLinkControl = {}
    ) {
      plain(value, [
        'slug',
        'destination',
        'expiresAt',
        'status',
        'editable',
        'revocable',
      ]);
      /** Independent scalar creation payload captured before asynchronous authorization. */
      const data = { ...value };
      return run(
        control,
        async (signal) => {
          /** Fresh host-verified tenant and subject grant; never taken from link input. */
          const who = await principal(context, 'create', signal);
          /** Validated creation time from the host clock. */
          const createdAt = clock();
          /** Deliberate redirect status; permanent statuses require the explicit immutable policy. */
          const status = data.status ?? 302;
          /** Explicit expiry or validated default; null is allowed only under declared policy. */
          const expiresAt =
            data.expiresAt === undefined
              ? createdAt + defaultTtl
              : data.expiresAt;
          /** Whether later destination CAS edits are permitted for this reservation. */
          const editable = data.editable ?? true;
          /** Whether this reservation permits an irreversible revocation tombstone. */
          const revocable = data.revocable ?? true;
          if (
            ![301, 302, 307, 308].includes(status) ||
            typeof editable !== 'boolean' ||
            typeof revocable !== 'boolean' ||
            (expiresAt !== null &&
              !integer(expiresAt, createdAt + 1, createdAt + maxTtl))
          ) {
            return fail('INVALID');
          }
          if (
            [301, 308].includes(status) &&
            (permanent === undefined ||
              editable ||
              revocable ||
              expiresAt !== null)
          ) {
            return fail('DENIED');
          }
          /** Normalized destination checked against fixed origin and host policy. */
          const url = destination(data.destination);
          // Retry only confirmed generated-slug collisions, never ambiguous writes.
          for (let attempt = 0; attempt < 3; attempt++) {
            signal.throwIfAborted();
            /** Validated URL-safe generated or custom slug; only confirmed random collisions are retried. */
            const candidate =
              data.slug ?? randomBytes(18).toString('base64url');
            slug(candidate);
            /** Complete replacement record prepared before a create-only or revision-checked durable write. */
            const next: ShortLinkRecord = {
              schema: 1,
              scope,
              slug: candidate,
              tenant: who.tenant,
              owner: who.subject,
              destination: url,
              revision: randomUUID(),
              createdAt,
              expiresAt,
              status,
              editable,
              revocable,
              revoked: false,
            };
            let reserved: boolean;
            try {
              reserved = await store.reserve(
                key(candidate),
                Object.freeze(next),
                signal
              );
            } catch (cause) {
              throw new ShortLinkError(
                'UNAVAILABLE',
                'unknown',
                cause,
                candidate
              );
            }
            if (reserved !== true && reserved !== false) {
              return fail('INVALID');
            }
            if (reserved) {
              return Object.freeze({ ...next, url: scope + candidate });
            }
            if (data.slug !== undefined) {
              return fail('CONFLICT');
            }
          }
          return fail('CONFLICT');
        },
        true
      );
    },
    /** Reauthorize management inspection, including expired or revoked reservations.
     * @param {unknown} context - Host-authenticated initiating context.
     * @param {string} value - Validated reservation slug.
     * @param {ShortLinkControl} control - Optional bounded operation controls.
     * @returns {Promise<Readonly<ShortLinkRecord>>} Authorized frozen record, without a new permission grant.
     */
    get(context: unknown, value: string, control: ShortLinkControl = {}) {
      slug(value);
      return run(control, async (signal) =>
        Object.freeze(await managed(context, 'read', value, signal))
      );
    },
    /** Replace a permitted destination only when the expected revision still matches.
     * @param {unknown} context - Host-authenticated editor context.
     * @param {string} value - Reservation slug.
     * @param {object} input - New destination and required expectedRevision.
     * @param {string} input.destination - New absolute destination subject to current host policy.
     * @param {string} input.expectedRevision - Required optimistic revision from an authorized read.
     * @param {ShortLinkControl} control - Optional bounded operation controls.
     * @returns {Promise<Readonly<ShortLinkRecord>>} Committed replacement or explicit conflict/uncertainty.
     */
    edit(
      context: unknown,
      value: string,
      input: {
        /** Normalized permitted absolute URL; policy is rechecked before redirecting. */
        destination: string;
        expectedRevision: string;
      },
      control: ShortLinkControl = {}
    ) {
      slug(value);
      plain(input, ['destination', 'expectedRevision']);
      /** Independent edit payload captured before asynchronous authorization. */
      const update = { ...input };
      return run(
        control,
        async (signal) => {
          /** Current validated durable reservation; absence and unauthorized access remain distinct internally. */
          const found = await managed(context, 'edit', value, signal);
          if (
            !found.editable ||
            found.revoked ||
            (found.expiresAt !== null && found.expiresAt <= clock())
          ) {
            return fail('DENIED');
          }
          if (
            typeof update.expectedRevision !== 'string' ||
            found.revision !== update.expectedRevision
          ) {
            return fail('CONFLICT');
          }
          /** Complete replacement record prepared before a create-only or revision-checked durable write. */
          const next = Object.freeze({
            ...found,
            destination: destination(update.destination),
            revision: randomUUID(),
          });
          let saved: boolean;
          try {
            saved = await store.compareAndSwap(
              key(value),
              found.revision,
              next,
              signal
            );
          } catch (cause) {
            throw new ShortLinkError('UNAVAILABLE', 'unknown', cause, value);
          }
          if (saved !== true) {
            return fail('CONFLICT');
          }
          return next;
        },
        true
      );
    },
    /** Persist an irreversible revocation tombstone without recycling its slug.
     * @param {unknown} context - Host-authenticated management context.
     * @param {string} value - Reservation slug.
     * @param {string} expectedRevision - Current revision required for the CAS write.
     * @param {ShortLinkControl} control - Optional bounded operation controls.
     * @returns {Promise<Readonly<ShortLinkRecord>>} Committed tombstone; permanent nonrevocable links deny.
     */
    revoke(
      context: unknown,
      value: string,
      expectedRevision: string,
      control: ShortLinkControl = {}
    ) {
      slug(value);
      return run(
        control,
        async (signal) => {
          /** Current validated durable reservation; absence and unauthorized access remain distinct internally. */
          const found = await managed(context, 'revoke', value, signal);
          if (!found.revocable) {
            return fail('DENIED');
          }
          if (found.revision !== expectedRevision) {
            return fail('CONFLICT');
          }
          /** Complete replacement record prepared before a create-only or revision-checked durable write. */
          const next = Object.freeze({
            ...found,
            revoked: true,
            revision: randomUUID(),
          });
          try {
            if (
              (await store.compareAndSwap(
                key(value),
                found.revision,
                next,
                signal
              )) !== true
            ) {
              return fail('CONFLICT');
            }
          } catch (cause) {
            if (cause instanceof ShortLinkError) {
              throw cause;
            }
            throw new ShortLinkError('UNAVAILABLE', 'unknown', cause, value);
          }
          return next;
        },
        true
      );
    },
    /** Resolve public GET/HEAD requests under the fixed origin and namespace.
     * @param {Request} request - Public request; forwarded headers never select the origin.
     * @returns {Promise<Response>} Body-free redirect or redacted no-store failure; management stays separate.
     */
    async handler(request: Request): Promise<Response> {
      if (
        new URL(request.url).origin !== publicOrigin ||
        (request.headers.has('host') &&
          request.headers.get('host') !== new URL(publicOrigin).host)
      ) {
        return new Response(null, { status: 421 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, {
          status: 405,
          headers: { allow: 'GET, HEAD' },
        });
      }
      /** Normalized URL path used for reserved-path or request namespace checks. */
      const path = new URL(request.url).pathname;
      if (!path.startsWith(prefix)) {
        return new Response(null, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
      /** Validated URL-safe generated or custom slug; only confirmed random collisions are retried. */
      const candidate = path.slice(prefix.length);
      try {
        slug(candidate);
      } catch {
        return new Response(null, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
      try {
        /** Explicit destination-policy or resolution outcome; unknown values are not treated as success. */
        const result = await run({ signal: request.signal }, async (signal) => {
          /** Current validated durable reservation; absence and unauthorized access remain distinct internally. */
          const found = await read(candidate, signal);
          if (
            !found ||
            found.revoked ||
            (found.expiresAt !== null && found.expiresAt <= clock())
          ) {
            return null;
          }
          destination(found.destination);
          return found;
        });
        if (!result) {
          return new Response(null, {
            status: 404,
            headers: { 'cache-control': 'no-store' },
          });
        }
        /** Body-free redirect representation; optional analytics runs independently of its validity. */
        const response = new Response(null, {
          status: result.status,
          headers: {
            location: result.destination,
            'cache-control': [301, 308].includes(result.status)
              ? `public, max-age=${permanent}`
              : 'no-store',
            'referrer-policy': 'no-referrer',
          },
        });
        click(request, result);
        return response;
      } catch {
        return new Response(null, {
          status: 503,
          headers: { 'cache-control': 'no-store', 'retry-after': '1' },
        });
      }
    },
    status: () =>
      Object.freeze({
        closed,
        pending: pending.size,
        analyticsPending: clicks.size,
        analyticsDropped: dropped,
        analyticsErrors,
      }),
    /** Stop admission and cooperatively abort, then await all native and analytics settlement.
     * @returns {Promise<void>} Shared drain promise; borrowed stores stay open and hung host work can delay it.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      lifetime.abort();
      return (closing = (async () => {
        await Promise.allSettled([...pending, ...clicks]);
        clickKey?.fill(0);
      })());
    },
    route: prefix + ':slug',
  };
  return service;
}
export type ShortLinkService = ReturnType<typeof createShortLinkService>;
