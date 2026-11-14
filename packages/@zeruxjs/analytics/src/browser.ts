import type { EventProperties } from './types.js';
/**
 * Generate an opaque secure random token only when the caller has already obtained consent.
 * @returns {string} A 48-character lowercase hex token; persistence belongs to the caller.
 * @throws {Error} Secure Web Crypto randomness is required; caller must obtain consent before requesting an ID.
 */
export function createAnonymousAnalyticsId(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random identity generator unavailable');
  }
  /** Caller-requested opaque random bytes; no cookie, storage or fingerprint is consulted. */
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

/**
 * Construct an opt-in browser send client without cookies, fingerprints or automatic identifiers.
 * @param {object} options - Host-owned configuration; nested declarations describe bounds, consent and borrowed resources.
 * @param {string} options.endpoint - Explicit configured collector URL; never derive it from event content.
 * @param {typeof fetch | undefined} options.fetch - Borrowed Fetch transport; this client neither closes pools nor starts work on import.
 * @param {number | undefined} options.timeoutMs - Per-send timeout in milliseconds, default 5000, bounded from 100 through 60000.
 * @param {boolean | undefined} options.enabled - Initial browser send switch, default true; consent checks remain independent.
 * @param {((message: string) => void) | undefined} options.onWarning - Optional best-effort warning observer; fixed warning text must not contain private event values.
 * @param {'granted' | 'denied' | 'unknown' | undefined} options.consent - Opt in explicitly before sending identity-bearing events.
 * @param {boolean | undefined} options.requireConsent - When true, unknown consent suppresses even nonidentity sends until explicit opt-in.
 * @returns {object} Send/enable/consent methods over a borrowed Fetch transport; construction sends nothing.
 * @throws {TypeError | RangeError} Invalid endpoint, timeout or initial consent rejects before any send.
 */
export function createEventClient(options: {
  /** Explicit configured collector URL; never derive it from event content. */
  endpoint: string;
  /** Borrowed Fetch transport; this client neither closes pools nor starts work on import. */
  fetch?: typeof fetch;
  /** Per-send timeout in milliseconds, default 5000, bounded from 100 through 60000. */
  timeoutMs?: number;
  /** Initial browser send switch, default true; consent checks remain independent. */
  enabled?: boolean;
  /** Optional best-effort warning observer; fixed warning text must not contain private event values. */
  onWarning?: (message: string) => void;
  /** Initial explicit consent, default unknown; identity-bearing sends require granted. */
  consent?: 'granted' | 'denied' | 'unknown';
  /** When true, unknown consent suppresses even nonidentity sends until explicit opt-in. */
  requireConsent?: boolean;
}) {
  /** Explicit host-approved collector destination; no automatic endpoint discovery. */
  const endpoint = new URL(options.endpoint);
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new TypeError('Invalid analytics endpoint');
  }
  /** Borrowed Fetch transport; this client neither owns nor closes its pools. */
  const fetcher = options.fetch ?? fetch;
  /** Per-send native AbortSignal timeout in milliseconds, validated before first send. */
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60000) {
    throw new RangeError('Invalid analytics timeout');
  }
  let enabled = options.enabled !== false,
    warningSent = false,
    consent = options.consent ?? 'unknown';
  if (!['granted', 'denied', 'unknown'].includes(consent)) {
    throw new TypeError('Invalid analytics consent');
  }
  return {
    /**
     * Change only this client’s send switch; consent checks remain independent.
     * @param {boolean} value - Explicit enable/consent state; values are validated by this method.
     * @returns {void} No value; only literal true enables future sends.
     */
    setEnabled(value: boolean) {
      enabled = value === true;
    },
    /**
     * Set the explicit current browser consent state without generating or persisting identity.
     * @param {'granted' | 'denied' | 'unknown'} value - Explicit enable/consent state; values are validated by this method.
     * @returns {void} No value; unknown enum values throw TypeError.
     * @throws {TypeError} Only granted, denied and unknown are accepted.
     */
    setConsent(value: 'granted' | 'denied' | 'unknown') {
      if (!['granted', 'denied', 'unknown'].includes(value)) {
        throw new TypeError('Invalid analytics consent');
      }
      consent = value;
    },
    /**
     * Send one bounded web-event envelope only after the configured consent/identity checks.
     * @param {string} name - Validated event label or explicitly configured structured connector/table name, as declared by this signature.
     * @param {Record<string, string | number | boolean | null>} properties - Inert bounded scalar event values; never SQL, executable code or automatic identity. Defaults to {}.
     * @param {object} options2 - Per-event host-minimized labels, identity and cancellation; no identity is synthesized. Defaults to {}.
     * @param {AbortSignal | undefined} options2.signal - Cooperative operation cancellation; abort does not prove a query stopped or rolled back.
     * @param {string | undefined} options2.site - Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping.
     * @param {string | undefined} options2.pathname - Host-minimized path label; never assume this string proves a public or authorized URL.
     * @param {string | undefined} options2.sessionId - Opaque host-assigned session token; persistence requires explicit granted consent.
     * @param {string | undefined} options2.visitorId - Opaque pseudonymous visitor token; no email, IP, cookie or fingerprint is generated automatically.
     * @param {number | undefined} options2.schemaVersion - Explicit retained registry version; absence selects the latest registered version in this generation.
     * @param {EventProperties | undefined} options2.userProperties - Registered consent-gated visitor properties for this event, never an automatic global profile.
     * @param {EventProperties | undefined} options2.sessionProperties - Registered consent-gated session properties for this event; requires its opaque session identifier.
     * @returns {Promise<boolean>} True means endpoint acceptance, never durable persistence; expected validation/network/abort failures return false.
     */
    async track(
      name: string,
      properties: Record<string, string | number | boolean | null> = {},
      options2: {
        /** Cooperative operation cancellation; abort does not prove a query stopped or rolled back. */
        signal?: AbortSignal;
        /** Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping. */
        site?: string;
        /** Host-minimized path label; never assume this string proves a public or authorized URL. */
        pathname?: string;
        /** Opaque host-assigned session token; persistence requires explicit granted consent. */
        sessionId?: string;
        /** Opaque pseudonymous visitor token; no email, IP, cookie or fingerprint is generated automatically. */
        visitorId?: string;
        /** Explicit retained registry version; absence selects the latest registered version in this generation. */
        schemaVersion?: number;
        /** Registered consent-gated visitor properties for this event, never an automatic global profile. */
        userProperties?: EventProperties;
        /** Registered consent-gated session properties for this event; requires its opaque session identifier. */
        sessionProperties?: EventProperties;
      } = {}
    ): Promise<boolean> {
      if (
        !enabled ||
        consent === 'denied' ||
        (options.requireConsent && consent !== 'granted')
      ) {
        return false;
      }
      try {
        // No local identifiers leak before explicit opt-in; invalid events fail without a network call.
        if (
          (options2.sessionId ||
            options2.visitorId ||
            options2.userProperties ||
            options2.sessionProperties) &&
          consent !== 'granted'
        ) {
          return false;
        }
        if (
          (options2.userProperties && !options2.visitorId) ||
          (options2.sessionProperties && !options2.sessionId)
        ) {
          return false;
        }
        if (
          options2.schemaVersion !== undefined &&
          (!Number.isSafeInteger(options2.schemaVersion) ||
            options2.schemaVersion < 1 ||
            options2.schemaVersion > 10000)
        ) {
          return false;
        }
        if (
          typeof name !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(name) ||
          !properties ||
          typeof properties !== 'object' ||
          Array.isArray(properties) ||
          Object.keys(properties).length > 40
        ) {
          return false;
        }
        /** Bounded web-event envelope includes identity properties only after explicit granted consent. */
        const body = JSON.stringify({
          name,
          properties,
          site: options2.site,
          pathname: options2.pathname,
          source: 'web',
          consent,
          schemaVersion: options2.schemaVersion,
          ...(consent === 'granted'
            ? {
                sessionId: options2.sessionId,
                visitorId: options2.visitorId,
                userProperties: options2.userProperties,
                sessionProperties: options2.sessionProperties,
              }
            : {}),
        });
        if (new TextEncoder().encode(body).byteLength > 8192) {
          return false;
        }
        /** Native joined signal combines this send’s deadline with optional caller cancellation. */
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(options2.signal ? [options2.signal] : []),
        ]);
        /** HTTP success reports endpoint acceptance only, never a durable database commit. */
        const response = await fetcher(endpoint.href, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal,
          credentials: 'omit',
          cache: 'no-store',
        });
        if (response.ok) {
          return true;
        }
      } catch {
        /* Network loss and aborts are expected for best-effort telemetry. */
      }
      if (!warningSent) {
        warningSent = true;
        try {
          (options.onWarning ?? console.warn)(
            '[analytics] Browser event delivery unavailable; skipped'
          );
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
      return false;
    },
  };
}
