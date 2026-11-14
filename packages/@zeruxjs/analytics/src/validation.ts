import type {
  AnalyticsEventInput,
  AnalyticsRow,
  EventProperties,
} from './types.js';
import { randomUUID } from 'node:crypto';
import { validRequestId } from './request-id.js';
/** Allowlisted SQL table identifier grammar; not a general SQL expression parser. */
const ident = /^[a-z][a-z0-9_]{0,62}$/;
/** Bounded event/property label grammar rejects arbitrary nested or executable expressions. */
const eventName = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/;
/**
 * Assert the existing bounded table-identifier grammar before structured DB operations.
 * @param {string} name - Validated event label or explicitly configured structured connector/table name, as declared by this signature.
 * @returns {string} Unchanged table identifier; invalid syntax throws TypeError.
 * @throws {TypeError} Identifiers outside the existing table grammar reject.
 */
export function validateTableName(name: string): string {
  if (!ident.test(name)) {
    throw new TypeError('Invalid analytics table');
  }
  return name;
}
/**
 * Validate legacy scalar/consent/identity input and construct one bounded event row.
 * @param {AnalyticsEventInput} input - Untrusted event input; host authentication and tenant authorization remain separate.
 * @returns {AnalyticsRow} Generated event row; no database insert or durable acknowledgement occurs.
 * @throws {TypeError | RangeError} Invalid names, scalar fields, consent, identities, timestamps or byte budgets reject before storage.
 */
export function validateEvent(input: AnalyticsEventInput): AnalyticsRow {
  if (!input || typeof input !== 'object' || !eventName.test(input.name)) {
    throw new TypeError('Invalid event name');
  }
  /** Existing scalar event-source allowlist; public collectors separately bind browser source. */
  const allowed = ['web', 'server', 'email', 'system'];
  if (input.source !== undefined && !allowed.includes(input.source)) {
    throw new TypeError('Invalid event source');
  }
  /** Caller property map is validated before populating a prototype-free stored copy. */
  const props = input.properties ?? {};
  if (
    !props ||
    typeof props !== 'object' ||
    Array.isArray(props) ||
    Object.keys(props).length > 40
  ) {
    throw new TypeError('Invalid event properties');
  }
  /** Own scalar-property copy excludes reserved correlation/identity/provenance names. */
  const clean: EventProperties = Object.create(null) as EventProperties;
  // Validate every scalar key/value before copying it into the bounded persisted property record.
  for (const [key, value] of Object.entries(props)) {
    if (
      !eventName.test(key) ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      [
        'zVisitorId',
        'zConsent',
        'zRequestId',
        'zRequestUtcDay',
        'zAnalyticsSchema',
      ].includes(key)
    ) {
      throw new TypeError('Invalid property key');
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      typeof value !== 'number'
    ) {
      throw new TypeError('Event values must be scalar');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Invalid numeric event value');
    }
    if (typeof value === 'string' && value.length > 1024) {
      throw new RangeError('Event property too long');
    }
    clean[key] = value;
  }
  if (input.visitorId !== undefined) {
    if (input.consent !== 'granted') {
      throw new TypeError('Visitor ID requires granted consent');
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.visitorId)) {
      throw new TypeError('Invalid opaque visitor ID');
    }
    if (Object.hasOwn(clean, 'zVisitorId')) {
      throw new TypeError('Reserved visitor property');
    }
    clean.zVisitorId = input.visitorId;
  }
  if (
    input.consent !== undefined &&
    !['granted', 'denied', 'unknown'].includes(input.consent)
  ) {
    throw new TypeError('Invalid consent state');
  }
  if (input.consent === 'denied') {
    throw new TypeError('Denied consent cannot persist events');
  }
  if (input.sessionId !== undefined) {
    if (input.consent !== 'granted') {
      throw new TypeError('Session ID requires granted consent');
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.sessionId)) {
      throw new TypeError('Session ID must be an opaque token');
    }
  }
  if (input.requestId !== undefined) {
    if (
      !validRequestId(input.requestId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.requestUtcDay ?? '')
    ) {
      throw new TypeError('Invalid request correlation');
    }
    if (
      Object.hasOwn(clean, 'zRequestId') ||
      Object.hasOwn(clean, 'zRequestUtcDay')
    ) {
      throw new TypeError('Reserved request property');
    }
    clean.zRequestId = input.requestId;
    clean.zRequestUtcDay = input.requestUtcDay!;
  }
  if (input.consent === 'granted') {
    if (Object.hasOwn(clean, 'zConsent')) {
      throw new TypeError('Reserved consent property');
    }
    clean.zConsent = 'granted';
  }
  /** Final stored scalar/identity JSON is charged against the 8192-byte ceiling. */
  const properties_json = JSON.stringify(clean);
  if (Buffer.byteLength(properties_json) > 8192) {
    throw new RangeError('Event properties exceed limit');
  }
  /**
   * Validate an optional legacy stored string without accepting controls or excess length.
   * @param {unknown} v - Optional stored field; absence is represented by the legacy empty string.
   * @param {number} max - Configured byte/character ceiling for this owning validation path.
   * @returns {string} Empty string for absent input; invalid type/length/control characters throw TypeError.
   */
  const string = (v: unknown, max: number) => {
    if (v === undefined) {
      return '';
    }
    if (
      typeof v !== 'string' ||
      v.length > max ||
      // eslint-disable-next-line no-control-regex -- Intentionally rejects control characters; preserve the existing validation range.
      /[\x00-\x1f]/.test(v)
    ) {
      throw new TypeError('Invalid analytics field');
    }
    return v;
  };
  /** Occurrence timestamp is bounded against the existing 30-day past/five-minute future window. */
  const at = input.occurredAt ?? Date.now();
  if (
    !Number.isSafeInteger(at) ||
    at < Date.now() - 30 * 86_400_000 ||
    at > Date.now() + 5 * 60_000
  ) {
    throw new RangeError('Event timestamp outside accepted window');
  }
  return {
    id: randomUUID(),
    event_name: input.name,
    source: input.source ?? 'server',
    site: string(input.site, 200),
    pathname: string(input.pathname, 2048),
    session_id: string(input.sessionId, 128),
    occurred_at: at,
    properties_json,
  };
}

/**
 * Validate optional registered schema provenance independently of storage and durability.
 * @param {AnalyticsEventInput} input - Untrusted event input; host authentication and tenant authorization remain separate.
 * @param {import('./schemas.js').AnalyticsEventSchemaRegistry | undefined} registry - Optional approved versioned schema registry; absence keeps legacy restrictions.
 * @returns {AnalyticsRow} Bounded legacy-compatible row enriched with approved versioned metadata when configured.
 * @throws {TypeError | RangeError} Schema/version/scoped-property validation or final stored-byte limits reject.
 */
export function validateRegisteredEvent(
  input: AnalyticsEventInput,
  registry?: import('./schemas.js').AnalyticsEventSchemaRegistry
): AnalyticsRow {
  /** Optional registry validates event/version/scoped properties before row materialization. */
  const prepared = registry?.prepare(input);
  /** Validated row retains its generated ID and is enriched only with registry provenance. */
  const row = validateEvent(input);
  if (prepared) {
    /** Stored scalar/identity payload receives the already validated versioned schema metadata. */
    const properties = JSON.parse(row.properties_json);
    properties.zAnalyticsSchema = prepared.metadata;
    row.properties_json = JSON.stringify(properties);
    if (Buffer.byteLength(row.properties_json) > 8192) {
      throw new RangeError('Event properties exceed limit');
    }
  } else if (
    input.schemaVersion !== undefined ||
    input.userProperties !== undefined ||
    input.sessionProperties !== undefined
  ) {
    throw new TypeError('Versioned properties require a schema registry');
  }
  return row;
}
