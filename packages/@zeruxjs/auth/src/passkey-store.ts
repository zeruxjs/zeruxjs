import { randomBytes } from 'node:crypto';
import type { AuthAccount } from './shared-auth.js';

export interface PasskeyScope extends AuthAccount {
  /** Explicit configured relying-party DNS ID. */
  rpId: string;
}
export interface PasskeyCredential {
  /** Opaque canonical credential or challenge ID. */
  id: string;
  /** Canonical base64url COSE public key, never a private key. */
  publicKey: string;
  /** Verified authenticator counter; revision CAS remains required at zero. */
  counter: number;
  /** Fresh opaque nonreused credential revision. */
  revision: string;
  /** Stable opaque account handle under the RP. */
  userHandle: string;
  /** Verified singleDevice/multiDevice authenticator classification. */
  deviceType: 'singleDevice' | 'multiDevice';
  /** Verified credential backup state. */
  backedUp: boolean;
}
export interface PasskeyChallenge {
  /** Opaque canonical credential or challenge ID. */
  id: string;
  /** Private one-attempt random challenge. */
  challenge: string;
  /** Host-verified initiating server-session binding. */
  session: string;
  /** Exact registration/authentication ceremony kind. */
  kind: 'registration' | 'authentication';
  /** Absolute server expiry in milliseconds. */
  expiresAt: number;
  /** Stable opaque account handle under the RP. */
  userHandle: string;
  /** Private account generation fencing running ceremonies. */
  epoch: string;
}
/** Atomic shared storage, not a get/set cache. Every operation is account/tenant/RP scoped.
 * Implementations enforce <=32 credentials and <=8 live challenges/account, current reads,
 * RP-wide credential-ID uniqueness (across tenants/accounts), and unguessable nonreused revisions/epochs.
 * Credential insertion and advancement require the unchanged ceremony epoch.
 * Recovery must atomically consume the digest, delete ALL credentials/challenges/recovery codes and
 * rotate the epoch, fencing already-running ceremonies. No expiry eviction of credential state.
 * Host owns persistence, bounded acquisition/deadlines, encryption, backup and shutdown. */
export interface PasskeyStore {
  /** Required shared atomic passkey protocol identifier. */
  readonly capability: 'passkey-atomic-v1';
  /** Read detached current credentials for one exact RP/tenant/account.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @returns {Promise<PasskeyCredential[]>} At most 32 records with consistent user handles; fresh shared reads are required.
   */
  list(scope: PasskeyScope): Promise<PasskeyCredential[]>;
  /** Atomically retain a bounded challenge under the current account epoch.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {Omit<PasskeyChallenge, 'epoch'>} challenge - Bounded session/kind-bound challenge; storage stamps the current epoch.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<void>} At most eight live challenges; invalid/duplicate/capacity errors reject.
   */
  putChallenge(
    scope: PasskeyScope,
    challenge: Omit<PasskeyChallenge, 'epoch'>,
    now: number
  ): Promise<void>;
  /** Atomically consume exactly one matching unexpired account/session/kind challenge before verification.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {string} id - Exact opaque challenge/credential ID.
   * @param {string} session - Host-verified initiating server session.
   * @param {PasskeyChallenge['kind']} kind - Exact registration/authentication ceremony kind.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<PasskeyChallenge|null>} Detached consumed challenge or denial; failures never revive a consumed ceremony.
   */
  takeChallenge(
    scope: PasskeyScope,
    id: string,
    session: string,
    kind: PasskeyChallenge['kind'],
    now: number
  ): Promise<PasskeyChallenge | null>;
  /** Atomically insert only under the unchanged ceremony epoch and RP-wide credential-ID uniqueness.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {PasskeyCredential} credential - Validated public-key credential metadata; not a private key.
   * @param {string} epoch - Unchanged account epoch consumed with the ceremony.
   * @returns {Promise<boolean>} False for stale epoch/duplicate identity; capacity/invalid storage remains an error.
   */
  insert(
    scope: PasskeyScope,
    credential: PasskeyCredential,
    epoch: string
  ): Promise<boolean>;
  /** CAS the exact credential revision and epoch with verified counter/backup state.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {string} id - Exact opaque challenge/credential ID.
   * @param {string} revision - Exact previous opaque credential revision.
   * @param {number} counter - New authenticator counter; zero-to-zero still requires a successful CAS.
   * @param {string} epoch - Unchanged account epoch consumed with the ceremony.
   * @param {boolean} backedUp - Verified authenticator backup-state flag.
   * @returns {Promise<boolean>} Stale/replayed state denies; increasing counters are required except zero-to-zero CAS-protected assertions.
   */
  advance(
    scope: PasskeyScope,
    id: string,
    revision: string,
    counter: number,
    epoch: string,
    backedUp: boolean
  ): Promise<boolean>;
  /** Remove one credential and rotate epoch while invalidating pending ceremonies.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {string} id - Exact opaque challenge/credential ID.
   * @returns {Promise<boolean>} Whether a credential was removed; host fresh authorization is separate.
   */
  remove(scope: PasskeyScope, id: string): Promise<boolean>;
  /** Atomically replace the private recovery digest set and expiry.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {string[]} digests - Private account/purpose-bound recovery HMACs, never plaintext codes.
   * @param {number} expiresAt - Server-time recovery-set expiry.
   * @returns {Promise<void>} At most ten stored digests; host enrollment/authentication policy is separate.
   */
  replaceRecovery(
    scope: PasskeyScope,
    digests: string[],
    expiresAt: number
  ): Promise<void>;
  /** Atomically consume a valid recovery digest, clear all credentials/challenges/codes and rotate the epoch.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @param {string} digest - Private submitted-code HMAC to consume atomically.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<boolean>} False for missing/expired/reused proof; success fences already-running ceremonies.
   */
  recover(scope: PasskeyScope, digest: string, now: number): Promise<boolean>;
}
/** Fixed-code failure; private ceremony causes must not reach client JSON. */
export class PasskeyError extends Error {
  /** Create a fixed public passkey failure with an optional private cause.
 * @param {| 'PASSKEY_DENIED'
      | 'PASSKEY_UNAVAILABLE'
      | 'PASSKEY_CAPACITY'
      | 'PASSKEY_CLOSED'} code - Supported failure category.
 * @param {ErrorOptions} options - Optional private cause for trusted diagnostics.
 */
  constructor(
    readonly code:
      | 'PASSKEY_DENIED'
      | 'PASSKEY_UNAVAILABLE'
      | 'PASSKEY_CAPACITY'
      | 'PASSKEY_CLOSED',
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'PasskeyError';
  }
}
/** Create a fixed public denial without exposing ceremony details.
 * @returns {PasskeyError} Redacted passkey denial. */
export const passkeyDenied = () => new PasskeyError('PASSKEY_DENIED');
/** Validate bounded labels while rejecting control characters.
 * @param {unknown} value - Candidate trusted-context label.
 * @param {number} max - Maximum length, default 128.
 * @returns {boolean} Whether the bounded label is supported. */
export const passkeyText = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  // eslint-disable-next-line no-control-regex -- Reject controls in bounded identity labels.
  !/[\x00-\x1f\x7f]/.test(value);
/** Require canonical bounded base64url bytes; aliases and invalid lengths reject.
 * @param {unknown} value - Untrusted encoded candidate.
 * @param {number} max - Maximum decoded bytes.
 * @param {number} min - Minimum decoded bytes, default one.
 * @returns {boolean} Whether decoded bytes match bounds and canonical spelling.
 */
export function passkeyBase64(
  value: unknown,
  max: number,
  min = 1
): value is string {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil((max * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return false;
  }
  /** Decoded candidate bytes checked for exact canonical base64url spelling and byte bounds. */
  const raw = Buffer.from(value, 'base64url');
  return (
    raw.length >= min &&
    raw.length <= max &&
    raw.toString('base64url') === value
  );
}
/** Validate host account/RP labels without authenticating caller claims.
 * @param {PasskeyScope} scope - Host-verified account/tenant plus configured RP ID.
 * @returns {void} Unsupported scope labels throw.
 */
export function validatePasskeyScope(scope: PasskeyScope) {
  if (
    !scope ||
    !passkeyText(scope.tenant) ||
    !passkeyText(scope.account) ||
    !passkeyText(scope.rpId, 253) ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(scope.rpId)
  ) {
    throw passkeyDenied();
  }
}
/** Validate supported public-key/counter/revision metadata before using stored credentials.
 * @param {PasskeyCredential} value - Untrusted persisted credential record.
 * @returns {void} Malformed or unsupported stored metadata rejects.
 */
export function validatePasskeyCredential(value: PasskeyCredential) {
  if (
    !value ||
    !passkeyBase64(value.id, 1024) ||
    !passkeyBase64(value.publicKey, 4096) ||
    !passkeyBase64(value.userHandle, 64) ||
    !passkeyText(value.revision) ||
    !Number.isSafeInteger(value.counter) ||
    value.counter < 0 ||
    value.counter > 0xffffffff ||
    !['singleDevice', 'multiDevice'].includes(value.deviceType) ||
    typeof value.backedUp !== 'boolean'
  ) {
    throw passkeyDenied();
  }
}
/** Generate a fresh opaque revision/epoch, never a reused counter.
 * @returns {string} Random 192-bit base64url revision identity. */
const revision = () => randomBytes(24).toString('base64url');
/** Create bounded process-local atomic passkey reference state. No enrolled identity or replay state is silently evicted.
 * @param {{ maxAccounts?: number }} options - Optional account capacity; default 1000 and maximum 10000.
 * @param {number|undefined} options.maxAccounts - Account capacity, default 1000 and maximum 10000.
 * @returns {PasskeyStore & {clear(): void, readonly size: number}} Reference store only, not production shared persistence.
 */
export function createMemoryPasskeyStore(
  options: { maxAccounts?: number } = {}
): PasskeyStore & {
  /** Destroy all local identity/replay state during explicit owned test teardown.
   * @returns {void} Never clear enrolled production identities as an eviction policy.
   */
  clear(): void;
  readonly size: number;
} {
  /** Reference account capacity, default 1000 and maximum 10000; credentials never silently evict. */
  const max = options.maxAccounts ?? 1000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000) {
    throw passkeyDenied();
  }
  type State = {
    /** Private account generation fencing running ceremonies. */
    epoch: string;
    credentials: PasskeyCredential[];
    challenges: PasskeyChallenge[];
    recovery: string[];
    recoveryExpires: number;
  };
  /** Process-local RP/account credential and replay state; production needs a shared atomic store. */
  const accounts = new Map<string, State>();
  /** Validate and serialize exact RP/tenant/account scope without ambiguous concatenation.
   * @param {PasskeyScope} scope - Host-verified account plus configured relying party.
   * @returns {string} Exact reference-store partition key. */
  const key = (scope: PasskeyScope) => {
    validatePasskeyScope(scope);
    return JSON.stringify([scope.rpId, scope.tenant, scope.account]);
  };
  /** Resolve or create one bounded reference account state.
   * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
   * @returns {State} Owned local state; capacity failure never evicts another enrolled account.
   */
  function state(scope: PasskeyScope): State {
    /** Exact validated reference-store scope key. */
    const id = key(scope);
    let entry = accounts.get(id);
    if (!entry) {
      if (accounts.size >= max) {
        throw new PasskeyError('PASSKEY_CAPACITY');
      }
      entry = {
        epoch: revision(),
        credentials: [],
        challenges: [],
        recovery: [],
        recoveryExpires: 0,
      };
      accounts.set(id, entry);
    }
    return entry;
  }
  return {
    capability: 'passkey-atomic-v1',
    /** Read detached current credentials for one exact RP/tenant/account.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @returns {Promise<PasskeyCredential[]>} At most 32 records with consistent user handles; fresh shared reads are required.
     */
    async list(scope) {
      return structuredClone(accounts.get(key(scope))?.credentials ?? []);
    },
    /** Atomically retain a bounded challenge under the current account epoch.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {Omit<PasskeyChallenge, 'epoch'>} challenge - Bounded session/kind-bound challenge; storage stamps the current epoch.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<void>} At most eight live challenges; invalid/duplicate/capacity errors reject.
     */
    async putChallenge(scope, challenge, now) {
      if (
        !challenge ||
        !passkeyBase64(challenge.id, 16, 16) ||
        !passkeyBase64(challenge.challenge, 32, 32) ||
        !passkeyBase64(challenge.userHandle, 64) ||
        !passkeyText(challenge.session) ||
        !['registration', 'authentication'].includes(challenge.kind) ||
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.expiresAt <= now ||
        challenge.expiresAt - now > 300000
      ) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = state(scope);
      entry.challenges = entry.challenges.filter(
        (item) => item.expiresAt > now
      );
      if (
        entry.challenges.length >= 8 ||
        entry.challenges.some((item) => item.id === challenge.id)
      ) {
        throw new PasskeyError('PASSKEY_CAPACITY');
      }
      entry.challenges.push({
        ...structuredClone(challenge),
        epoch: entry.epoch,
      });
    },
    /** Atomically consume exactly one matching unexpired account/session/kind challenge before verification.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {string} id - Exact opaque challenge/credential ID.
     * @param {string} session - Host-verified initiating server session.
     * @param {PasskeyChallenge['kind']} kind - Exact registration/authentication ceremony kind.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<PasskeyChallenge|null>} Detached consumed challenge or denial; failures never revive a consumed ceremony.
     */
    async takeChallenge(scope, id, session, kind, now) {
      if (
        !passkeyBase64(id, 16, 16) ||
        !passkeyText(session) ||
        !['registration', 'authentication'].includes(kind) ||
        !Number.isSafeInteger(now) ||
        now < 0
      ) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = accounts.get(key(scope));
      if (!entry) {
        return null;
      }
      entry.challenges = entry.challenges.filter(
        (item) => item.expiresAt > now
      );
      /** Matching account-scoped credential/challenge used under exact epoch/revision checks. */
      const item = entry.challenges.find(
        (item) =>
          item.id === id && item.session === session && item.kind === kind
      );
      if (!item) {
        return null;
      }
      entry.challenges = entry.challenges.filter((value) => value.id !== id);
      return structuredClone(item);
    },
    /** Atomically insert only under the unchanged ceremony epoch and RP-wide credential-ID uniqueness.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {PasskeyCredential} credential - Validated public-key credential metadata; not a private key.
     * @param {string} epoch - Unchanged account epoch consumed with the ceremony.
     * @returns {Promise<boolean>} False for stale epoch/duplicate identity; capacity/invalid storage remains an error.
     */
    async insert(scope, credential, epoch) {
      validatePasskeyCredential(credential);
      if (!passkeyText(epoch)) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = state(scope);
      if (
        entry.epoch !== epoch ||
        entry.credentials.some(
          (item) => item.userHandle !== credential.userHandle
        )
      ) {
        return false;
      }
      if (entry.credentials.length >= 32) {
        throw new PasskeyError('PASSKEY_CAPACITY');
      }
      // Enforce RP-wide credential ID uniqueness across every reference account/tenant.
      for (const [id, other] of accounts) {
        if (
          JSON.parse(id)[0] === scope.rpId &&
          other.credentials.some((item) => item.id === credential.id)
        ) {
          return false;
        }
      }
      entry.credentials.push(structuredClone(credential));
      return true;
    },
    /** CAS the exact credential revision and epoch with verified counter/backup state.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {string} id - Exact opaque challenge/credential ID.
     * @param {string} expected - Exact previous opaque credential revision.
     * @param {number} counter - New authenticator counter; zero-to-zero still requires a successful CAS.
     * @param {string} epoch - Unchanged account epoch consumed with the ceremony.
     * @param {boolean} backedUp - Verified authenticator backup-state flag.
     * @returns {Promise<boolean>} Stale/replayed state denies; increasing counters are required except zero-to-zero CAS-protected assertions.
     */
    async advance(scope, id, expected, counter, epoch, backedUp) {
      if (
        !passkeyBase64(id, 1024) ||
        !passkeyText(expected) ||
        !passkeyText(epoch) ||
        typeof backedUp !== 'boolean' ||
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        counter > 0xffffffff
      ) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = accounts.get(key(scope));
      /** Matching account-scoped credential/challenge used under exact epoch/revision checks. */
      const item = entry?.credentials.find((item) => item.id === id);
      if (
        !entry ||
        !item ||
        entry.epoch !== epoch ||
        item.revision !== expected ||
        ((item.counter !== 0 || counter !== 0) && counter <= item.counter)
      ) {
        return false;
      }
      item.counter = counter;
      item.backedUp = backedUp;
      item.revision = revision();
      return true;
    },
    /** Remove one credential and rotate epoch while invalidating pending ceremonies.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {string} id - Exact opaque challenge/credential ID.
     * @returns {Promise<boolean>} Whether a credential was removed; host fresh authorization is separate.
     */
    async remove(scope, id) {
      if (!passkeyBase64(id, 1024)) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = accounts.get(key(scope));
      if (!entry) {
        return false;
      }
      /** Credential count before explicit removal; even removal fences pending ceremonies. */
      const before = entry.credentials.length;
      entry.credentials = entry.credentials.filter((item) => item.id !== id);
      // Fence all in-flight ceremonies, including a removed credential's assertion.
      entry.epoch = revision();
      entry.challenges = [];
      return entry.credentials.length !== before;
    },
    /** Atomically replace the private recovery digest set and expiry.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {string[]} digests - Private account/purpose-bound recovery HMACs, never plaintext codes.
     * @param {number} expiresAt - Server-time recovery-set expiry.
     * @returns {Promise<void>} At most ten stored digests; host enrollment/authentication policy is separate.
     */
    async replaceRecovery(scope, digests, expiresAt) {
      if (
        !Array.isArray(digests) ||
        digests.length < 1 ||
        digests.length > 10 ||
        digests.some((value) => !passkeyBase64(value, 32, 32)) ||
        new Set(digests).size !== digests.length ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt < 0
      ) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = state(scope);
      entry.recovery = [...digests];
      entry.recoveryExpires = expiresAt;
    },
    /** Atomically consume a valid recovery digest, clear all credentials/challenges/codes and rotate the epoch.
     * @param {PasskeyScope} scope - Host-verified RP/tenant/account tuple.
     * @param {string} digest - Private submitted-code HMAC to consume atomically.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<boolean>} False for missing/expired/reused proof; success fences already-running ceremonies.
     */
    async recover(scope, digest, now) {
      if (
        !passkeyBase64(digest, 32, 32) ||
        !Number.isSafeInteger(now) ||
        now < 0
      ) {
        throw passkeyDenied();
      }
      /** Account-owned credential/challenge/recovery state, never returned by reference. */
      const entry = accounts.get(key(scope));
      if (
        !entry ||
        entry.recoveryExpires <= now ||
        !entry.recovery.includes(digest)
      ) {
        return false;
      }
      entry.credentials = [];
      entry.challenges = [];
      entry.recovery = [];
      entry.recoveryExpires = 0;
      entry.epoch = revision();
      return true;
    },
    /** Destroy all local identity/replay state during explicit owned test teardown.
     * @returns {void} Never clear enrolled production identities as an eviction policy.
     */
    clear() {
      accounts.clear();
    },
    /** Count enrolled reference accounts without evicting live identities.
     * @returns {number} Current process-local account count.
     */
    get size() {
      return accounts.size;
    },
  };
}
