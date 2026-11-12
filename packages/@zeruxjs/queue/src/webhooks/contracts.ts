import type { MessageAuthenticatorOptions } from '@zeruxjs/security/crypto';
/** Fixed public webhook failure with a non-enumerable private underlying cause. */
export class WebhookError extends Error {
  /** Retain a fixed public webhook code and optional non-enumerable private cause without logging payloads, signing keys or signed URLs.
   * @param {string} code - Fixed public workflow error discriminator.
   * @param {unknown} cause - Optional private dependency/native cause.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Webhook error (${code})`);
    this.name = 'WebhookError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Construct a fixed public error with an optional separately retained private cause.
 * @param {string} code - Fixed public failure code.
 * @param {unknown} cause - Optional private original cause.
 * @returns {WebhookError} Redacted error whose cause remains private.
 */
export const fail = (code: string, cause?: unknown) =>
  new WebhookError(code, cause);
/** Validate bounded opaque event/tenant/destination/delivery reference syntax; syntax never grants permission.
 * @param {unknown} value - Unknown identifier, maximum 96 safe ASCII characters.
 * @returns {void} Narrows a valid opaque reference or throws a fixed error.
 */
export function id(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
  ) {
    throw fail('INVALID_REFERENCE');
  }
}
/** Validate a safe-integer workflow limit before persistence or outbound work.
 * @param {unknown} value - Unknown explicit limit/counter.
 * @param {number} min - Inclusive permitted minimum.
 * @param {number} max - Inclusive permitted maximum.
 * @returns {number} Validated integer; invalid values reject without echoing private input.
 */
export function number(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('INVALID_LIMIT');
  }
  return value;
}
/** Validate plain own-data input fields without invoking accessors or accepting unexpected configuration.
 * @param {unknown} value - Unknown input object.
 * @param {readonly string[]} allowed - Fixed operation-owned field allowlist.
 * @returns {void} Narrows valid plain own-data fields; operation-specific values remain separately validated.
 */
export function fields(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d)
    )
  ) {
    throw fail('INVALID_INPUT');
  }
}
/** Snapshot plain JSON into a bounded deterministic envelope without executing getters, source text or custom serializers.
 * @param {unknown} value - Unknown object body; raw private contents stay in the host-owned durable store.
 * @returns {string} Serialized UTF-8 body, at most 64 KiB/depth 16/8192 nodes; unsafe names/cycles/classes reject.
 */
export function bodyJSON(value: unknown): string {
  let nodes = 0,
    chars = 0;
  /** Current recursive ancestor set rejecting cycles without retaining private body objects. */
  const seen = new Set<object>();
  /** Copy only plain own-data JSON while enforcing node/depth/character budgets.
   * @param {unknown} v - One untrusted JSON value.
   * @param {number} depth - Current nesting depth, starting at zero.
   * @returns {unknown} Plain independent JSON value or explicit budget/shape rejection.
   */
  const copy = (v: unknown, depth: number): any => {
    if (++nodes > 8192 || depth > 16) {
      throw fail('BODY_LIMIT');
    }
    if (typeof v === 'string') {
      chars += v.length;
      if (chars > 65536) {
        throw fail('BODY_LIMIT');
      }
      return v;
    }
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      return v;
    }
    if (
      !v ||
      typeof v !== 'object' ||
      seen.has(v) ||
      ![Object.prototype, null, Array.prototype].includes(
        Object.getPrototypeOf(v)
      )
    ) {
      throw fail('INVALID_BODY');
    }
    /** Bounded own keys; reject sparse/excessive arrays before recursive copying. */
    const keys = Object.keys(v);
    if (
      keys.length > 8192 ||
      (Array.isArray(v) &&
        (v.length > 8192 ||
          keys.length !== v.length ||
          keys.some((key, i) => key !== String(i))))
    ) {
      throw fail('BODY_LIMIT');
    }
    seen.add(v);
    /** Independent JSON node snapshot without executing getters or custom serializers. */
    const out: any = Array.isArray(v) ? [] : {};
    // Copy only bounded own data descriptors; no getter or custom source can execute.
    for (const key of keys) {
      /** Own property descriptor checked before reading its data value. */
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !('value' in d)
      ) {
        throw fail('INVALID_BODY');
      }
      chars += key.length;
      if (chars > 65536) {
        throw fail('BODY_LIMIT');
      }
      out[key] = copy(d.value, depth + 1);
    }
    seen.delete(v);
    return out;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('INVALID_BODY');
  }
  /** Complete serialized envelope checked for actual UTF-8 byte budget before persistence. */
  const body = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(body) > 65536) {
    throw fail('BODY_LIMIT');
  }
  return body;
}
export type WebhookState =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'uncertain'
  | 'dead';
export interface WebhookReference {
  /** Server-verified tenant scope required in every durable key and authorization decision. */
  tenant: string;
  /** Stable opaque per-delivery identifier; not an exactly-once receiver guarantee. */
  deliveryId: string;
}
export interface WebhookInput extends WebhookReference {
  /** Stable application event identity inside the signed body. */
  eventId: string;
  /** Private registered destination reference; not a caller URL. */
  destination: string;
  /** Explicit application payload schema version, positive and at most 1000000. */
  schemaVersion: number;
  /** Plain bounded event data; never executable code or logged by default. */
  payload: Record<string, unknown>;
}
export interface WebhookAttempt {
  /** Attempt start epoch milliseconds. */
  at: number;
  /** Observed attempt duration in milliseconds; no private URL labels. */
  durationMs: number;
  /** Explicit durable delivery state after this attempt. */
  outcome: WebhookState;
  /** Fixed redacted outcome code without raw causes or payload values. */
  code: string;
  /** Optional observed HTTP status, integer 100 through 599. */
  httpStatus?: number;
}
export interface WebhookRecord extends WebhookReference {
  /** Versioned host-owned durable-store/transport or record contract discriminator. */
  contract: 1;
  /** Stable application event identity inside the signed body. */
  eventId: string;
  /** Private registered destination reference; not a caller URL. */
  destination: string;
  /** Explicit application payload schema version, positive and at most 1000000. */
  schemaVersion: number;
  /** Private immutable exact serialized signed JSON envelope, at most 64 KiB. */
  body: string;
  /** SHA-256 of immutable body bytes; integrity is not permission or authorship. */
  bodyHash: string;
  /** Positive durable optimistic revision, scoped to tenant plus delivery ID. */
  revision: number;
  /** Pending/sending/delivered/uncertain/dead; unknown acknowledgements never auto-resend. */
  state: WebhookState;
  /** Total claimed attempts, capped by policy and never reset on redrive. */
  attempts: number;
  /** Immutable original admission epoch milliseconds used by total-age policy. */
  createdAt: number;
  /** Most recent durable revision epoch milliseconds. */
  updatedAt: number;
  /** Earliest due retry time, bounded by total-age/attempt policy. */
  nextAt: number;
  /** Sending claim token/deadline, null outside sending state; expiry becomes uncertain. */
  lease: null | {
    /** Opaque per-claim ownership token; not a public access credential. */
    token: string;
    /** Sending lease expiration in epoch milliseconds; not proof remote work stopped. */
    until: number;
  };
  /** At most 20 redacted terminal attempt facts, with no body, URL, token or raw cause. */
  history: WebhookAttempt[];
}
/** Host-owned linearizable durable CAS. Methods must scope every key/condition to tenant+deliveryId. */
export interface WebhookStore {
  /** Versioned host-owned durable-store/transport or record contract discriminator. */
  readonly contract: 'webhook-cas-v1';
  /** Read one private tenant-plus-delivery record from the host linearizable durable store.
   * @param {WebhookReference} reference - Verified tenant/delivery compound key, reauthorized by the workflow.
   * @returns {Promise<WebhookRecord | null>} Private durable record or null; never a public inspect projection.
   */
  get(reference: WebhookReference): Promise<WebhookRecord | null>;
  /** Atomically replace one exact tenant/delivery revision while preserving immutable event facts and updating indexed state/lease/due fields.
   * @param {WebhookReference} reference - Verified compound key.
   * @param {number} revision - Exact expected durable revision.
   * @param {WebhookRecord} next - Complete validated next record on the same compound key.
   * @returns {Promise<boolean>} True only for the winning durable compare-and-swap; no local get/set emulation.
   */
  cas(
    reference: WebhookReference,
    revision: number,
    next: WebhookRecord
  ): Promise<boolean>;
  /** Page sorted due pending references and expired sending leases only, using host-owned durable indexes.
   * @param {string} tenant - Verified tenant scope, never inferred from a caller email.
   * @param {number} now - Validated current epoch milliseconds.
   * @param {string | null} cursor - Exclusive ascending delivery-ID continuation or null.
   * @param {number} limit - Finite bounded page count supplied by the workflow.
   * @returns {Promise<object>} Ordered opaque IDs and consistent continuation; no bodies or signing credentials.
   */
  due(
    tenant: string,
    now: number,
    cursor: string | null,
    limit: number
  ): Promise<{
    /** Finite sorted opaque due delivery IDs without stored bodies. */
    ids: string[];
    /** Stable ascending continuation, or null when that store page is complete. */
    next: string | null;
  }>;
}
export interface WebhookDestination {
  /** Server-verified tenant scope required in every durable key and authorization decision. */
  tenant: string;
  /** Exact private registry reference matching the record destination. */
  ref: string;
  /** Approved private HTTPS registry URL; never emitted in inspection/attempt telemetry. */
  url: string;
  /** Required current host destination approval, rechecked before operations. */
  enabled: true;
  /** Required host declaration of receiver idempotency; deployment must qualify it. */
  consumerIdempotency: true;
  /** Private current/previous native authenticator keyring resolved for each operation. */
  keys: MessageAuthenticatorOptions;
}
export interface WebhookResponse {
  /** Observed complete bounded HTTP status. */
  status: number;
  /** Optional bounded server hint; workflow caps it within explicit retry/age policy. */
  retryAfter?: string;
}
export interface WebhookTransport {
  /** Versioned host-owned durable-store/transport or record contract discriminator. */
  readonly contract: 'webhook-https-v1';
  /** Validate the current registered destination policy before claiming or sending; does not fetch remote content.
   * @param {string} url - Private registry URL checked against the explicit transport origin policy.
   * @returns {void} Rejects disallowed destinations before outbound side effects.
   */
  validate(url: string): void;
  /** Send one signed bounded HTTPS attempt with connection-time address validation and no redirect following.
   * @param {object} request - Private approved destination, exact body/headers, owned signal and finite timeout.
   * @param {string} request.url - Private approved HTTPS registry destination.
   * @param {string} request.body - Exact immutable signed UTF-8 JSON body.
   * @param {Record<string,string>} request.headers - Fixed signed protocol headers only.
   * @param {AbortSignal} request.signal - Owned cooperative attempt cancellation.
   * @param {number} request.timeoutMs - Finite attempt deadline.
   * @returns {Promise<WebhookResponse>} Complete bounded HTTP response facts; ambiguous post-connect failures must remain uncertain.
   */
  send(request: {
    /** Approved private HTTPS registry URL; never emitted in inspection/attempt telemetry. */
    url: string;
    /** Private immutable exact serialized signed JSON envelope, at most 64 KiB. */
    body: string;
    /** Only fixed signed protocol headers; never arbitrary cookies/credentials. */
    headers: Record<string, string>;
    /** Owned cooperative HTTP cancellation; abort never proves remote rollback. */
    signal: AbortSignal;
    /** Finite HTTP attempt deadline, 1 through 30000 ms. */
    timeoutMs: number;
  }): Promise<WebhookResponse>;
}
export interface WebhookQueuePublisher {
  /** Required explicit acknowledged-delivery contract; destructive queues reject. */
  readonly acknowledged: true;
  /** Must be false for durable webhook delivery. */
  readonly destructiveRead: false;
  /** Publish only a verified tenant/delivery reference to an explicitly acknowledged non-destructive queue.
   * @param {WebhookReference} reference - Opaque durable workflow reference, never payload or signing material.
   * @returns {Promise<unknown>} Backend-specific publish receipt; receiver idempotency remains mandatory.
   */
  publish(reference: WebhookReference): Promise<unknown>;
}
export interface WebhookPolicy {
  /** Total attempt ceiling, 1 through 20, preserved across redrive. */
  maxAttempts: number;
  /** Total delivery age, 1 second through 30 days from original creation. */
  maxAgeMs: number;
  /** Positive exponential retry base, at most one day. */
  baseDelayMs: number;
  /** Positive retry ceiling, at most one day and at least the base. */
  maxDelayMs: number;
  /** Maximum accepted Retry-After hint, zero through one day. */
  retryAfterMaxMs: number;
  /** At most 16 explicitly declared 408/425/429/5xx retryable responses. */
  transientStatuses: readonly number[];
  /** Explicit retry policy only for transport outcomes known to precede an HTTP write. */
  retryNotSent: boolean;
}
