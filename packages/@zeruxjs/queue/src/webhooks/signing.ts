import {
  createMessageAuthenticator,
  type MessageAuthenticatorOptions,
} from '@zeruxjs/security/crypto';
import { fail, id, number } from './contracts.js';
/** Serialize fixed domain plus verified scope and timestamp for security-owned MAC framing.
 * @param {string} tenant - Trusted verified tenant scope.
 * @param {string} destination - Trusted receiver destination reference.
 * @param {string} deliveryId - Stable opaque delivery identity.
 * @param {number} timestamp - Validated Unix-second timestamp.
 * @returns {string} Deterministic domain-separated context; no signing material included.
 */
const context = (
  tenant: string,
  destination: string,
  deliveryId: string,
  timestamp: number
) =>
  JSON.stringify([
    'zerux.webhook.v1',
    tenant,
    destination,
    deliveryId,
    timestamp,
  ]);
/** Authenticate exact bounded body bytes and trusted tenant/destination/delivery/time context with the security-owned native HMAC keyring. Destroy temporary key copies in finally.
 * @param {object} input - Trusted routing scope, epoch-second timestamp and exact private body.
 * @param {string} input.tenant - Trusted verified tenant.
 * @param {string} input.destination - Registered receiver destination.
 * @param {string} input.deliveryId - Opaque delivery reference.
 * @param {number} input.timestamp - Unix-second signing timestamp.
 * @param {string} input.body - Exact bounded private body bytes as UTF-8 text.
 * @param {MessageAuthenticatorOptions} keys - Host-owned active current/previous 32-byte key policy; no key material is returned.
 * @returns {Record<string,string>} Fixed V1 signed headers; this is a shared-MAC envelope, not HTTP Message Signatures or authorization.
 */
export function signWebhook(
  input: {
    /** Trusted verified tenant scope; never accepted solely from an unverified header. */
    tenant: string;
    /** Trusted receiver destination reference included in authenticated context. */
    destination: string;
    /** Stable opaque delivery reference bound to both authentication and replay scope. */
    deliveryId: string;
    /** Unix-second timestamp for signing; received decimal header text for verification. */
    timestamp: number;
    /** Exact immutable UTF-8 JSON body, at most 64 KiB; never logged or evaluated. */
    body: string;
  },
  keys: MessageAuthenticatorOptions
) {
  id(input.tenant);
  id(input.destination);
  id(input.deliveryId);
  number(input.timestamp, 0, 8640000000000);
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body) > 65536) {
    throw fail('BODY_LIMIT');
  }
  /** Temporary native authenticator/key copies, destroyed in finally after sign/verify. */
  const mac = createMessageAuthenticator({ ...keys, maxBytes: 65536 });
  try {
    /** Native key-ID/tag result over exact private body bytes and trusted context. */
    const signature = mac.sign(
      input.body,
      context(
        input.tenant,
        input.destination,
        input.deliveryId,
        input.timestamp
      )
    );
    return {
      'x-zerux-webhook-id': input.deliveryId,
      'x-zerux-webhook-timestamp': String(input.timestamp),
      'x-zerux-webhook-signature': `v1.${signature.kid}.${signature.tag}`,
    };
  } finally {
    mac.destroy();
  }
}
/** Verify exact bytes, trusted scope, rotating key selection and bounded freshness without consuming replay state. Invalid inputs/key policy return false.
 * @param {object} input - Received exact body and headers plus trusted receiver tenant/destination scope.
 * @param {string} input.tenant - Trusted receiver tenant, not header-derived.
 * @param {string} input.destination - Trusted receiver destination.
 * @param {string} input.deliveryId - Received opaque delivery reference.
 * @param {string} input.timestamp - Received decimal Unix-second header.
 * @param {string} input.signature - Received restricted V1 MAC header.
 * @param {string} input.body - Exact received body text.
 * @param {MessageAuthenticatorOptions} keys - Host-configured rotating native authenticator keys; token-provided key URLs are unsupported.
 * @param {object} options - Optional trusted clock and accepted age window.
 * @param {number} [options.now] - Optional trusted current milliseconds.
 * @param {number} [options.maxAgeMs] - Optional freshness ceiling, maximum one hour.
 * @returns {boolean} Whether authentication/freshness match; receiver idempotency and authorization remain separate.
 */
export function verifyWebhook(
  input: {
    /** Trusted verified tenant scope; never accepted solely from an unverified header. */
    tenant: string;
    /** Trusted receiver destination reference included in authenticated context. */
    destination: string;
    /** Stable opaque delivery reference bound to both authentication and replay scope. */
    deliveryId: string;
    /** Unix-second timestamp for signing; received decimal header text for verification. */
    timestamp: string;
    /** Restricted V1 key-ID/tag header; no algorithm or endpoint discovery. */
    signature: string;
    /** Exact immutable UTF-8 JSON body, at most 64 KiB; never logged or evaluated. */
    body: string;
  },
  keys: MessageAuthenticatorOptions,
  options: {
    /** Optional trusted epoch-millisecond clock, default Date.now. */
    now?: number;
    /** Accepted freshness window, default five minutes and maximum one hour; future timestamps reject. */
    maxAgeMs?: number;
  } = {}
): boolean {
  try {
    id(input.tenant);
    id(input.destination);
    id(input.deliveryId);
    /** Validated trusted verification/claim time in epoch milliseconds. */
    const now = number(options.now ?? Date.now(), 0, 8640000000000000);
    /** Validated accepted packet freshness window, default five minutes. */
    const age = number(options.maxAgeMs ?? 300000, 1, 3600000);
    if (
      typeof input.timestamp !== 'string' ||
      !/^\d{1,13}$/.test(input.timestamp) ||
      typeof input.signature !== 'string' ||
      input.signature.length > 160 ||
      typeof input.body !== 'string' ||
      Buffer.byteLength(input.body) > 65536
    ) {
      return false;
    }
    /** Validated received epoch-second header, checked against current time and age. */
    const timestamp = number(Number(input.timestamp), 0, 8640000000000);
    if (timestamp * 1000 > now || now - timestamp * 1000 > age) {
      return false;
    }
    /** Restricted V1 key-ID/tag match; no arbitrary algorithm or remote key URL. */
    const parts = /^v1\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43})$/.exec(
      input.signature
    );
    if (!parts) {
      return false;
    }
    /** Temporary native authenticator/key copies, destroyed in finally after sign/verify. */
    const mac = createMessageAuthenticator({ ...keys, maxBytes: 65536 });
    try {
      return mac.verify(
        input.body,
        { v: 1, alg: 'HS256', kid: parts[1], tag: parts[2] },
        context(input.tenant, input.destination, input.deliveryId, timestamp)
      );
    } finally {
      mac.destroy();
    }
  } catch {
    return false;
  }
}
export interface WebhookReplayStore {
  /** Required host-owned linearizable replay-claim contract discriminator. */
  readonly contract: 'webhook-replay-v1';
  /** Atomically claim the verified compound replay key once through explicit retention. Coordinate this claim with durable business/idempotency state to avoid burning a failed event.
   * @param {object} scope - Verified tenant/destination/delivery plus required expiry.
   * @param {string} scope.tenant - Verified tenant replay namespace.
   * @param {string} scope.destination - Verified receiver replay namespace.
   * @param {string} scope.deliveryId - Verified opaque delivery ID.
   * @param {number} scope.expiresAt - Explicit retained-claim expiry.
   * @returns {Promise<boolean>} True only for the unique winning durable claim; false for a retained duplicate.
   */
  consume(scope: {
    /** Trusted verified tenant scope; never accepted solely from an unverified header. */
    tenant: string;
    /** Trusted receiver destination reference included in authenticated context. */
    destination: string;
    /** Stable opaque delivery reference bound to both authentication and replay scope. */
    deliveryId: string;
    /** Explicit retained-claim expiry in epoch milliseconds; cover the sender retry/redrive horizon. */
    expiresAt: number;
  }): Promise<boolean>;
}
/** Verify before invoking the host linearizable replay store. A replay claim alone is not an atomic receiver business transaction or exactly-once processing.
 * @param {Parameters<typeof verifyWebhook>[0]} input - Exact received packet plus trusted receiver scope.
 * @param {MessageAuthenticatorOptions} keys - Host-configured current/previous native keys.
 * @param {WebhookReplayStore} replay - Host-owned durable webhook-replay-v1 unique-claim store.
 * @param {object} options - Required retention and optional freshness/clock policy.
 * @param {number} [options.now] - Optional trusted current milliseconds.
 * @param {number} [options.maxAgeMs] - Optional accepted freshness window.
 * @param {number} options.retentionMs - Required retained replay horizon.
 * @returns {Promise<'verified' | 'duplicate' | 'invalid'>} Explicit authentication/replay outcome; store failures reject without exposing private cause text.
 */
export async function verifyAndConsumeWebhook(
  input: Parameters<typeof verifyWebhook>[0],
  keys: MessageAuthenticatorOptions,
  replay: WebhookReplayStore,
  options: {
    /** Optional trusted epoch-millisecond clock, default Date.now. */
    now?: number;
    /** Accepted freshness window, default five minutes and maximum one hour; future timestamps reject. */
    maxAgeMs?: number;
    /** Required durable replay retention, one second through 30 days. */
    retentionMs: number;
  }
): Promise<'verified' | 'duplicate' | 'invalid'> {
  if (
    replay?.contract !== 'webhook-replay-v1' ||
    typeof replay.consume !== 'function'
  ) {
    throw fail('REPLAY_STORE_REQUIRED');
  }
  /** Required explicit retained replay horizon; does not create a cleanup scheduler. */
  const retention = number(options.retentionMs, 1000, 30 * 86400000);
  /** Validated trusted verification/claim time in epoch milliseconds. */
  const now = options.now ?? Date.now();
  if (!verifyWebhook(input, keys, options)) {
    return 'invalid';
  }
  try {
    /** Literal boolean result from the host linearizable unique-claim operation. */
    const claimed = await replay.consume({
      tenant: input.tenant,
      destination: input.destination,
      deliveryId: input.deliveryId,
      expiresAt: now + retention,
    });
    if (typeof claimed !== 'boolean') {
      throw fail('REPLAY_STORE_FAILED');
    }
    return claimed ? 'verified' : 'duplicate';
  } catch (cause) {
    throw fail('REPLAY_STORE_FAILED', cause);
  }
}
