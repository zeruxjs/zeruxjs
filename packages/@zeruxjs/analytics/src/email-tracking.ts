import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { AnalyticsManager } from './manager.js';
import { createMemoryEmailActivityStore } from './email-activity.js';
import type {
  EmailActivityEvent,
  EmailActivityKind,
  EmailActivityStore,
  EmailActivitySummary,
} from './email-activity.js';
export { createMemoryEmailActivityStore } from './email-activity.js';
export type {
  EmailActivityEvent,
  EmailActivityKind,
  EmailActivityLink,
  EmailActivityStore,
  EmailActivitySummary,
} from './email-activity.js';

type Kind = 'open' | 'click';
interface SignedPayload {
  /** Allowlisted open/click token kind. */
  kind: Kind;
  /** Opaque message ID or public key identifier. */
  id: string;
  /** Bounded sending account label, never credentials. */
  account: string;
  /** Bounded optional campaign label. */
  campaign: string;
  /** Private validated HTTPS destination carried in an authenticated payload. */
  url?: string;
  /** Download-link classification, not proof of byte delivery. */
  download?: boolean;
  /** Hashed destination identity for summaries. */
  linkId?: string;
  /** Absolute UTC expiry checked before serving. */
  expires: number;
  /** Random authenticated token nonce. */
  nonce: string;
}
/** Identifier is public; secret must be private and shared by every serving replica. */
export interface EmailTrackingKey {
  /** Opaque message ID or public key identifier. */
  id: string;
  /** Private shared secret; never expose to browser configuration. */
  secret: string;
}
/** The first key signs new links. Previous keys ONLY verify already-issued links. */
export interface EmailTrackingKeyRing {
  /** Current key used to sign new tokens. */
  current: EmailTrackingKey;
  /** At most four old keys retained only for verification. */
  previous?: readonly EmailTrackingKey[];
}
export interface EmailTrackingOptions {
  /** Borrowed best-effort analytics facade. */
  analytics: AnalyticsManager;
  /** Configured HTTPS origin for generated tracking links. */
  baseUrl: string;
  /** Use at least 32 random bytes, provisioned as a secret. Never send to the browser. */
  secret?: string;
  /** Alternative to secret: rotate without breaking already-issued v2/v3 tokens. */
  keyRing?: EmailTrackingKeyRing;
  /** Turn off readable legacy HMAC tokens independently of encrypted v2/v3 links. */
  acceptLegacyHmac?: boolean;
  /** Validated mount path, default /_analytics/email. */
  path?: string;
  /** Token lifetime, default 14 days and maximum 30 days. */
  ttlMs?: number;
  /** Optional allowlist restricting outbound links to exact hosts. */
  allowedLinkHosts?: readonly string[];
  /** Optional activity aggregation; use durable atomic shared storage in production. Defaults to bounded process memory. */
  activityStore?: EmailActivityStore;
  /** Optional borrowed telemetry callback; sanitize diagnostics at the host. */
  onEvent?: (event: EmailActivityEvent) => void | Promise<void>;
  /** Explicit switch for collection/instrumentation. */
  enabled?: boolean;
  /** Upper bound on time spent waiting for each telemetry callback. */
  telemetryTimeoutMs?: number;
  /** Cap unresolved telemetry operations when a DB connection hangs. */
  maxPendingTelemetry?: number;
  /** Optional fixed-message warning observer; exceptions are isolated. */
  onWarning?: (message: string) => void;
}
export interface TrackedEmailMessage {
  /** Explicit per-message policy, separate from marketing recipient consent. */
  tracking?: {
    /** Explicit switch for collection/instrumentation. */
    enabled?: boolean;
    /** Whether opted-in messages include an open pixel (default true). */
    opens?: boolean;
    /** Whether opted-in messages wrap eligible links (default true). */
    clicks?: boolean;
    /** Whether eligible wrapped links can be classified as download clicks. */
    downloads?: boolean;
    /** Explicit HTTPS targets marked as download links. */
    downloadLinks?: readonly string[];
    /** Bounded optional campaign label. */
    campaign?: string;
  };
}
/** Fixed transparent GIF bytes; no remote resource fetch is performed. */
const PIXEL = Uint8Array.from(
  Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
);
/** Encode generated attribute values for this double-quoted tracking markup.
 * @param {string} value - Configured/generated URL attribute value.
 * @returns {string} Escaped attribute text; this helper is not a general HTML sanitizer.
 */
function escapeAttr(value: string) {
  return value.replace(
    /[&"<]/g,
    (char) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;' })[char]!
  );
}
/** Decode only ampersand spellings needed when reading sanitized link attributes.
 * @param {string} value - Existing quoted href text.
 * @returns {string} Candidate URL spelling; URL policy validation remains mandatory.
 */
function decodeHref(value: string) {
  return value.replace(/&(?:amp|#38);/gi, '&');
}
/** Create opt-in signed expiring email tracking over borrowed stores/callbacks. Construction neither registers routes nor sends telemetry.
 * @param {EmailTrackingOptions} config - Private HTTPS origin, secrets/rotation and finite callback budgets.
 * @returns {ReturnType<typeof createEmailTrackingService>} Tracking facade; host owns route authorization, opt-in and shared-store lifecycle.
 */
export function createEmailTrackingService(config: EmailTrackingOptions) {
  /** Validated private host configuration for HTTPS tracking URLs. */
  const base = new URL(config.baseUrl);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new TypeError('Email tracking requires an HTTPS base URL');
  }
  if (config.keyRing !== undefined && config.secret !== undefined) {
    throw new TypeError(
      'Use either email tracking secret or keyRing, not both'
    );
  }
  /** Explicit key-ring mode selects versioned key-ID tokens. */
  const hasRing = config.keyRing !== undefined;
  /** Host-owned rotation settings; current key signs and bounded previous keys verify. */
  const ring = config.keyRing;
  if (
    hasRing &&
    (!ring ||
      typeof ring !== 'object' ||
      !ring.current ||
      !Array.isArray(ring.previous ?? []) ||
      (ring.previous?.length ?? 0) > 4)
  ) {
    throw new TypeError('Invalid email tracking key ring');
  }
  /** Bounded current/previous signing key list, never exposed through diagnostics. */
  const rawKeys: readonly EmailTrackingKey[] = hasRing
    ? [ring!.current, ...(ring!.previous ?? [])]
    : [{ id: 'default', secret: config.secret as string }];
  /** Validated unique public key IDs; secrets remain private. */
  const ids = new Set<string>();
  // Validate bounded key-ring entries before deriving or publishing any token.
  for (const entry of rawKeys) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.secret !== 'string' ||
      Buffer.byteLength(entry.secret) < 32
    ) {
      throw new TypeError(
        'Email tracking secret must contain at least 32 bytes'
      );
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(entry.id) || ids.has(entry.id)) {
      throw new TypeError('Invalid or duplicate email tracking key ID');
    }
    ids.add(entry.id);
  }
  if (
    config.acceptLegacyHmac !== undefined &&
    typeof config.acceptLegacyHmac !== 'boolean'
  ) {
    throw new TypeError('Invalid legacy tracking token policy');
  }
  /** Explicit compatibility policy for previously issued readable HMAC tokens. */
  const acceptLegacyHmac = config.acceptLegacyHmac !== false;
  /** Validated mount path independent of request-supplied hosts or queries. */
  const path = (config.path ?? '/_analytics/email').replace(/\/$/, '');
  if (
    !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..') ||
    path.length > 128
  ) {
    throw new TypeError('Invalid tracking path');
  }
  /** Token expiry duration, default 14 days and maximum 30 days. */
  const ttlMs = config.ttlMs ?? 14 * 24 * 60 * 60_000;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 60_000 ||
    ttlMs > 30 * 86_400_000
  ) {
    throw new RangeError('Invalid tracking token lifetime');
  }
  /** Per-callback telemetry wait limit, default 350ms and maximum 10000ms. */
  const timeoutMs = config.telemetryTimeoutMs ?? 350;
  /** Maximum unresolved telemetry operations, default 64 and maximum 1000. */
  const maxPending = config.maxPendingTelemetry ?? 64;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 10_000 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 1000
  ) {
    throw new RangeError('Invalid email telemetry limits');
  }
  /** Borrowed explicitly shared store or bounded process-local reference fallback. */
  const activityStore =
    config.activityStore ?? createMemoryEmailActivityStore();
  let pending = 0;
  let enabled = config.enabled !== false;
  let warned = false;
  /** Report one fixed telemetry warning without exposing private failures.
   * @returns {void} Warning hook failures are intentionally isolated.
   */
  function warn() {
    if (warned) {
      return;
    }
    warned = true;
    try {
      (config.onWarning ?? console.warn)(
        '[analytics] Email tracking telemetry unavailable; event skipped'
      );
    } catch {
      /* This optional failure is intentionally ignored. */
    }
  }
  /** Bound caller wait and unresolved callback admission without replaying failures.
   * @param {() => Promise<unknown> | unknown} action - Borrowed telemetry callback; it may outlive the wait deadline.
   * @returns {Promise<void>} Settles at callback completion or wait deadline while actual pending work remains counted.
   */
  async function telemetry(
    action: () => Promise<unknown> | unknown
  ): Promise<void> {
    if (pending >= maxPending) {
      warn();
      return;
    }
    pending++;
    // Keep the unresolved operation counted until it actually settles, even if
    // the HTTP response or email send has already reached its wait deadline.
    /** Actual telemetry settlement owns its pending slot beyond caller wait timeout. */
    const operation = Promise.resolve()
      .then(action)
      .then(
        () => {},
        () => {
          warn();
        }
      )
      .finally(() => {
        pending--;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            warn();
            resolve();
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  /** Optional exact lowercased link-host allowlist; no arbitrary destination fetching. */
  const allowed = config.allowedLinkHosts
    ? new Set(config.allowedLinkHosts.map((s) => s.toLowerCase()))
    : undefined;
  // Domain-separated encryption keys. v2's derivation MUST NOT change: links
  // already delivered by the legacy single-secret format depend on it until their expiry.
  /** Domain-separated key material; legacy derivations must remain byte-compatible until expiry. */
  const keys = rawKeys.map((key) => ({
    id: key.id,
    secret: key.secret,
    v2: createHash('sha256')
      .update('zerux-email-tracking-v2\0')
      .update(key.secret)
      .digest(),
    v3: createHash('sha256')
      .update('zerux-email-tracking-v3\0')
      .update(key.secret)
      .digest(),
  }));
  /** Private bounded key-ID lookup for rotation-aware verification. */
  const byId = new Map(keys.map((key) => [key.id, key]));
  /** Encrypt inert payload with the current domain-separated AES-GCM key.
   * @param {SignedPayload} data - Validated tracking data.
   * @returns {string} Canonical versioned wire token; no executable content is evaluated.
   */
  function encrypt(data: SignedPayload) {
    /** Current private encryption key; previous keys never sign newly issued links. */
    const current = keys[0];
    if (!current) {
      throw new Error('Tracking key ring is empty');
    }
    /** Wire token version selected by explicit key-ring versus legacy single-secret configuration. */
    const version = hasRing ? 'v3' : 'v2';
    /** Fresh 96-bit AES-GCM nonce per encrypted tracking token. */
    const iv = randomBytes(12);
    /** Owned one-shot authenticated cipher; no untrusted code is executed. */
    const cipher = createCipheriv('aes-256-gcm', current[version], iv);
    if (version === 'v3') {
      cipher.setAAD(Buffer.from(`v3.${current.id}`));
    }
    /** Encrypted inert JSON payload, finalized before assembling the token. */
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
    ]);
    /** Canonical base64url nonce/ciphertext/tag representation. */
    const body = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
      'base64url'
    );
    return version === 'v3' ? `v3.${current.id}.${body}` : `v2.${body}`;
  }
  /** Verify authenticated bytes before parsing inert JSON.
   * @param {string} encoded - Canonical base64url candidate body.
   * @param {Buffer} key - Private host-derived AES key.
   * @param {string} aad - Optional authenticated version/key-ID binding.
   * @returns {unknown} Authenticated parsed value or null for malformed encoding; authentication/JSON failures may throw to the outer decoder.
   */
  function decrypt(encoded: string, key: Buffer, aad?: string): unknown {
    /** Decoded candidate bytes checked for canonical spelling and minimum authenticated length. */
    const bytes = Buffer.from(encoded, 'base64url');
    // Node accepts non-canonical base64url trailing bits; reject aliases so a
    // changed URL string cannot be treated as the same authenticated token.
    if (bytes.toString('base64url') !== encoded || bytes.length < 29) {
      return null;
    }
    /** One-shot authenticated decipher; plaintext is parsed only after GCM verification. */
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      bytes.subarray(0, 12)
    );
    if (aad) {
      decipher.setAAD(Buffer.from(aad));
    }
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(12, -16)),
        decipher.final(),
      ]).toString('utf8')
    );
  }
  /** Decode only supported formats against the explicitly bounded host key ring.
   * @param {string} token - Syntactically bounded candidate token.
   * @returns {unknown} Authenticated candidate or null; semantic/expiry policy is checked separately.
   */
  function decode(token: string): unknown {
    /** Bounded syntactically checked wire token components. */
    const parts = token.split('.');
    if (parts.length === 3 && parts[0] === 'v3') {
      /** Key-ring selector encoded in the signed tracking token. */
      const keyId = parts[1];
      /** Base64url payload encoded in the signed tracking token. */
      const encoded = parts[2];
      if (!keyId || !encoded) {
        return null;
      }
      /** Allowlisted private verification key selected from host rotation configuration. */
      const key = byId.get(keyId);
      if (!key) {
        return null;
      }
      return decrypt(encoded, key.v3, `v3.${keyId}`);
    }
    if (parts.length !== 2) {
      return null;
    }
    /** Legacy two-part wire components; not arbitrary algorithm selection. */
    const [version, encoded] = parts;
    if (!version || !encoded) {
      return null;
    }
    if (version === 'v2') {
      // v2 did not include a key ID. Try the deliberately bounded key ring
      // so migration from the legacy single-secret format is seamless.
      // Try only the configured previous/current keys; no unbounded key discovery.
      // Try only the configured bounded verification key set.
      for (const key of keys) {
        try {
          /** Authenticated candidate data; semantic and expiry checks still follow. */
          const payload = decrypt(encoded, key.v2);
          if (payload !== null) {
            return payload;
          }
        } catch {
          /* Not this key. */
        }
      }
      return null;
    }
    if (!acceptLegacyHmac) {
      return null;
    }
    // legacy HMAC token compatibility can be explicitly shut down. An
    // empty or malformed signature never passes constant-time comparison.
    /** Canonical supplied HMAC digest, checked for exact length before constant-time comparison. */
    const supplied = Buffer.from(encoded, 'base64url');
    if (supplied.length !== 32 || supplied.toString('base64url') !== encoded) {
      return null;
    }
    // Verify legacy HMACs against only the explicitly configured bounded key ring.
    for (const key of keys) {
      /** Private keyed expected digest; raw keys and payloads are never logged. */
      const expected = createHmac('sha256', key.secret)
        .update(version)
        .digest();
      if (timingSafeEqual(supplied, expected)) {
        return JSON.parse(Buffer.from(version, 'base64url').toString('utf8'));
      }
    }
    return null;
  }
  /** Validate bounded token grammar, authenticated fields, expiry and redirect policy.
   * @param {string} token - Untrusted route token.
   * @param {Kind} kind - Expected allowlisted route kind.
   * @returns {SignedPayload|null} Verified inert payload or null; never throws private decode errors to HTTP callers.
   */
  function open(token: string, kind: Kind): SignedPayload | null {
    if (
      token.length > 4096 ||
      !(
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
        /^v3\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+$/.test(token)
      )
    ) {
      return null;
    }
    try {
      /** Authenticated inert JSON checked against kind/identity/expiry/URL policy. */
      const parsed = decode(token) as SignedPayload | null;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      if (
        parsed.kind !== kind ||
        typeof parsed.id !== 'string' ||
        parsed.id.length > 128 ||
        typeof parsed.account !== 'string' ||
        parsed.account.length > 64 ||
        typeof parsed.campaign !== 'string' ||
        parsed.campaign.length > 128 ||
        !Number.isSafeInteger(parsed.expires) ||
        parsed.expires < Date.now() ||
        parsed.expires > Date.now() + 30 * 86_400_000
      ) {
        return null;
      }
      if (kind === 'click') {
        if (
          typeof parsed.url !== 'string' ||
          (parsed.download !== undefined &&
            typeof parsed.download !== 'boolean') ||
          (parsed.linkId !== undefined && typeof parsed.linkId !== 'string')
        ) {
          return null;
        }
        /** Parsed HTTPS link validated against configured host policy before wrapping or redirecting. */
        const link = new URL(parsed.url);
        if (
          link.protocol !== 'https:' ||
          link.username ||
          link.password ||
          (allowed && !allowed.has(link.hostname.toLowerCase()))
        ) {
          return null;
        }
      }
      return parsed;
    } catch {
      return null;
    }
  }
  /** Hash a validated destination for summary identity without storing the URL there.
   * @param {string} url - Validated HTTPS URL spelling.
   * @returns {string} Truncated SHA-256 identifier; hashing is not anonymization or authorization.
   */
  function linkId(url: string) {
    return createHash('sha256').update(url).digest('hex').slice(0, 32);
  }
  /** Create one expiring tracking URL from configured origin and validated message context.
   * @param {Kind} kind - Open or click token kind.
   * @param {{ id: string; account: string; campaign: string }} context - Validated opaque message/account/campaign labels.
   * @param {string} context.id - Opaque validated message identifier.
   * @param {string} context.account - Validated sending-account label.
   * @param {string|undefined} context.campaign - Bounded campaign label when supplied.
   * @param {string} url - Validated HTTPS click destination when applicable.
   * @param {boolean} download - Explicit download-link classification, default false.
   * @returns {string} Absolute generated URL; oversized tokens reject.
   */
  function makeUrl(
    kind: Kind,
    context: {
      /** Opaque message ID or public key identifier. */
      id: string; /** Bounded sending account label, never credentials. */
      account: string; /** Bounded optional campaign label. */
      campaign: string;
    },
    url?: string,
    download = false
  ) {
    /** Signed/encrypted expiring token; generation rejects values the handler would refuse. */
    const token = encrypt({
      kind,
      id: context.id,
      account: context.account,
      campaign: context.campaign,
      url,
      ...(kind === 'click' ? { download, linkId: linkId(url!) } : {}),
      expires: Date.now() + ttlMs,
      nonce: randomBytes(8).toString('hex'),
    });
    // Do not emit tracking links the request handler would refuse to decode.
    if (token.length > 4096) {
      throw new RangeError('Tracking URL exceeds token limit');
    }
    /** Tracking URL based solely on configured public origin/path. */
    const result = new URL(base.href);
    result.pathname = path + `/${kind}/${token}`;
    result.search = '';
    return result.href;
  }
  /** Fan out bounded best-effort telemetry without changing send/redirect success.
   * @param {EmailActivityEvent} event - Opaque observed event metadata, independently tracking-opted-in.
   * @returns {Promise<void>} Settles after bounded waits; actual unresolved callbacks retain admission slots.
   */
  async function record(event: EmailActivityEvent) {
    if (!enabled) {
      return;
    }
    // Store and event callbacks are best-effort. Failed or slow telemetry must
    // never change the actual email delivery or HTTP redirect response.
    /** Opaque telemetry labels; no raw recipient or destination is included. */
    const properties: Record<string, string | number> = {
      message_id: event.id,
      account: event.account,
      campaign: event.campaign,
    };
    if (event.linkId) {
      properties.link_id = event.linkId;
    }
    if (event.bytes !== undefined) {
      properties.bytes = event.bytes;
    }
    await Promise.all([
      telemetry(() =>
        config.analytics.track({
          name:
            event.kind === 'download_click'
              ? 'email.download_click'
              : `email.${event.kind}`,
          source: 'email',
          occurredAt: event.at,
          properties,
        })
      ),
      telemetry(() => activityStore.record(event)),
      ...(config.onEvent ? [telemetry(() => config.onEvent!(event))] : []),
    ]);
  }
  /** Standalone tracking facade; host owns routes, callbacks and borrowed stores. */
  const service = {
    path,
    /** Read observed per-message summaries with a bounded wait. The host must authorize management access.
     * @param {string} id - Opaque message identifier.
     * @returns {Promise<EmailActivitySummary|null>} Observed summary or null on invalid/missing/failed/timed-out storage.
     */
    async getActivity(id: string): Promise<EmailActivitySummary | null> {
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id)) {
        return null;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          activityStore.get(id),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              warn();
              resolve(null);
            }, timeoutMs);
            timer.unref?.();
          }),
        ]);
      } catch {
        warn();
        return null;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
    /** Record only after the application successfully serves a tracked download.
 * @param {{
      id: string;
      account: string;
      campaign?: string;
      url?: string;
      bytes?: number;
    }} context - Validated opaque message labels and optional successful byte count/HTTPS URL.
 * @param {string} context.id - Opaque validated message identifier.
 * @param {string} context.account - Validated sending-account label.
 * @param {string|undefined} context.campaign - Bounded campaign label when supplied.
 * @param {string|undefined} context.url - Validated HTTPS destination; never fetched here.
 * @param {number|undefined} context.bytes - Successful nonnegative served-byte count.
 * @returns {Promise<void>} Best-effort observation; redirect clicks never imply a completed download.
 */
    async recordDownload(context: {
      /** Opaque message ID or public key identifier. */
      id: string;
      /** Bounded sending account label, never credentials. */
      account: string;
      /** Bounded optional campaign label. */
      campaign?: string;
      /** Private validated HTTPS destination carried in an authenticated payload. */
      url?: string;
      bytes?: number;
    }): Promise<void> {
      if (
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(context.id) ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(context.account)
      ) {
        return;
      }
      if (context.campaign !== undefined && context.campaign.length > 128) {
        return;
      }
      if (
        context.bytes !== undefined &&
        (!Number.isSafeInteger(context.bytes) || context.bytes < 0)
      ) {
        return;
      }
      let targetId: string | undefined;
      if (context.url) {
        try {
          /** Validated request/link URL; generation does not fetch it. */
          const url = new URL(context.url);
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            (allowed && !allowed.has(url.hostname.toLowerCase()))
          ) {
            return;
          }
          targetId = linkId(url.href);
        } catch {
          return;
        }
      }
      await record({
        kind: 'download',
        id: context.id,
        account: context.account,
        campaign: context.campaign ?? '',
        at: Date.now(),
        ...(targetId ? { linkId: targetId } : {}),
        ...(context.bytes !== undefined ? { bytes: context.bytes } : {}),
      });
    },
    /** Toggle future telemetry without invalidating already delivered tracking redirects.
     * @param {boolean} value - Only literal true enables future observations.
     * @returns {void} Updates the in-memory switch; performs no network/storage work.
     */
    setEnabled(value: boolean) {
      enabled = value === true;
    },
    /** Instrument already sanitized/inlined host HTML only after per-message tracking opt-in. This regex-based helper does not sanitize arbitrary HTML.
     * @param {string} html - Host-sanitized message HTML.
     * @param {{ id: string; account: string; message: TrackedEmailMessage }} context - Trusted opaque message/account and explicit tracking policy.
     * @param {string} context.id - Opaque validated message identifier.
     * @param {string} context.account - Validated sending-account label.
     * @param {TrackedEmailMessage} context.message - Explicit per-message tracking settings.
     * @returns {string} Escaped tracking markup preserving opt-out links and avoiding duplicate pixels/wrappers.
     */
    instrumentHtml(
      html: string,
      context: {
        /** Opaque message ID or public key identifier. */
        id: string; /** Bounded sending account label, never credentials. */
        account: string;
        message: TrackedEmailMessage;
      }
    ): string {
      /** Per-message explicit tracking opt-in, separate from marketing consent. */
      const policy = context.message.tracking;
      if (!enabled || !policy?.enabled) {
        return html;
      }
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(context.id)) {
        throw new TypeError('Invalid tracking message ID');
      }
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(context.account)) {
        throw new TypeError('Invalid tracking account');
      }
      /** Bounded campaign label carried through opaque message telemetry. */
      const campaign = policy.campaign ?? '';
      if (campaign.length > 128) {
        throw new TypeError('Invalid campaign');
      }
      /** Validated message/account/campaign identity used for this instrumentation pass. */
      const info = { id: context.id, account: context.account, campaign };
      /** Explicit HTTPS download targets; click and successful download remain separate measurements. */
      const explicitDownloads = new Set<string>();
      // Explicit download declarations never cause a remote fetch.
      for (const target of policy.downloadLinks ?? []) {
        try {
          /** Validated request/link URL; generation does not fetch it. */
          const url = new URL(target);
          if (url.protocol === 'https:' && !url.username && !url.password) {
            explicitDownloads.add(url.href);
          }
        } catch {
          /* Non-URL is not a downloadable destination */
        }
      }
      let updated = html;
      if (policy.clicks !== false) {
        let links = 0;
        updated = updated.replace(/<a\b[^>]*>/gi, (tag: string) => {
          if (
            ++links > 100 ||
            /(?:\bdata-no-track\b|\bdata-tracking\s*=\s*["']off["']|\brel\s*=\s*["'][^"']*\bunsubscribe\b)/i.test(
              tag
            )
          ) {
            return tag;
          }
          return tag.replace(
            /(\bhref\s*=\s*)(["'])(.*?)\2/i,
            (full, prefix: string, quote: string, raw: string) => {
              try {
                /** Parsed HTTPS link validated against configured host policy before wrapping or redirecting. */
                const link = new URL(decodeHref(raw));
                // Unsubscribe and opt-out links must remain untouched, even when
                // their function is expressed as a query parameter.
                /** Unsubscribe/opt-out marker grammar; matching links are never wrapped. */
                const optOut =
                  /(?:unsubscribe|unsub|opt[-_]?out|one[-_]?click)/i;
                if (
                  link.protocol !== 'https:' ||
                  link.username ||
                  link.password ||
                  (allowed && !allowed.has(link.hostname.toLowerCase())) ||
                  (link.origin === base.origin &&
                    link.pathname.startsWith(path + '/')) ||
                  optOut.test(link.pathname) ||
                  [...link.searchParams.keys()].some((key) => optOut.test(key))
                ) {
                  return full;
                }
                /** Explicit observed download-link classification, not proof that bytes were served. */
                const download =
                  policy.downloads !== false &&
                  (explicitDownloads.has(link.href) ||
                    /\b(?:data-track-download|data-email-download|download)(?:\s|=|>)/i.test(
                      tag
                    ));
                return (
                  prefix +
                  quote +
                  escapeAttr(makeUrl('click', info, link.href, download)) +
                  quote
                );
              } catch {
                return full;
              }
            }
          );
        });
      }
      // A message can pass through multiple renderers; add at most one pixel
      // for this tracking service and never wrap a previously wrapped click.
      /** Whether this service already inserted a pixel; repeated render passes remain idempotent. */
      const hasPixel = [
        ...updated.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi),
      ].some((match) => {
        try {
          /** Captured link target from the bounded HTML attribute match. */
          const href = match[2];
          if (!href) {
            return false;
          }
          /** Existing parsed pixel URL used only to avoid duplicate instrumentation. */
          const existing = new URL(decodeHref(href));
          return (
            existing.origin === base.origin &&
            existing.pathname.startsWith(path + '/open/')
          );
        } catch {
          return false;
        }
      });
      if (policy.opens !== false && !hasPixel) {
        /** Escaped transparent pixel markup created only when per-message opens are enabled. */
        const img = `<img src="${escapeAttr(makeUrl('open', info))}" alt="" width="1" height="1" style="display:none!important;width:1px;height:1px;border:0" />`;
        updated = /<\/body>/i.test(updated)
          ? updated.replace(/<\/body>/i, img + '</body>')
          : updated + img;
      }
      return updated;
    },
    /** Record a send observation after the email owner reports successful delivery acceptance.
 * @param {{
      id: string;
      account: string;
      message: TrackedEmailMessage;
    }} event - Opaque message/account and explicitly opted-in tracking settings.
 * @param {string} event.id - Opaque message identifier.
 * @param {string} event.account - Sending-account label.
 * @param {TrackedEmailMessage} event.message - Explicit per-message tracking settings.
 * @returns {Promise<void>} Best-effort observation, not delivery or human engagement certification.
 */
    async onSent(event: {
      /** Opaque message ID or public key identifier. */
      id: string;
      /** Bounded sending account label, never credentials. */
      account: string;
      message: TrackedEmailMessage;
    }) {
      if (!enabled || !event.message.tracking?.enabled) {
        return;
      }
      /** Bounded campaign label carried through opaque message telemetry. */
      const campaign = event.message.tracking.campaign ?? '';
      await record({
        kind: 'sent',
        id: event.id,
        account: event.account,
        campaign,
        at: Date.now(),
      });
    },
    /** Serve GET/HEAD pixel or redirect only after token/expiry/destination checks.
     * @param {Request} request - Fetch request routed by the host to this configured mount.
     * @returns {Promise<Response>} Private no-store response; HEAD performs no telemetry and invalid tokens return 404.
     */
    async handle(request: Request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, {
          status: 405,
          headers: { allow: 'GET, HEAD' },
        });
      }
      /** Validated request/link URL; generation does not fetch it. */
      const url = new URL(request.url);
      /** Bounded route match scoped to the configured mount path. */
      const match = url.pathname.match(
        new RegExp(
          `^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(open|click)/([A-Za-z0-9_.-]+)$`
        )
      );
      if (!match) {
        return new Response(null, { status: 404 });
      }
      /** Allowlisted open/click route kind. */
      const kind = match[1] as Kind;
      /** Base64url event reference captured from the validated route. */
      const encoded = match[2];
      if (!encoded) {
        return new Response(null, { status: 404 });
      }
      /** Verified unexpired payload; signed links do not grant application data access. */
      const decoded = open(encoded, kind);
      if (!decoded) {
        return new Response(null, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
      if (request.method === 'GET') {
        if (enabled) {
          /** Observed request kind; download clicks remain distinct from served downloads. */
          let eventKind: EmailActivityKind = 'click';
          if (kind === 'open') {
            eventKind = 'open';
          } else if (decoded.download) {
            eventKind = 'download_click';
          }
          await record({
            kind: eventKind,
            id: decoded.id,
            account: decoded.account,
            campaign: decoded.campaign,
            at: Date.now(),
            ...(kind === 'click'
              ? { linkId: decoded.linkId ?? linkId(decoded.url!) }
              : {}),
          });
        }
      }
      return kind === 'open'
        ? new Response(request.method === 'HEAD' ? null : PIXEL, {
            status: 200,
            headers: {
              'content-type': 'image/gif',
              'cache-control': 'private, no-store, max-age=0',
              'content-length': String(PIXEL.byteLength),
              'x-content-type-options': 'nosniff',
            },
          })
        : new Response(null, {
            status: 302,
            headers: {
              location: decoded.url!,
              'cache-control': 'private, no-store',
              'referrer-policy': 'no-referrer',
            },
          });
    },
    /** Describe route bindings without registering them or owning the server.
     * @returns {ReturnType<ReturnType<typeof createEmailTrackingService>['routes']>} Host-mounted open/click descriptors.
     */
    routes() {
      return [
        { pattern: `${path}/open/:token`, handler: service.handle },
        { pattern: `${path}/click/:token`, handler: service.handle },
      ];
    },
  };
  return service;
}
