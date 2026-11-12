import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { generateTotp, type TotpOptions } from './totp.js';

export interface AuthAccount {
  /** Verified host tenant label. */
  tenant: string;
  /** Verified host account label. */
  account: string;
}
export interface AuthSession {
  /** Opaque random credential identifier. */
  id: string;
  /** Bounded host-assigned device label, not raw user-agent/IP telemetry. */
  device: string;
  /** Server issuance time in UTC milliseconds. */
  createdAt: number;
  /** Absolute server expiry in UTC milliseconds. */
  expiresAt: number;
  /** Private account/purpose-bound HMAC digest, never plaintext bearer/code. */
  digest: string;
  /** Configured rotating verification key ID. */
  kid: string;
  /** Exact bounded permission labels; no wildcard expansion. */
  scopes: string[];
}
export interface AuthChallenge {
  /** Opaque random credential identifier. */
  id: string;
  /** Explicit reset/otp/magic challenge purpose. */
  purpose: 'reset' | 'otp' | 'magic';
  /** Private account/purpose-bound HMAC digest, never plaintext bearer/code. */
  digest: string;
  /** Configured rotating verification key ID. */
  kid: string;
  /** Absolute server expiry in UTC milliseconds. */
  expiresAt: number;
  /** Persisted failed-attempt count. */
  attempts: number;
  /** Finite challenge attempt budget, default five and supported 1–10. */
  maxAttempts: number;
}
export interface AuthAccountState {
  /** At most 64 unexpired account session records. */
  sessions: AuthSession[];
  /** At most 32 active purpose-bound challenges. */
  challenges: AuthChallenge[];
  /** At most 16 enrolled credential highest-accepted-step guards. */
  steps: Record<string, number>;
}
export interface AuthSnapshot {
  /** Opaque never-reused current CAS revision. */
  revision: string;
  /** Detached validated account-state payload. */
  value: AuthAccountState;
}
/** Shared adapters MUST provide linearizable CAS, including null=create-if-absent, with durable expiry.
 * Revisions are opaque and must never be reused (including after deletion). Reads must be current.
 * expiresAt is Unix milliseconds; no account data may survive that deadline without a subsequent CAS.
 * Never emulate this contract using ordinary cache get/set or approximate affected counts. */
export interface AuthPersistence {
  /** Required linearizable shared-state protocol identifier. */
  readonly capability: 'auth-cas-v1';
  /** Read a current detached account snapshot after expiry pruning.
   * @param {string} key - HMAC-bound account index key.
   * @returns {Promise<AuthSnapshot|null>} Current opaque revision/state or absence; shared implementations must provide fresh reads.
   */
  read(key: string): Promise<AuthSnapshot | null>;
  /** Atomically replace the exact revision, or reserve absent/expired state when revision is null. Revisions must never be reused.
   * @param {string} key - Account-bound index key.
   * @param {string|null} revision - Expected opaque revision, or create-only absence.
   * @param {AuthAccountState} value - Bounded validated candidate state.
   * @param {number} expiresAt - Server-time expiry committed atomically with the state.
   * @returns {Promise<boolean>} True only for exact committed state; false means contention, not unavailable storage.
   */
  compareAndSwap(
    key: string,
    revision: string | null,
    value: AuthAccountState,
    expiresAt: number
  ): Promise<boolean>;
}
/** Fixed-code public failure; private causes stay outside client responses. */
export class AuthStateError extends Error {
  /** Create a fixed public auth-state error with an optional private cause.
 * @param {| 'AUTH_INVALID'
      | 'AUTH_UNAVAILABLE'
      | 'AUTH_CAPACITY'
      | 'AUTH_CLOSED'} code - Supported redacted failure category.
 * @param {ErrorOptions} options - Optional private Error cause for trusted diagnostics.
 */
  constructor(
    readonly code:
      | 'AUTH_INVALID'
      | 'AUTH_UNAVAILABLE'
      | 'AUTH_CAPACITY'
      | 'AUTH_CLOSED',
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'AuthStateError';
  }
}
/** Create the fixed public invalid-state error without echoing credentials.
 * @returns {AuthStateError} Redacted invalid-input/state failure. */
const invalid = () => new AuthStateError('AUTH_INVALID');
/** Validate bounded nonempty labels without accepting control characters.
 * @param {unknown} value - Candidate host label.
 * @param {number} max - Maximum character count, default 128.
 * @returns {boolean} Whether the label satisfies the supported syntax. */
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  // eslint-disable-next-line no-control-regex -- Reject controls in bounded host labels.
  !/[\x00-\x1f\x7f]/.test(value);
/** Check a safe integer against an inclusive protocol bound.
 * @param {number} value - Candidate number.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {boolean} Whether the value is a safe integer in range. */
const integer = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
/** Create fresh account state with no shared mutable collections.
 * @returns {AuthAccountState} Empty sessions/challenges and a null-prototype TOTP replay map. */
const empty = (): AuthAccountState => ({
  sessions: [],
  challenges: [],
  steps: Object.create(null),
});

/** Validate bounded shared credential state before trusting or writing it. Stored digests/keys remain private.
 * @param {AuthAccountState} state - Untrusted persisted or candidate account state.
 * @returns {void} Malformed state rejects without accepting a partial account record.
 */
function validateState(state: AuthAccountState): void {
  if (
    !state ||
    typeof state !== 'object' ||
    !Array.isArray(state.sessions) ||
    state.sessions.length > 64 ||
    !Array.isArray(state.challenges) ||
    state.challenges.length > 32 ||
    !state.steps ||
    typeof state.steps !== 'object' ||
    Array.isArray(state.steps) ||
    Object.keys(state.steps).length > 16
  ) {
    throw invalid();
  }
  /** Check only explicitly supported own fields on a persisted record.
   * @param {object} value - Candidate persisted record.
   * @param {readonly string[]} allowed - Supported field names for this state version.
   * @returns {boolean} Whether all enumerable keys are recognized. */
  const fields = (value: object, allowed: readonly string[]) =>
    Object.keys(value).every((key) => allowed.includes(key));
  if (!fields(state, ['sessions', 'challenges', 'steps'])) {
    throw invalid();
  }
  /** Recognize supported random session/challenge record IDs.
   * @param {unknown} value - Untrusted stored identifier.
   * @returns {boolean} Whether the 128-bit base64url spelling is valid. */
  const id = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
  /** Recognize stored keyed SHA-256 digest spelling.
   * @param {unknown} value - Untrusted stored digest.
   * @returns {boolean} Whether the fixed-length base64url grammar matches. */
  const hash = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  /** Check shared session/challenge identity, digest, key ID and expiry metadata.
   * @param {AuthSession|AuthChallenge} value - Untrusted stored credential record.
   * @returns {boolean} Whether common stored metadata satisfies this protocol. */
  const meta = (value: AuthSession | AuthChallenge) =>
    id(value.id) &&
    hash(value.digest) &&
    typeof value.kid === 'string' &&
    /^[A-Za-z0-9_-]{1,32}$/.test(value.kid) &&
    integer(value.expiresAt, 0, 8e15);
  if (
    new Set(state.sessions.map((v) => v.id)).size !== state.sessions.length ||
    new Set(state.challenges.map((v) => v.id)).size !== state.challenges.length
  ) {
    throw invalid();
  }
  // Check every bounded persisted session before trusting shared credential state.
  for (const item of state.sessions) {
    if (
      !meta(item) ||
      !fields(item, [
        'id',
        'device',
        'createdAt',
        'expiresAt',
        'digest',
        'kid',
        'scopes',
      ]) ||
      !text(item.device, 100) ||
      !integer(item.createdAt, 0, item.expiresAt) ||
      !Array.isArray(item.scopes) ||
      item.scopes.length > 32 ||
      item.scopes.some(
        (s) => typeof s !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(s)
      )
    ) {
      throw invalid();
    }
  }
  // Check every purpose/attempt-bound challenge before permitting shared transitions.
  for (const item of state.challenges) {
    if (
      !meta(item) ||
      !fields(item, [
        'id',
        'purpose',
        'digest',
        'kid',
        'expiresAt',
        'attempts',
        'maxAttempts',
      ]) ||
      !['reset', 'otp', 'magic'].includes(item.purpose) ||
      !integer(item.maxAttempts, 1, 10) ||
      !integer(item.attempts, 0, item.maxAttempts - 1)
    ) {
      throw invalid();
    }
  }
  // Validate every enrolled TOTP highest-step guard before replay decisions.
  for (const [key, step] of Object.entries(state.steps)) {
    if (!hash(key) || !integer(step, 0, Number.MAX_SAFE_INTEGER)) {
      throw invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(state)) > 131072) {
    throw invalid();
  }
}

/** Create a bounded process-local linearizable reference adapter, not distributed durability. Expired accounts prune; enrolled state is never silently evicted for capacity.
 * @param {{ maxAccounts?: number; now?: () => number }} options - Optional account cap and trusted server clock.
 * @param {number|undefined} options.maxAccounts - Process-local capacity, default 1000 and maximum 100000.
 * @param {(() => number)|undefined} options.now - Trusted injected server clock, default Date.now.
 * @returns {AuthPersistence & {clear(): void, readonly size: number}} Reference CAS facade with no connection or timer ownership.
 */
export function createMemoryAuthPersistence(
  options: {
    maxAccounts?: number; /** Trusted synchronized nondecreasing server clock or Date.now. */
    now?: () => number;
  } = {}
): AuthPersistence & {
  /** Destroy all reference account/replay state during explicit owned teardown.
   * @returns {void} Never use clearing as a production eviction policy.
   */
  clear(): void;
  readonly size: number;
} {
  /** Reference account capacity, default 1000 and maximum 100000; no silent credential eviction. */
  const max = options.maxAccounts ?? 1000;
  /** Trusted injected millisecond clock or Date.now. */
  const now = options.now ?? Date.now;
  if (!integer(max, 1, 100000)) {
    throw invalid();
  }
  /** Process-local account snapshots/expiry; not durable multi-process persistence. */
  const records = new Map<
    string,
    {
      snapshot: AuthSnapshot; /** Absolute server expiry in UTC milliseconds. */
      expiresAt: number;
    }
  >();
  /** Remove only expired reference account states before reads/capacity checks.
   * @returns {void} No retained unexpired credentials are evicted.
   */
  function prune() {
    // Prune expired reference account state only; retain all unexpired credentials/replay guards.
    for (const [key, item] of records) {
      if (item.expiresAt <= now()) {
        records.delete(key);
      }
    }
  }
  return {
    capability: 'auth-cas-v1',
    /** Read a current detached account snapshot after expiry pruning.
     * @param {string} key - HMAC-bound account index key.
     * @returns {Promise<AuthSnapshot|null>} Current opaque revision/state or absence; shared implementations must provide fresh reads.
     */
    async read(key) {
      prune();
      return structuredClone(records.get(key)?.snapshot ?? null);
    },
    /** Atomically replace the exact revision, or reserve absent/expired state when revision is null. Revisions must never be reused.
     * @param {string} key - Account-bound index key.
     * @param {string|null} revision - Expected opaque revision, or create-only absence.
     * @param {AuthAccountState} value - Bounded validated candidate state.
     * @param {number} expiresAt - Server-time expiry committed atomically with the state.
     * @returns {Promise<boolean>} True only for exact committed state; false means contention, not unavailable storage.
     */
    async compareAndSwap(key, revision, value, expiresAt) {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(key) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now() ||
        Buffer.byteLength(JSON.stringify(value)) > 131072
      ) {
        throw invalid();
      }
      validateState(value);
      prune();
      if ((records.get(key)?.snapshot.revision ?? null) !== revision) {
        return false;
      }
      if (!records.has(key) && records.size >= max) {
        throw new AuthStateError('AUTH_CAPACITY');
      }
      records.set(key, {
        snapshot: {
          revision: randomBytes(24).toString('base64url'),
          value: structuredClone(value),
        },
        expiresAt,
      });
      return true;
    },
    /** Destroy all reference account/replay state during explicit owned teardown.
     * @returns {void} Never use clearing as a production eviction policy.
     */
    clear() {
      records.clear();
    },
    /** Count current unexpired process-local account snapshots.
     * @returns {number} Size after opportunistic expiry pruning.
     */
    get size() {
      prune();
      return records.size;
    },
  };
}

export interface SharedAuthOptions {
  /** Borrowed linearizable current-read/CAS persistence. */
  store: AuthPersistence;
  /** Stable tenant/account index secret, separate from rotating token keys. Changing it invalidates all state. */
  indexKey: Uint8Array;
  /** One to eight configured private rotating 32-byte HMAC keys. */
  keys: readonly {
    /** Opaque random credential identifier. */
    id: string; /** Private 32-byte HMAC material; manager owns copied buffers only. */
    key: Uint8Array;
  }[];
  /** Explicit configured key ID for all new issuance. */
  activeKeyId: string;
  /** Trusted synchronized nondecreasing server clock or Date.now. */
  now?: () => number;
  /** Actual-settlement admission cap, default 32 and range 1–256. */
  maxPending?: number;
  /** Must check a recent independent authentication for this exact account and action. */
  authorizeFresh: (
    account: Readonly<AuthAccount>,
    action: 'revoke-one' | 'revoke-all' | 'revoke-challenges' | 'rotate'
  ) => Promise<boolean>;
}
/** Create opaque shared sessions and purpose-bound one-use challenges using host linearizable persistence. Construction starts no network, cookie or background worker.
 * @param {SharedAuthOptions} options - Explicit stable index key, rotating token keys and fresh management authorization.
 * @returns {ReturnType<typeof createSharedAuth>} Disposable manager owning key copies; borrowed persistence/authorization lifetimes remain host-owned.
 */
export function createSharedAuth(options: SharedAuthOptions) {
  if (
    !options ||
    options.store?.capability !== 'auth-cas-v1' ||
    typeof options.store.read !== 'function' ||
    typeof options.store.compareAndSwap !== 'function' ||
    typeof options.authorizeFresh !== 'function' ||
    !(options.indexKey instanceof Uint8Array) ||
    options.indexKey.length !== 32 ||
    !Array.isArray(options.keys) ||
    options.keys.length < 1 ||
    options.keys.length > 8
  ) {
    throw invalid();
  }
  /** Borrowed host linearizable CAS primary; this manager never closes it. */
  const store = options.store;
  /** Fresh host authorization callback for management; never retried as a pure CAS transition. */
  const authorize = options.authorizeFresh;
  /** Trusted injected millisecond clock or Date.now. */
  const now = options.now ?? Date.now;
  /** Owned copy of the stable separate account-index HMAC key, wiped after drain. */
  const index = Buffer.from(options.indexKey);
  /** Owned rotating token-key copies keyed by public IDs; wiped after actual work drains. */
  const keys = new Map<string, Buffer>();
  try {
    // Copy only validated bounded rotating keys into manager-owned buffers.
    for (const key of options.keys) {
      if (
        !/^[A-Za-z0-9_-]{1,32}$/.test(key.id) ||
        keys.has(key.id) ||
        !(key.key instanceof Uint8Array) ||
        key.key.length !== 32
      ) {
        throw invalid();
      }
      keys.set(key.id, Buffer.from(key.key));
    }
    if (
      !keys.has(options.activeKeyId) ||
      !integer(options.maxPending ?? 32, 1, 256) ||
      typeof now !== 'function'
    ) {
      throw invalid();
    }
  } catch (error) {
    index.fill(0);
    // Wipe already copied keys if construction fails before ownership is published.
    for (const key of keys.values()) {
      key.fill(0);
    }
    throw error;
  }
  /** Explicit current issuance key ID; retained keys only verify earlier records. */
  const active = options.activeKeyId;
  /** Actual-settlement operation cap, default 32 and supported range 1–256. */
  const maxPending = options.maxPending ?? 32;
  let closed = false;
  /** Actual persistence/authorization work retained through settlement; close waits for it. */
  const pending = new Set<Promise<unknown>>();
  /** Read and validate the trusted server clock for this transition.
   * @returns {number} Safe nonnegative UTC milliseconds. */
  const stamp = () => {
    /** Validated server transition time; not a caller-provided event timestamp. */
    const time = now();
    if (!integer(time, 0, 8e15)) {
      throw invalid();
    }
    return time;
  };
  /** Bind exact tenant/account identity to a stable separate index key.
   * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
   * @returns {string} Account-index HMAC; hashing does not authenticate or anonymize identity.
   */
  function accountKey(account: AuthAccount) {
    if (!account || !text(account.tenant) || !text(account.account)) {
      throw invalid();
    }
    return createHmac('sha256', index)
      .update(JSON.stringify(['account', account.tenant, account.account]))
      .digest('base64url');
  }
  /** Bind a credential digest to key, account, purpose and exact bearer spelling.
   * @param {string} kid - Configured rotating key ID.
   * @param {string} key - Stable account-index digest.
   * @param {string} purpose - Explicit protocol purpose.
   * @param {string} raw - Private full bearer/code spelling, never logged.
   * @returns {string} Account/purpose-bound HMAC digest only. */
  const digest = (kid: string, key: string, purpose: string, raw: string) =>
    createHmac('sha256', keys.get(kid)!)
      .update(JSON.stringify(['zeruxjs.auth.record.v1', key, purpose, raw]))
      .digest('base64url');
  /** Verify an account/purpose-bound keyed digest only with explicitly configured retained keys.
   * @param {string} kid - Stored public key ID.
   * @param {string} key - Exact account-index key.
   * @param {string} purpose - Expected credential purpose.
   * @param {string} raw - Private submitted bearer/code spelling.
   * @param {string} expected - Expected private stored digest.
   * @returns {boolean} Whether the candidate matches; no plaintext credential is persisted.
   */
  function matches(
    kid: string,
    key: string,
    purpose: string,
    raw: string,
    expected: string
  ) {
    if (!keys.has(kid) || !/^[A-Za-z0-9_-]{43}$/.test(expected)) {
      return false;
    }
    return timingSafeEqual(
      Buffer.from(digest(kid, key, purpose, raw)),
      Buffer.from(expected)
    );
  }
  /** Bound actual persistence/authorization work without replaying host callbacks.
   * @param {() => Promise<T>} fn - Explicit asynchronous operation.
   * @returns {Promise<T>} Actual result or fixed error; pending work retains its slot until settlement.
   */
  function run<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(new AuthStateError('AUTH_CLOSED'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(new AuthStateError('AUTH_CAPACITY'));
    }
    /** Actual operation promise owns its admission slot even if the host stops waiting. */
    const task = fn().catch((error) => {
      if (error instanceof AuthStateError) {
        throw error;
      }
      throw new AuthStateError('AUTH_UNAVAILABLE', { cause: error });
    });
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task)
    );
    return task;
  }
  /** Read, validate and detach current shared state before credential decisions.
   * @param {string} key - Exact account-index HMAC key.
   * @returns {Promise<AuthSnapshot|null>} Verified current state or absence; malformed storage is unavailable, not successful auth.
   */
  async function readSnapshot(key: string): Promise<AuthSnapshot | null> {
    /** Current detached shared state with a never-reused opaque CAS revision. */
    const snapshot = await store.read(key);
    if (snapshot === null) {
      return null;
    }
    try {
      if (!snapshot || !text(snapshot.revision, 256)) {
        throw invalid();
      }
      validateState(snapshot.value);
    } catch (cause) {
      throw new AuthStateError('AUTH_UNAVAILABLE', { cause });
    }
    return structuredClone(snapshot);
  }
  // Transition callbacks are pure: CAS conflicts never replay external side effects.
  /** Retry only pure state transitions under at most eight exact-revision CAS attempts. External callbacks are never replayed.
   * @param {string} key - Exact account-index key.
   * @param {(state: AuthAccountState, time: number) => T} transition - Internal pure state mutation over a detached candidate and trusted server time.
   * @returns {Promise<T>} Transition result only after CAS commits; unknown/failed writes remain errors.
   */
  async function change<T>(
    key: string,
    transition: (state: AuthAccountState, time: number) => T
  ): Promise<T> {
    // Retry only the pure detached transition under a finite eight-CAS contention budget.
    for (let attempt = 0; attempt < 8; attempt++) {
      /** Current detached shared state with a never-reused opaque CAS revision. */
      const snapshot = await readSnapshot(key);
      /** Validated server transition time; not a caller-provided event timestamp. */
      const time = stamp();
      /** Owned transition candidate, cloned before pure retryable changes. */
      const state = snapshot ? structuredClone(snapshot.value) : empty();
      try {
        validateState(state);
      } catch (cause) {
        throw new AuthStateError('AUTH_UNAVAILABLE', { cause });
      }
      state.sessions = state.sessions.filter((item) => item.expiresAt > time);
      state.challenges = state.challenges.filter(
        (item) => item.expiresAt > time
      );
      /** Pure transition result returned only after an exact successful CAS. */
      const result = transition(state, time);
      // Replay steps survive until at least their accepted step is outside the maximum allowed window.
      /** State lifetime preserving replay steps for at least an hour and any live credentials. */
      const expiry = Math.max(
        time + 3600000,
        ...state.sessions.map((item) => item.expiresAt),
        ...state.challenges.map((item) => item.expiresAt)
      );
      /** Exact CAS result; only literal true commits, false means bounded contention retry. */
      const written = await store.compareAndSwap(
        key,
        snapshot?.revision ?? null,
        state,
        expiry
      );
      if (written === true) {
        return result;
      }
      if (written !== false) {
        throw new AuthStateError('AUTH_UNAVAILABLE');
      }
    }
    throw new AuthStateError('AUTH_UNAVAILABLE');
  }
  /** Generate fresh random session/challenge ID and bearer secret.
   * @returns {{id: string, secret: string}} Private one-time-issued credential material. */
  const token = () => ({
    id: randomBytes(16).toString('base64url'),
    secret: randomBytes(32).toString('base64url'),
  });
  /** Parse only the bounded supported opaque session wire format.
   * @param {string} raw - Private untrusted bearer token.
   * @returns {RegExpExecArray|null} Identifier/secret match or denial; no URL/cookie decoding.
   */
  function parse(raw: string) {
    return typeof raw === 'string' && raw.length < 128
      ? /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(raw)
      : null;
  }
  /** Validate and copy exact scopes without wildcard expansion.
   * @param {readonly string[]} value - Host-approved exact scope names.
   * @returns {string[]} Deduplicated at-most-32 scope list; unsupported labels reject.
   */
  function scopes(value: readonly string[]) {
    if (
      !Array.isArray(value) ||
      value.length > 32 ||
      value.some(
        (s) => typeof s !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(s)
      )
    ) {
      throw invalid();
    }
    return [...new Set(value)]; // Exact scopes only; no wildcard expansion.
  }
  /** Prepare a fresh private bearer and account-bound stored digest record.
   * @param {string} key - Stable account-index digest.
   * @param {string} device - Bounded host-assigned device label.
   * @param {string[]} permissions - Validated exact scopes.
   * @param {number} ttlMs - Bounded positive lifetime.
   * @param {number} time - Trusted server issuance time.
   * @returns {ReturnType<typeof session>} Private candidate; caller publishes it only after atomic state commit.
   */
  function session(
    key: string,
    device: string,
    permissions: string[],
    ttlMs: number,
    time: number
  ) {
    /** Generated or stored credential record used only inside its scoped transition. */
    const item = token();
    /** Full private opaque bearer spelling, never persisted or logged in plaintext. */
    const raw = `${item.id}.${item.secret}`;
    return {
      raw,
      record: {
        id: item.id,
        device,
        scopes: permissions,
        createdAt: time,
        expiresAt: time + ttlMs,
        kid: active,
        digest: digest(active, key, 'session', raw),
      },
    };
  }
  /** Clone public session metadata without digests or key IDs.
   * @param {AuthSession} record - Validated stored session.
   * @returns {{id: string, device: string, createdAt: number, expiresAt: number, scopes: string[]}} Detached metadata; not a bearer token or authorization proof. */
  const publicSession = (record: AuthSession) => ({
    id: record.id,
    device: record.device,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    scopes: [...record.scopes],
  });
  return {
    /** Issue only after host authentication and return plaintext bearer once CAS commits.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {{ device: string; scopes: readonly string[]; ttlMs: number }} input - Explicit bounded device, exact scopes and required lifetime.
     * @param {string} input.device - Bounded host-assigned device label.
     * @param {readonly string[]} input.scopes - Exact host-approved scopes without wildcard expansion.
     * @param {number} input.ttlMs - Explicit positive lifetime, bounded by the requested credential kind.
     * @returns {ReturnType<ReturnType<typeof createSharedAuth>['issueSession']>} Private bearer plus cloned public metadata; storage uncertainty is not successful issuance.
     */
    issueSession(
      account: AuthAccount,
      input: {
        /** Bounded host-assigned device label, not raw user-agent/IP telemetry. */
        device: string; /** Exact bounded permission labels; no wildcard expansion. */
        scopes: readonly string[];
        ttlMs: number;
      }
    ) {
      return run(async () => {
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(account);
        /** Validated deduplicated exact scopes with no wildcard expansion. */
        const permissions = scopes(input.scopes);
        /** Explicit bounded host device label and requested session lifetime. */
        const { device, ttlMs } = input;
        if (!text(device, 100) || !integer(ttlMs, 1, 30 * 86400000)) {
          throw invalid();
        }
        return change(key, (state, time) => {
          if (state.sessions.length >= 64) {
            throw new AuthStateError('AUTH_CAPACITY');
          }
          /** Fresh private bearer plus stored digest record; returned only after CAS commits. */
          const issued = session(key, device, permissions, ttlMs, time);
          state.sessions.push(issued.record);
          return { token: issued.raw, session: publicSession(issued.record) };
        });
      });
    },
    /** Check current shared account state, digest, expiry and optional exact scope.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {string} raw - Private submitted opaque bearer.
     * @param {string} scope - Optional exact permission; wildcard scopes are not expanded.
     * @returns {ReturnType<ReturnType<typeof createSharedAuth>['verifySession']>} Detached public metadata or null; malformed/unavailable storage rejects.
     */
    verifySession(account: AuthAccount, raw: string, scope?: string) {
      return run(async () => {
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(account);
        /** Exact supported opaque bearer components before current-state verification. */
        const parsed = parse(raw);
        if (scope !== undefined) {
          scopes([scope]);
        }
        if (!parsed) {
          return null;
        }
        /** Current detached shared state with a never-reused opaque CAS revision. */
        const snapshot = await readSnapshot(key);
        /** Validated server transition time; not a caller-provided event timestamp. */
        const time = stamp();
        /** Matching account-scoped stored session, subject to expiry, key and exact scope checks. */
        const found = snapshot?.value.sessions.find(
          (item) => item.id === parsed[1]
        );
        return found &&
          found.expiresAt > time &&
          matches(found.kid, key, 'session', raw, found.digest) &&
          (scope === undefined || found.scopes.includes(scope))
          ? publicSession(found)
          : null;
      });
    },
    /** Require fresh management authorization before listing current public session metadata.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @returns {ReturnType<ReturnType<typeof createSharedAuth>['inventory']>} Current unexpired sessions with retained keys, excluding digests/key IDs.
     */
    inventory(account: AuthAccount) {
      return run(async () => {
        /** Detached frozen host account labels used for fresh authorization. */
        const identity = Object.freeze({ ...account });
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(identity);
        if ((await authorize(identity, 'revoke-one')) !== true) {
          throw invalid();
        }
        /** Current detached shared state with a never-reused opaque CAS revision. */
        const snapshot = await readSnapshot(key);
        /** Validated server transition time; not a caller-provided event timestamp. */
        const time = stamp();
        return (snapshot?.value.sessions ?? [])
          .filter((item) => item.expiresAt > time && keys.has(item.kid))
          .map(publicSession);
      });
    },
    /** Freshly authorize and atomically remove one or all active sessions.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {string} id - Optional exact session ID; omission requests revoke-all.
     * @returns {Promise<number>} Removed active-session count; already admitted requests cannot be undone.
     */
    revoke(account: AuthAccount, id?: string) {
      return run(async () => {
        /** Detached frozen host account labels used for fresh authorization. */
        const identity = Object.freeze({ ...account });
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(identity);
        if (id !== undefined && !/^[A-Za-z0-9_-]{22}$/.test(id)) {
          throw invalid();
        }
        if (
          (await authorize(
            identity,
            id === undefined ? 'revoke-all' : 'revoke-one'
          )) !== true
        ) {
          throw invalid();
        }
        return change(key, (state) => {
          /** Prior retained credential count used to report the exact explicit removal result. */
          const before = state.sessions.length;
          state.sessions =
            id === undefined
              ? []
              : state.sessions.filter((item) => item.id !== id);
          return before - state.sessions.length;
        });
      });
    },
    /** Freshly authorize and atomically remove one purpose or all outstanding challenges.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {AuthChallenge['purpose']} purpose - Optional explicit challenge purpose.
     * @returns {Promise<number>} Removed active-challenge count; session revocation is separate.
     */
    revokeChallenges(account: AuthAccount, purpose?: AuthChallenge['purpose']) {
      return run(async () => {
        /** Detached frozen host account labels used for fresh authorization. */
        const identity = Object.freeze({ ...account });
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(identity);
        if (
          purpose !== undefined &&
          !['reset', 'otp', 'magic'].includes(purpose)
        ) {
          throw invalid();
        }
        if ((await authorize(identity, 'revoke-challenges')) !== true) {
          throw invalid();
        }
        return change(key, (state) => {
          /** Prior retained credential count used to report the exact explicit removal result. */
          const before = state.challenges.length;
          state.challenges =
            purpose === undefined
              ? []
              : state.challenges.filter((item) => item.purpose !== purpose);
          return before - state.challenges.length;
        });
      });
    },
    /** Freshly authorize exact new scopes and atomically replace the old bearer.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {string} raw - Private current session token.
     * @param {readonly string[]} permissions - Fresh host-approved exact replacement scopes.
     * @returns {ReturnType<ReturnType<typeof createSharedAuth>['rotateSession']>} New private bearer preserving remaining lifetime/device; the old bearer is consumed.
     */
    rotateSession(
      account: AuthAccount,
      raw: string,
      permissions: readonly string[]
    ) {
      return run(async () => {
        /** Detached frozen host account labels used for fresh authorization. */
        const identity = Object.freeze({ ...account });
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(identity);
        /** Exact supported opaque bearer components before current-state verification. */
        const parsed = parse(raw);
        /** Host-approved replacement exact scopes, validated before rotation. */
        const granted = scopes(permissions);
        if (!parsed || (await authorize(identity, 'rotate')) !== true) {
          throw invalid();
        }
        return change(key, (state, time) => {
          /** Current matching session whose remaining lifetime/device are preserved during rotation. */
          const previous = state.sessions.find((item) => item.id === parsed[1]);
          if (
            !previous ||
            !matches(previous.kid, key, 'session', raw, previous.digest)
          ) {
            throw invalid();
          }
          /** Fresh private bearer plus stored digest record; returned only after CAS commits. */
          const issued = session(
            key,
            previous.device,
            granted,
            previous.expiresAt - time,
            time
          );
          state.sessions = state.sessions.filter(
            (item) => item.id !== previous.id
          );
          state.sessions.push(issued.record);
          return { token: issued.raw, session: publicSession(issued.record) };
        });
      });
    },
    /** Persist a bounded account/purpose/attempt-bound challenge before returning its private secret.
 * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
 * @param {{
        purpose: AuthChallenge['purpose'];
        ttlMs: number;
        maxAttempts?: number;
      }} input - Required purpose/lifetime and optional finite failure budget.
 * @param {AuthChallenge['purpose']} input.purpose - Exact reset/otp/magic purpose.
 * @param {number} input.ttlMs - Explicit positive lifetime, bounded by the requested credential kind.
 * @param {number|undefined} input.maxAttempts - Failure budget, default five and supported 1–10.
 * @returns {ReturnType<ReturnType<typeof createSharedAuth>['issueChallenge']>} Private ID/secret/expiry receipt; host delivers it securely.
 */
    issueChallenge(
      account: AuthAccount,
      input: {
        /** Explicit reset/otp/magic challenge purpose. */
        purpose: AuthChallenge['purpose'];
        ttlMs: number;
        /** Finite challenge attempt budget, default five and supported 1–10. */
        maxAttempts?: number;
      }
    ) {
      return run(async () => {
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(account);
        /** Challenge failure budget, default five and supported range 1–10. */
        const maxAttempts = input.maxAttempts ?? 5;
        /** Explicit challenge purpose and required bounded lifetime. */
        const { purpose, ttlMs } = input;
        if (
          !['reset', 'otp', 'magic'].includes(purpose) ||
          !integer(ttlMs, 1, 900000) ||
          !integer(maxAttempts, 1, 10)
        ) {
          throw invalid();
        }
        /** Generated or stored credential record used only inside its scoped transition. */
        const item = token();
        /** Private uniform OTP or random challenge secret, returned only after persisted issuance. */
        const secret =
          purpose === 'otp'
            ? String(randomInt(0, 1000000)).padStart(6, '0')
            : item.secret;
        return change(key, (state, time) => {
          if (state.challenges.length >= 32) {
            throw new AuthStateError('AUTH_CAPACITY');
          }
          state.challenges.push({
            id: item.id,
            purpose,
            kid: active,
            digest: digest(active, key, purpose, `${item.id}.${secret}`),
            expiresAt: time + ttlMs,
            attempts: 0,
            maxAttempts,
          });
          return { id: item.id, secret, expiresAt: time + ttlMs };
        });
      });
    },
    /** Atomically consume success or count a failed purpose-bound attempt.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {{ purpose: AuthChallenge['purpose']; id: string; secret: string }} input - Private exact purpose/ID/secret proof.
     * @param {AuthChallenge['purpose']} input.purpose - Exact reset/otp/magic purpose.
     * @param {string} input.id - Opaque exact challenge identifier.
     * @param {string} input.secret - Private submitted challenge proof, never logged.
     * @returns {Promise<boolean>} False for invalid/missing/expired/replayed proof; success grants only the named purpose.
     */
    consumeChallenge(
      account: AuthAccount,
      input: {
        /** Explicit reset/otp/magic challenge purpose. */
        purpose: AuthChallenge['purpose']; /** Opaque random credential identifier. */
        id: string;
        secret: string;
      }
    ) {
      return run(async () => {
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(account);
        /** Private submitted challenge proof bound to this exact account/purpose. */
        const { purpose, id, secret } = input;
        if (
          !['reset', 'otp', 'magic'].includes(purpose) ||
          !/^[A-Za-z0-9_-]{22}$/.test(id) ||
          !text(secret, 128)
        ) {
          return false;
        }
        return change(key, (state) => {
          /** Generated or stored credential record used only inside its scoped transition. */
          const item = state.challenges.find(
            (item) => item.id === id && item.purpose === purpose
          );
          if (!item) {
            return false;
          }
          item.attempts++;
          /** Digest verification outcome; success/exhaustion removes the record in the same CAS. */
          const accepted = matches(
            item.kid,
            key,
            purpose,
            `${id}.${secret}`,
            item.digest
          );
          if (accepted || item.attempts >= item.maxAttempts) {
            state.challenges = state.challenges.filter(
              (record) => record.id !== item.id
            );
          }
          return accepted;
        });
      });
    },
    /** Verify enrolled parameters and atomically advance the highest accepted TOTP step. Requires host edge admission and a stable enrolled credential ID.
     * @param {AuthAccount} account - Host-verified tenant/account labels, never untrusted request identity.
     * @param {string} credentialId - Stable host-enrolled credential identity, never request-selected enrollment.
     * @param {string} code - Private submitted decimal code.
     * @param {string} secret - Host-owned encrypted-at-rest enrollment secret.
     * @param {Omit<TotpOptions, 'now'> & { window?: number }} input - Explicit enrolled parameters and bounded drift; no caller clock override.
     * @returns {Promise<boolean>} True only after replay-state CAS; older/replayed steps deny even across replicas.
     */
    consumeTotp(
      account: AuthAccount,
      credentialId: string,
      code: string,
      secret: string,
      input: Omit<TotpOptions, 'now'> & { window?: number } = {}
    ) {
      return run(async () => {
        /** HMAC-bound account-index key for the exact tenant/account tuple. */
        const key = accountKey(account);
        /** Validated server transition time; not a caller-provided event timestamp. */
        const time = stamp();
        /** Host-enrolled TOTP period seconds, default 30 and bounded to 10–300. */
        const period = input.period ?? 30;
        /** Bounded enrolled TOTP drift steps, default one and maximum five. */
        const window = input.window ?? 1;
        if (
          !text(credentialId) ||
          !integer(window, 0, 5) ||
          !integer(period, 10, 300) ||
          ![6, 8].includes(input.digits ?? 6) ||
          !['sha1', 'sha256', 'sha512'].includes(input.algorithm ?? 'sha1') ||
          typeof secret !== 'string' ||
          secret.length > 128
        ) {
          throw invalid();
        }
        if (
          typeof code !== 'string' ||
          !new RegExp(`^[0-9]{${input.digits ?? 6}}$`).test(code)
        ) {
          return false;
        }
        /** Current server-time TOTP step used for bounded candidate verification. */
        const counter = Math.floor(time / (period * 1000));
        let matched = -1;
        // Compare every bounded candidate time step before atomically consuming the accepted highest step.
        for (
          let step = Math.max(0, counter - window);
          step <= counter + window;
          step++
        ) {
          /** Expected secret code for one bounded time step; no early-match return. */
          const candidate = generateTotp(secret, {
            ...input,
            now: step * period * 1000,
          });
          if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
            matched = step;
          }
        }
        if (matched < 0) {
          return false;
        }
        /** Stable keyed enrolled-credential replay-map identity, not a client-selected enrollment. */
        const credential = createHmac('sha256', index)
          .update(JSON.stringify(['totp', credentialId]))
          .digest('base64url');
        return change(key, (state, current) => {
          if (
            Math.abs(Math.floor(current / (period * 1000)) - matched) > window
          ) {
            return false;
          }
          if (
            matched <=
            (Object.hasOwn(state.steps, credential)
              ? state.steps[credential]
              : -1)
          ) {
            return false;
          }
          if (
            !Object.hasOwn(state.steps, credential) &&
            Object.keys(state.steps).length >= 16
          ) {
            throw new AuthStateError('AUTH_CAPACITY');
          }
          state.steps[credential] = matched;
          return true;
        });
      });
    },
    /** Stop admission, drain actual work and wipe owned HMAC key copies.
     * @returns {Promise<void>} Borrowed store stays open; noncooperative host operations may delay drain.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      index.fill(0);
      // Wipe key copies only after all persistence/authorization work has actually drained.
      for (const key of keys.values()) {
        key.fill(0);
      }
      keys.clear();
    },
  };
}

/** Parse one exact opaque cookie without accepting duplicates, encoded aliases or control-bearing headers.
 * @param {string | null} header - Private bounded Cookie header, never logged.
 * @param {string} name - Selected configured cookie name, default __Host-session.
 * @returns {string|null} Private selected token or absence/invalid header; invalid cookie-name configuration throws.
 */
export function readAuthSessionCookie(
  header: string | null,
  name = '__Host-session'
): string | null {
  if (
    typeof name !== 'string' ||
    !/^(__Host-|__Secure-)?[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(name)
  ) {
    throw invalid();
  }
  if (header === null) {
    return null;
  }
  if (
    typeof header !== 'string' ||
    Buffer.byteLength(header) > 8192 ||
    /[^\x20-\x7e]/.test(header)
  ) {
    return null;
  }
  let found: string | null = null;
  // Check every cookie pair so duplicate selected credentials and malformed headers fail closed.
  for (const part of header.split(';')) {
    /** Trimmed cookie field; duplicates and malformed selected tokens are rejected. */
    const pair = part.trim();
    /** First equals-sign offset separating cookie name from its exact token spelling. */
    const at = pair.indexOf('=');
    if (at < 1) {
      return null;
    }
    if (pair.slice(0, at) !== name) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    /** Selected opaque session cookie spelling, never decoded or logged. */
    const value = pair.slice(at + 1);
    if (!/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(value)) {
      return null;
    }
    found = value;
  }
  return found;
}

/** Emit a secure host-only opaque-session cookie; this alone does not implement CSRF authorization.
 * @param {string} token - Private validated opaque bearer.
 * @param {number} maxAgeSeconds - Bounded lifetime seconds; server session expiry stays authoritative.
 * @returns {string} Private Set-Cookie value with Path=/, Secure, HttpOnly and SameSite=Strict; no Domain.
 */
export function authSessionCookie(
  token: string,
  maxAgeSeconds: number
): string {
  if (
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token) ||
    !integer(maxAgeSeconds, 0, 30 * 86400)
  ) {
    throw invalid();
  }
  return `__Host-session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
