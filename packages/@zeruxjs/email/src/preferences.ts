import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { addressString, validateEmailAddress } from './validation.js';
import type { EmailAddress } from './types.js';

export type ConsentStatus = 'subscribed' | 'unsubscribed';
export interface ConsentRecord {
  /** Explicit subscribed/unsubscribed consent state; absence is not opt-in. */
  status: ConsentStatus;
  /** Content-owned ISO timestamp when this consent change was committed. */
  updatedAt: string;
  /** Private consent source/evidence label; not a user role claim. */
  source: string;
  /** Optional private host-verifiable opt-in evidence; never analytics labels. */
  proof?: string;
}
/** Implement get/set using one shared, durable store for production and queued workers.
 * A consent write must be committed before set() resolves; never cache stale consent checks.
 */
export interface ConsentStore {
  /** Read current consent without silently treating a missing record as subscribed.
   * @param {string} email - Canonical private mailbox; never a public analytics label.
   * @returns {Promise<ConsentRecord | null>} Private stored record or null; memory implementation returns its stored object.
   */
  get(email: string): Promise<ConsentRecord | null>;
  /** Commit a consent update before allowing subsequent marketing admission.
   * @param {string} email - Canonical private mailbox; never a public analytics label.
   * @param {ConsentRecord} record - Private status/time/source/evidence committed by the host store.
   * @returns {Promise<void>} Store commit observed; host durable implementations must honor this contract.
   */
  set(email: string, record: ConsentRecord): Promise<void>;
}
export interface EmailPreferencesOptions {
  /** Explicit trusted HTTPS origin; no request Host/forwarded header is used. */
  baseUrl: string;
  /** Private stable key material at least 32 UTF-8 bytes; host owns rotation/migration. */
  secret: string;
  /** Explicit mount path, default /_zerux/email/unsubscribe. */
  path?: string;
  /** No store means development-only in-process state, lost on restart. */
  store?: ConsentStore;
  /** Optional cap for generated links; defaults to no expiration, as unsubscribe links must stay usable. */
  maxAgeMs?: number;
  /** Maximum time to receive a one-click POST body, default 5 seconds. */
  postTimeoutMs?: number;
}

/** Validate and canonicalize a private mailbox for this consent store only.
 * @param {EmailAddress} input - Private recipient address validated before store access.
 * @returns {string} Lowercase trimmed mailbox; not verified principal identity.
 */
function canonical(input: EmailAddress) {
  /** Canonical private recipient identity; encrypted in links and never a public label. */
  const email = addressString(validateEmailAddress(input)).trim().toLowerCase();
  if (email.length > 320) {
    throw new TypeError('Invalid email address');
  }
  return email;
}
/** Create a development-only local consent map with no restart or multi-worker guarantees.
 * @returns {ConsentStore & {snapshot(): ReadonlyMap<string, ConsentRecord>}} Reference store; production requires a shared committed host store.
 */
export function createMemoryConsentStore(): ConsentStore & {
  /** Copy the local consent map for trusted inspection without claiming deep immutable records.
   * @returns {ReadonlyMap<string, ConsentRecord>} New outer map; record references remain private borrowed values.
   */
  snapshot(): ReadonlyMap<string, ConsentRecord>;
} {
  /** Development-only local consent records; no durable/shared fallback guarantee. */
  const data = new Map<string, ConsentRecord>();
  return {
    /** Read current consent without silently treating a missing record as subscribed.
     * @param {string} email - Canonical private mailbox; never a public analytics label.
     * @returns {Promise<ConsentRecord | null>} Private stored record or null; memory implementation returns its stored object.
     */
    async get(email) {
      return data.get(email) ?? null;
    },
    /** Commit a consent update before allowing subsequent marketing admission.
     * @param {string} email - Canonical private mailbox; never a public analytics label.
     * @param {ConsentRecord} record - Private status/time/source/evidence committed by the host store.
     * @returns {Promise<void>} Store commit observed; host durable implementations must honor this contract.
     */
    async set(email, record) {
      data.set(email, { ...record });
    },
    /** Copy the local consent map for trusted inspection without claiming deep immutable records.
     * @returns {ReadonlyMap<string, ConsentRecord>} New outer map; record references remain private borrowed values.
     */
    snapshot() {
      return new Map(data);
    },
  };
}
/** Exact form-body ceiling of 256 bytes before consent can be mutated. */
const bodyLimit = 256;
/** Read only the bounded exact form-encoded one-click body and own its cancellation timer/reader lock.
 * @param {Request} request - One explicit Fetch request; GET/HEAD never update preference state.
 * @param {number} timeoutMs - Bounded body-read observation interval; native streams remain cooperatively cancellable.
 * @returns {Promise<boolean>} True only for the exact supported body; malformed/deadline input is rejected.
 */
async function readOneClick(
  request: Request,
  timeoutMs: number
): Promise<boolean> {
  if (
    !/^application\/x-www-form-urlencoded(?:\s*;.*)?$/i.test(
      request.headers.get('content-type') ?? ''
    )
  ) {
    return false;
  }
  /** Untrusted content-length preflight; streaming bytes are independently bounded. */
  const declared = request.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > bodyLimit)
  ) {
    return false;
  }
  if (!request.body) {
    return false;
  }
  /** Owned request-body reader; lock released and timeout cleared after settlement. */
  const reader = request.body.getReader();
  let size = 0;
  /** Bounded raw form chunks; no MIME/HTML evaluation occurs. */
  const chunks: Uint8Array[] = [];
  let expired = false;
  /** Owned body-observation deadline requesting reader cancellation; cannot force-stop arbitrary streams. */
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel('deadline').catch(() => {});
  }, timeoutMs);
  timer.unref?.();
  try {
    // Enforce the byte ceiling on every read; declared content length is not trusted alone.
    while (true) {
      /** One bounded request-reader result; bytes are checked before appending. */
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > bodyLimit) {
        await reader.cancel().catch(() => {});
        return false;
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (expired) {
    return false;
  }
  /** Decoded bounded form; only the exact one-click body is accepted. */
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(
    'utf8'
  );
  return body === 'List-Unsubscribe=One-Click';
}
/** Bind encrypted unsubscribe capabilities to explicit HTTPS host settings and a committed consent store.
 * @param {EmailPreferencesOptions} options - Trusted HTTPS origin/path, private key material and optional shared store.
 * @returns {EmailPreferenceService} Explicit endpoint provider; no listener/transport starts on import or construction.
 */
export function createEmailPreferenceService(options: EmailPreferencesOptions) {
  /** Explicit trusted HTTPS base; request Host/forwarded headers never choose it. */
  const base = new URL(options.baseUrl);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new TypeError('HTTPS preferences baseUrl required');
  }
  if (
    typeof options.secret !== 'string' ||
    Buffer.byteLength(options.secret, 'utf8') < 32
  ) {
    throw new TypeError('Email preference secret must be at least 32 bytes');
  }
  /** Validated explicit unsubscribe mount with no query, traversal or automatic host discovery. */
  const path = options.path ?? '/_zerux/email/unsubscribe';
  if (
    !/^\/[a-zA-Z0-9/_-]{1,120}$/.test(path) ||
    path.endsWith('/') ||
    path.includes('//')
  ) {
    throw new TypeError('Invalid unsubscribe path');
  }
  /** Bounded form-body observation interval, default five seconds. */
  const postTimeoutMs = options.postTimeoutMs ?? 5000;
  if (
    !Number.isSafeInteger(postTimeoutMs) ||
    postTimeoutMs < 10 ||
    postTimeoutMs > 30_000
  ) {
    throw new RangeError('Invalid unsubscribe POST timeout');
  }
  /** Optional encrypted capability age ceiling; omission intentionally permits long-lived unsubscribe links. */
  const maxAge = options.maxAgeMs;
  if (
    maxAge !== undefined &&
    (!Number.isSafeInteger(maxAge) ||
      maxAge < 86_400_000 ||
      maxAge > 10 * 365 * 86_400_000)
  ) {
    throw new RangeError('Invalid unsubscribe token lifetime');
  }
  /** Private domain-separated AES-256 key derived from stable host secret; never public config. */
  const key = createHash('sha256')
    .update('zerux-email-unsubscribe-v1\0')
    .update(options.secret)
    .digest();
  /** Explicit borrowed committed store, or development-only local reference map. */
  const store = options.store ?? createMemoryConsentStore();
  // Long-lived unsubscribe links carry encrypted addresses, not plaintext email or campaign data.
  /** Encrypt canonical mailbox and creation time into an authenticated unsubscribe capability.
   * @param {EmailAddress} address - Private validated recipient; no principal authorization is inferred.
   * @returns {string} Private HTTPS URL; never telemetry or evidence of subscription.
   */
  function makeUrl(address: EmailAddress) {
    /** Canonical private recipient identity; encrypted in links and never a public label. */
    const email = canonical(address);
    /** Fresh 96-bit GCM nonce for this capability; never reused for deliberate token issuance. */
    const iv = randomBytes(12);
    /** One authenticated encryption context with fixed unsubscribe-domain AAD. */
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('zerux-unsubscribe-v1'));
    /** Private canonical mailbox and issuance time; token verification validates both fields. */
    const payload = JSON.stringify({ email, createdAt: Date.now() });
    /** Authenticated encrypted capability payload; raw mailbox is absent from the URL. */
    const ciphertext = Buffer.concat([
      cipher.update(payload, 'utf8'),
      cipher.final(),
    ]);
    /** Opaque authenticated capability, not proof of sender/login authority. */
    const token = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
      'base64url'
    );
    /** Explicit base-derived URL or parsed request route; no destination fetch occurs. */
    const url = new URL(base.href);
    url.pathname = path + '/' + token;
    url.search = '';
    url.hash = '';
    return url.href;
  }
  /** Authenticate and validate bounded token encoding/time before exposing its private mailbox internally.
   * @param {string} token - Bounded opaque encrypted capability from the configured route.
   * @returns {string | null} Canonical mailbox for a valid capability, otherwise null.
   */
  function verify(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{35,800}$/.test(token)) {
      return null;
    }
    try {
      /** Canonical base64url token bytes checked before decryption. */
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.toString('base64url') !== token || bytes.length < 29) {
        return null;
      }
      /** One authenticated decryption context requiring the fixed AAD and retained tag. */
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12)
      );
      decipher.setAAD(Buffer.from('zerux-unsubscribe-v1'));
      decipher.setAuthTag(bytes.subarray(-16));
      /** Private canonical mailbox and issuance time; token verification validates both fields. */
      const payload = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(12, -16)),
          decipher.final(),
        ]).toString('utf8')
      ) as {
        /** Canonical private mailbox carried only inside authenticated encryption. */
        email?: unknown; /** Epoch token creation time checked for expiry/future skew. */
        createdAt?: unknown;
      };
      if (
        typeof payload.email !== 'string' ||
        !Number.isSafeInteger(payload.createdAt)
      ) {
        return null;
      }
      /** Validated token timestamp bounded against future skew and optional age. */
      const createdAt = payload.createdAt as number;
      if (
        createdAt > Date.now() + 60_000 ||
        createdAt < 0 ||
        (maxAge !== undefined && Date.now() - createdAt > maxAge)
      ) {
        return null;
      }
      /** Canonical private recipient identity; encrypted in links and never a public label. */
      const email = canonical(payload.email);
      return email === payload.email ? email : null;
    } catch {
      return null;
    }
  }
  /** No-store/no-referrer/nosniff headers for every preference response. */
  const headers = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
  return {
    /** Read current affirmative subscription state; errors propagate for the SMTP boundary to fail closed.
     * @param {EmailAddress} address - Private validated recipient; no principal authorization is inferred.
     * @returns {Promise<boolean>} True only for an existing subscribed record.
     */
    async isSubscribed(address: EmailAddress) {
      /** Current private consent record; only explicit subscribed state counts as opt-in. */
      const entry = await store.get(canonical(address));
      return entry?.status === 'subscribed';
    },
    /** Read private current consent state without synthesizing opt-in evidence.
     * @param {EmailAddress} address - Private validated recipient; no principal authorization is inferred.
     * @returns {Promise<ConsentRecord | null>} Stored record or null; callers must authorize access.
     */
    async status(address: EmailAddress) {
      return store.get(canonical(address));
    },
    /** Commit opt-in only after the host independently verifies the supplied evidence.
     * @param {EmailAddress} address - Private validated recipient; no principal authorization is inferred.
     * @param {{ source: string; proof: string }} evidence - Host-verified opt-in source/proof; strings alone cannot authenticate a user.
     * @param {string} evidence.source - Host-verified bounded source identifier.
     * @param {string} evidence.proof - Nonempty bounded private evidence reference.
     * @returns {Promise<void>} Current subscribed record persisted; no analytics consent is implied.
     */
    async subscribe(
      address: EmailAddress,
      evidence: {
        /** Private consent source/evidence label; not a user role claim. */
        source: string; /** Optional private host-verifiable opt-in evidence; never analytics labels. */
        proof: string;
      }
    ) {
      if (
        typeof evidence?.source !== 'string' ||
        !/^[a-zA-Z0-9_.:-]{1,64}$/.test(evidence.source) ||
        typeof evidence?.proof !== 'string' ||
        evidence.proof.trim().length < 1 ||
        evidence.proof.length > 512
      ) {
        throw new TypeError('Verified consent evidence required');
      }
      await store.set(canonical(address), {
        status: 'subscribed',
        updatedAt: new Date().toISOString(),
        source: evidence.source,
        proof: evidence.proof,
      });
    },
    /** Commit explicit unsubscribe independently of tracking or optional analytics availability.
     * @param {EmailAddress} address - Private validated recipient; no principal authorization is inferred.
     * @returns {Promise<void>} Unsubscribed state committed before resolving.
     */
    async unsubscribe(address: EmailAddress) {
      await store.set(canonical(address), {
        status: 'unsubscribed',
        updatedAt: new Date().toISOString(),
        source: 'unsubscribe',
      });
    },
    makeUnsubscribeUrl: makeUrl,
    path,
    /** Serve scanner-safe GET/HEAD and mutate consent only on the bounded authenticated-capability POST.
     * @param {Request} request - One explicit Fetch request; GET/HEAD never update preference state.
     * @returns {Promise<Response>} No-store response; malformed tokens/body fail and store outage returns 503.
     */
    async handle(request: Request): Promise<Response> {
      /** Explicit base-derived URL or parsed request route; no destination fetch occurs. */
      const url = new URL(request.url);
      /** Configured exact path prefix preceding an opaque capability. */
      const prefix = path + '/';
      if (!url.pathname.startsWith(prefix) || url.search) {
        return new Response(null, { status: 404, headers });
      }
      /** Canonical private recipient identity; encrypted in links and never a public label. */
      const email = verify(url.pathname.slice(prefix.length));
      if (!email) {
        return new Response(null, { status: 404, headers });
      }
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      if (request.method === 'GET') {
        // Link scanners GET pages. Only a real POST can change consent.
        /** Fixed inert scanner-safe confirmation form; GET alone performs no consent write. */
        const html =
          '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Unsubscribe</title><body><h1>Unsubscribe from marketing emails</h1><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form></body></html>';
        return new Response(html, {
          status: 200,
          headers: {
            ...headers,
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; form-action 'self'; style-src 'none'",
          },
        });
      }
      if (request.method !== 'POST') {
        return new Response(null, {
          status: 405,
          headers: { ...headers, allow: 'GET, HEAD, POST' },
        });
      }
      let validBody = false;
      try {
        validBody = await readOneClick(request, postTimeoutMs);
      } catch {
        /* Malformed or aborted request. */
      }
      if (!validBody) {
        return new Response(null, { status: 400, headers });
      }
      try {
        await store.set(email, {
          status: 'unsubscribed',
          updatedAt: new Date().toISOString(),
          source: 'one-click',
        });
      } catch {
        return new Response(null, {
          status: 503,
          headers: { ...headers, 'retry-after': '60' },
        });
      }
      return new Response(null, { status: 200, headers });
    },
    /** Expose only explicit endpoint declarations for the host to mount.
     * @returns {{pattern: string, handler: (request: Request) => Promise<Response>}[]} Borrowed method references; host owns routing and public origin integration.
     */
    routes() {
      return [{ pattern: `${path}/:token`, handler: this.handle }];
    },
  };
}
export type EmailPreferenceService = ReturnType<
  typeof createEmailPreferenceService
>;
