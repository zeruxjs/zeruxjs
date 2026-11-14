import { createHmac, randomBytes } from 'node:crypto';
import type { AuthAccount } from './shared-auth.js';
import {
  PasskeyError,
  passkeyDenied,
  passkeyText,
  passkeyBase64,
  validatePasskeyCredential,
  validatePasskeyScope,
  type PasskeyStore,
  type PasskeyScope,
  type PasskeyCredential,
  type PasskeyChallenge,
} from './passkey-store.js';

/** JSON options are sent to a WebAuthn browser client; convert base64url fields for the native browser API. */
export interface PasskeyRegistrationOptions {
  /** Random one-use ceremony value represented as base64url. */
  challenge: string;
  /** Explicit configured relying-party metadata. */
  rp: { id?: string; name: string };
  /** Opaque account handle and inert host display labels. */
  user: { id: string; name: string; displayName: string };
  /** Supported public-key algorithm descriptors, not arbitrary crypto code. */
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  /** Public ceremony timeout matching bounded server expiry. */
  timeout?: number;
  /** Configured none-format policy; no hardware provenance certification. */
  attestation?: string;
  /** Current account credential IDs excluded during enrollment. */
  excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  /** Explicit native authenticator preferences; user verification is required by the manager. */
  authenticatorSelection?: {
    residentKey?: string;
    requireResidentKey?: boolean;
    /** Required native verification policy. */
    userVerification?: string;
    authenticatorAttachment?: string;
  };
}
export interface PasskeyAuthenticationOptions {
  /** Random one-use ceremony value represented as base64url. */
  challenge: string;
  /** Explicit fixed relying-party DNS ID. */
  rpId?: string;
  /** Public ceremony timeout matching bounded server expiry. */
  timeout?: number;
  /** Required native verification policy. */
  userVerification?: string;
  /** Current account credential IDs allowed for this account-first flow. */
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
}
export interface PasskeyIdentity extends AuthAccount {
  /** Verified webauthn or recovery proof provenance. */
  method: 'webauthn' | 'recovery';
  /** Server verification observation time. */
  verifiedAt: number;
  /** Verified enrolled credential ID when applicable. */
  credentialId?: string;
}
export interface PasskeyManagerOptions {
  /** Borrowed atomic account/RP store; never closed by the manager. */
  store: PasskeyStore;
  /** Explicit fixed relying-party DNS ID. */
  rpId: string;
  /** Bounded inert relying-party display name. */
  rpName: string;
  /** One to eight exact approved same-RP origins. */
  origins: readonly string[];
  /** Stable separate HMAC key for user handles and recovery-code digests. Keep outside credential storage. */
  bindingKey: Uint8Array;
  /** Require recent independent host proof for enrollment, removal or recovery enrollment.
   * @param {Readonly<AuthAccount>} account - Verified target account; never browser role claims.
   * @param {'enroll' | 'remove' | 'recovery-enroll'} action - Explicit privileged management operation.
   * @param {string} session - Verified initiating server session.
   * @returns {Promise<boolean>} Only literal true authorizes; the host must enforce freshness and tenant/account ownership.
   */
  authorizeFresh(
    account: Readonly<AuthAccount>,
    action: 'enroll' | 'remove' | 'recovery-enroll',
    session: string
  ): Promise<boolean>;
  /** Trusted server clock or Date.now. */
  now?: () => number;
  /** Server ceremony lifetime, default 120000ms and range 1000–300000ms. */
  challengeTtlMs?: number;
  /** Actual-settlement cap, default 16 and range 1–64. */
  maxPending?: number;
}
type Library = typeof import('@simplewebauthn/server', {
  with: { 'resolution-mode': 'import' },
});
/** Shared lazy verifier load promise only; no per-account credential state or global verifier configuration. */
let library: Promise<Library> | undefined;
// Import only on configured use. Failure stays actionable when installed with --omit=optional.
/** Lazily load the maintained optional native verifier on explicit configured use. Failed loading remains actionable and can be retried later.
 * @returns {Promise<Library>} Verifier module or fixed unavailable error with a private cause.
 */
async function backend(): Promise<Library> {
  try {
    return await (library ??= import('@simplewebauthn/server'));
  } catch (cause) {
    library = undefined;
    throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause });
  }
}
/** Copy a bounded inert WebAuthn JSON response while rejecting executable accessors and cross-origin delegation.
 * @param {unknown} value - Untrusted browser credential JSON, bounded before verifier dispatch.
 * @returns {Record<string, any>} Validated detached response; malformed/oversized/deep input denies.
 */
function responseObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw passkeyDenied();
  }
  let nodes = 0,
    budget = 131072;
  /** Recursively copy only bounded inert JSON-like values without evaluating descriptors.
   * @param {unknown} input - Current untrusted response node.
   * @param {number} depth - Current traversal depth, capped at five.
   * @returns {any} Detached value; unsupported types, accessors, depth/nodes/bytes throw.
   */
  function clone(input: unknown, depth: number): any {
    if (++nodes > 128 || depth > 5) {
      throw passkeyDenied();
    }
    if (typeof input === 'string') {
      if (input.length > budget) {
        throw passkeyDenied();
      }
      budget -= Buffer.byteLength(input);
      if (budget < 0) {
        throw passkeyDenied();
      }
      return input;
    }
    if (
      input === null ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isFinite(input))
    ) {
      return input;
    }
    if (!input || typeof input !== 'object') {
      throw passkeyDenied();
    }
    if (Array.isArray(input)) {
      if (input.length > 32) {
        throw passkeyDenied();
      }
      return input.map((item) => clone(item, depth + 1));
    }
    /** Own property descriptors read as data; accessors/prototype keys are rejected before copying. */
    const descriptors = Object.getOwnPropertyDescriptors(input);
    /** Bounded descriptor inventory for one native WebAuthn response object. */
    const entries = Object.entries(descriptors);
    if (entries.length > 32) {
      throw passkeyDenied();
    }
    /** Detached bounded JSON response/options; no client-supplied code is evaluated. */
    const output: Record<string, unknown> = Object.create(null);
    // Copy only bounded own data descriptors; never invoke browser response accessors.
    for (const [name, descriptor] of entries) {
      if (
        !('value' in descriptor) ||
        name.length > 64 ||
        ['__proto__', 'constructor', 'prototype'].includes(name)
      ) {
        throw passkeyDenied();
      }
      output[name] = clone(descriptor.value, depth + 1);
    }
    return output;
  }
  /** Bounded inert response clone checked for public-key type, canonical fields and same-origin policy. */
  const copy = clone(value, 0);
  if (
    copy.type !== 'public-key' ||
    !passkeyBase64(copy.id, 1024) ||
    copy.rawId !== copy.id ||
    !copy.response ||
    typeof copy.response !== 'object' ||
    !passkeyBase64(copy.response.clientDataJSON, 8192)
  ) {
    throw passkeyDenied();
  }
  /** Parsed inert clientDataJSON; cross-origin/top-origin delegation is deliberately rejected. */
  const client = JSON.parse(
    Buffer.from(copy.response.clientDataJSON, 'base64url').toString('utf8')
  );
  // This narrow API supports same-origin ceremonies only, never embedded cross-origin delegation.
  if (
    !client ||
    (client.crossOrigin !== undefined && client.crossOrigin !== false) ||
    client.topOrigin !== undefined
  ) {
    throw passkeyDenied();
  }
  return copy;
}

/** Create account-first same-origin step-up using explicit host proof and atomic persistence. No HTTP routes, discovery, sessions or sockets start on construction.
 * @param {PasskeyManagerOptions} options - Explicit RP/origins, stable binding key, store, fresh authorization and finite budgets.
 * @returns {ReturnType<typeof createPasskeyManager>} Disposable manager owning only copied key bytes and active verifier work.
 */
export function createPasskeyManager(options: PasskeyManagerOptions) {
  if (
    !options ||
    options.store?.capability !== 'passkey-atomic-v1' ||
    typeof options.authorizeFresh !== 'function' ||
    !(options.bindingKey instanceof Uint8Array) ||
    options.bindingKey.length !== 32 ||
    !passkeyText(options.rpName) ||
    !Array.isArray(options.origins) ||
    options.origins.length < 1 ||
    options.origins.length > 8
  ) {
    throw passkeyDenied();
  }
  /** Borrowed atomic passkey persistence; this manager never closes it. */
  const store = options.store;
  /** Fresh host proof callback used for enrollment, removal and recovery enrollment. */
  const authorize = options.authorizeFresh;
  /** Explicit host-configured relying-party DNS identity; never inferred from request headers. */
  const rpId = options.rpId;
  /** Bounded host display name; not trusted HTML. */
  const rpName = options.rpName;
  validatePasskeyScope({ tenant: 'validation', account: 'validation', rpId });
  // Require every declared atomic store operation before creating a manager.
  for (const method of [
    'list',
    'putChallenge',
    'takeChallenge',
    'insert',
    'advance',
    'remove',
    'replaceRecovery',
    'recover',
  ] as const) {
    if (typeof store[method] !== 'function') {
      throw passkeyDenied();
    }
  }
  /** Exact configured same-RP origins; wildcard/forwarded origin trust is unavailable. */
  const origins = options.origins.map((value) => {
    /** Configured origin parsed before comparison with its canonical origin and RP policy. */
    const url = new URL(value);
    if (
      value !== url.origin ||
      url.username ||
      url.password ||
      (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) ||
      (url.protocol !== 'https:' &&
        !(rpId === 'localhost' && url.protocol === 'http:'))
    ) {
      throw passkeyDenied();
    }
    return url.origin;
  });
  /** Ceremony lifetime, default 120000ms and supported 1000–300000ms. */
  const ttl = options.challengeTtlMs ?? 120000;
  /** Actual-settlement operation cap, default 16 and supported 1–64. */
  const max = options.maxPending ?? 16;
  /** Trusted synchronized server clock or Date.now. */
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    ttl > 300000 ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 64 ||
    typeof now !== 'function'
  ) {
    throw passkeyDenied();
  }
  /** Owned binding-key copy used only for account/RP/domain HMACs; wiped after drain. */
  const key = Buffer.from(options.bindingKey);
  let closed = false;
  /** Actual verifier/store/authorization promises retained until settlement. */
  const pending = new Set<Promise<unknown>>();
  /** Read a safe trusted server timestamp for ceremony and recovery decisions.
   * @returns {number} Validated nonnegative UTC milliseconds. */
  const time = () => {
    /** Clock sample checked before expiry arithmetic. */
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8e15) {
      throw passkeyDenied();
    }
    return value;
  };
  /** Detach and validate account/session labels under the fixed RP.
   * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
   * @param {string} session - Bounded verified initiating server session.
   * @returns {Readonly<PasskeyScope>} Fixed verified-scope labels; validation alone does not authenticate them.
   */
  function context(account: AuthAccount, session: string) {
    /** Detached fixed account/tenant/RP context, validated before any storage call. */
    const scope = Object.freeze({
      tenant: account?.tenant,
      account: account?.account,
      rpId,
    });
    validatePasskeyScope(scope);
    if (!passkeyText(session)) {
      throw passkeyDenied();
    }
    return scope;
  }
  /** Bind stable handles/recovery digests to this configured RP and exact account.
   * @param {PasskeyScope} scope - Host-verified account/tenant/RP.
   * @param {string} domain - Internal purpose discriminator.
   * @param {string} value - Private recovery code when applicable, default empty.
   * @returns {string} Domain-separated keyed digest; not an authorization grant. */
  const hmac = (scope: PasskeyScope, domain: string, value = '') =>
    createHmac('sha256', key)
      .update(
        JSON.stringify([
          'zeruxjs.auth.passkey.v1',
          domain,
          scope.rpId,
          scope.tenant,
          scope.account,
          value,
        ])
      )
      .digest('base64url');
  /** Bound actual verifier/store calls and isolate private causes behind fixed errors.
   * @param {() => Promise<T>} fn - Explicit account-bound asynchronous operation.
   * @returns {Promise<T>} Actual result or denial/unavailable/capacity error; no automatic verification replay.
   */
  function run<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(new PasskeyError('PASSKEY_CLOSED'));
    }
    if (pending.size >= max) {
      return Promise.reject(new PasskeyError('PASSKEY_CAPACITY'));
    }
    /** Actual native/store work owning its admission slot until settlement. */
    const work = fn().catch((cause) => {
      if (cause instanceof PasskeyError) {
        throw cause;
      }
      throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause });
    });
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  }
  /** Read and validate current bounded credentials before native verification.
   * @param {PasskeyScope} scope - Exact verified RP/tenant/account.
   * @returns {Promise<PasskeyCredential[]>} Detached consistent account credentials; malformed store responses are unavailable.
   */
  async function credentials(scope: PasskeyScope) {
    /** Current bounded credential list validated before verifier use. */
    const result = await store.list(scope);
    if (!Array.isArray(result) || result.length > 32) {
      throw new PasskeyError('PASSKEY_UNAVAILABLE');
    }
    try {
      // Validate every stored public credential before passing it to native verification.
      for (const credential of result) {
        validatePasskeyCredential(credential);
      }
    } catch (cause) {
      throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause });
    }
    if (new Set(result.map((item) => item.id)).size !== result.length) {
      throw new PasskeyError('PASSKEY_UNAVAILABLE');
    }
    if (new Set(result.map((item) => item.userHandle)).size > 1) {
      throw new PasskeyError('PASSKEY_UNAVAILABLE');
    }
    return structuredClone(result);
  }
  /** Atomically consume a matching account/session/kind challenge before cryptographic work.
   * @param {PasskeyScope} scope - Exact verified RP/tenant/account.
   * @param {string} session - Bounded verified initiating server session.
   * @param {string} id - Opaque one-use ceremony ID.
   * @param {PasskeyChallenge['kind']} kind - Exact registration/authentication kind.
   * @returns {Promise<PasskeyChallenge>} Detached still-valid consumed ceremony; failures require a new one.
   */
  async function take(
    scope: PasskeyScope,
    session: string,
    id: string,
    kind: PasskeyChallenge['kind']
  ) {
    if (!passkeyBase64(id, 16, 16)) {
      throw passkeyDenied();
    }
    /** Trusted server time sampled before atomic challenge consumption. */
    const current = time();
    /** One-use account/session/kind-bound ceremony; consumed proof is never revived on verifier failure. */
    const challenge = await store.takeChallenge(
      scope,
      id,
      session,
      kind,
      current
    );
    if (
      !challenge ||
      challenge.id !== id ||
      challenge.kind !== kind ||
      challenge.session !== session ||
      !passkeyBase64(challenge.challenge, 32, 32) ||
      !passkeyBase64(challenge.userHandle, 64) ||
      !passkeyText(challenge.epoch) ||
      !Number.isSafeInteger(challenge.expiresAt) ||
      challenge.expiresAt <= current ||
      challenge.expiresAt - current > ttl
    ) {
      throw passkeyDenied();
    }
    return structuredClone(challenge);
  }
  /** Recheck server expiry after native verifier work but before committing success.
   * @param {PasskeyChallenge} challenge - Consumed ceremony with validated server expiry.
   * @returns {void} Expired ceremonies deny; already consumed proof stays consumed.
   */
  function notExpired(challenge: PasskeyChallenge) {
    if (time() >= challenge.expiresAt) {
      throw passkeyDenied();
    }
  }
  return {
    /** Require fresh independent enrollment proof before generating and storing one-use options.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {string} userName - Bounded host-owned inert account display label.
     * @returns {ReturnType<ReturnType<typeof createPasskeyManager>['beginRegistration']>} Private ceremony ID plus public client options; verifier remains optional until use.
     */
    beginRegistration(account: AuthAccount, session: string, userName: string) {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        if (
          !passkeyText(userName) ||
          (await authorize(scope, 'enroll', session)) !== true
        ) {
          throw passkeyDenied();
        }
        /** Current account credentials checked for count, IDs and consistent user handle. */
        const existing = await credentials(scope);
        /** Lazy optional maintained verifier module; construction/import does not load it automatically. */
        const lib = await backend();
        /** Existing persisted opaque user handle or stable keyed initial handle. */
        const userHandle =
          existing[0]?.userHandle ?? hmac(scope, 'user-handle');
        /** One-use account/session/kind-bound ceremony; consumed proof is never revived on verifier failure. */
        const challenge = randomBytes(32).toString('base64url');
        /** Detached bounded JSON response/options; no client-supplied code is evaluated. */
        const output: PasskeyRegistrationOptions =
          await lib.generateRegistrationOptions({
            rpName,
            rpID: rpId,
            userName,
            userID: new Uint8Array(Buffer.from(userHandle, 'base64url')),
            challenge: new Uint8Array(Buffer.from(challenge, 'base64url')),
            timeout: ttl,
            attestationType: 'none',
            supportedAlgorithmIDs: [-7, -257, -8],
            authenticatorSelection: {
              residentKey: 'preferred',
              userVerification: 'required',
            },
            excludeCredentials: existing.map((item) => ({ id: item.id })),
          });
        /** Fresh random one-attempt ceremony identifier. */
        const id = randomBytes(16).toString('base64url');
        await store.putChallenge(
          scope,
          {
            id,
            challenge,
            session,
            kind: 'registration',
            userHandle,
            expiresAt: time() + ttl,
          },
          time()
        );
        return { id, options: output };
      });
    },
    /** Reauthorize enrollment, consume ceremony, verify required UV/UP and commit credential under the unchanged epoch.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {string} id - Exact ceremony ID bound to this session.
     * @param {unknown} response - Untrusted bounded native credential JSON.
     * @returns {Promise<{credentialId: string}>} Credential ID only after atomic insertion; no application session is issued.
     */
    completeRegistration(
      account: AuthAccount,
      session: string,
      id: string,
      response: unknown
    ) {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        if ((await authorize(scope, 'enroll', session)) !== true) {
          throw passkeyDenied();
        }
        /** One-use account/session/kind-bound ceremony; consumed proof is never revived on verifier failure. */
        const challenge = await take(scope, session, id, 'registration');
        /** Lazy optional maintained verifier module; construction/import does not load it automatically. */
        const lib = await backend();
        let verified;
        try {
          /** Bounded inert native response, never executable source. */
          const parsed = responseObject(response);
          if (!passkeyBase64(parsed.response.attestationObject, 65536)) {
            throw passkeyDenied();
          }
          verified = await lib.verifyRegistrationResponse({
            response: parsed as Parameters<
              Library['verifyRegistrationResponse']
            >[0]['response'],
            expectedChallenge: challenge.challenge,
            expectedOrigin: origins,
            expectedRPID: rpId,
            requireUserPresence: true,
            requireUserVerification: true,
            supportedAlgorithmIDs: [-7, -257, -8],
          });
        } catch (cause) {
          throw new PasskeyError('PASSKEY_DENIED', { cause });
        }
        if (
          !verified.verified ||
          !verified.registrationInfo.userVerified ||
          verified.registrationInfo.fmt !== 'none'
        ) {
          throw passkeyDenied();
        }
        /** Verified registration metadata returned by the maintained verifier. */
        const info = verified.registrationInfo;
        /** Validated owned-account public credential; no private authenticator key is accepted/stored. */
        const credential: PasskeyCredential = {
          id: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey).toString(
            'base64url'
          ),
          counter: info.credential.counter,
          revision: randomBytes(24).toString('base64url'),
          userHandle: challenge.userHandle,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
        };
        validatePasskeyCredential(credential);
        notExpired(challenge);
        if ((await store.insert(scope, credential, challenge.epoch)) !== true) {
          throw passkeyDenied();
        }
        return { credentialId: credential.id };
      });
    },
    /** Create account-first step-up options for existing credentials, without usernameless discovery.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @returns {ReturnType<ReturnType<typeof createPasskeyManager>['beginAuthentication']>} Private ceremony ID and explicit allowed-credential client options.
     */
    beginAuthentication(account: AuthAccount, session: string) {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        /** Current account credentials checked for count, IDs and consistent user handle. */
        const existing = await credentials(scope);
        if (!existing.length) {
          throw passkeyDenied();
        }
        /** Lazy optional maintained verifier module; construction/import does not load it automatically. */
        const lib = await backend();
        /** One-use account/session/kind-bound ceremony; consumed proof is never revived on verifier failure. */
        const challenge = randomBytes(32).toString('base64url');
        /** Detached bounded JSON response/options; no client-supplied code is evaluated. */
        const output: PasskeyAuthenticationOptions =
          await lib.generateAuthenticationOptions({
            rpID: rpId,
            challenge: new Uint8Array(Buffer.from(challenge, 'base64url')),
            timeout: ttl,
            userVerification: 'required',
            allowCredentials: existing.map((item) => ({ id: item.id })),
          });
        /** Fresh random one-attempt ceremony identifier. */
        const id = randomBytes(16).toString('base64url');
        /** Existing credential candidate checked before creating a new record. */
        const existingCredential = existing[0];
        if (!existingCredential) {
          throw new Error('Passkey authentication credential is missing');
        }
        await store.putChallenge(
          scope,
          {
            id,
            challenge,
            session,
            kind: 'authentication',
            userHandle: existingCredential.userHandle,
            expiresAt: time() + ttl,
          },
          time()
        );
        return { id, options: output };
      });
    },
    /** Consume the ceremony, verify the account credential and CAS counter/revision/epoch before returning server proof.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {string} id - Exact account/session ceremony ID.
     * @param {unknown} response - Untrusted native assertion JSON.
     * @returns {Promise<PasskeyIdentity>} Verified server result, not a bearer token or automatic permission grant.
     */
    completeAuthentication(
      account: AuthAccount,
      session: string,
      id: string,
      response: unknown
    ): Promise<PasskeyIdentity> {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        /** One-use account/session/kind-bound ceremony; consumed proof is never revived on verifier failure. */
        const challenge = await take(scope, session, id, 'authentication');
        /** Lazy optional maintained verifier module; construction/import does not load it automatically. */
        const lib = await backend();
        /** Current account credentials checked for count, IDs and consistent user handle. */
        const existing = await credentials(scope);
        let parsed;
        try {
          parsed = responseObject(response);
        } catch (cause) {
          throw new PasskeyError('PASSKEY_DENIED', { cause });
        }
        /** Validated owned-account public credential; no private authenticator key is accepted/stored. */
        const credential = existing.find((item) => item.id === parsed.id);
        if (
          !credential ||
          credential.userHandle !== challenge.userHandle ||
          (parsed.response.userHandle !== null &&
            parsed.response.userHandle !== undefined &&
            parsed.response.userHandle !== credential.userHandle) ||
          !passkeyBase64(parsed.response.authenticatorData, 4096) ||
          !passkeyBase64(parsed.response.signature, 4096)
        ) {
          throw passkeyDenied();
        }
        let verified;
        try {
          verified = await lib.verifyAuthenticationResponse({
            response: parsed as Parameters<
              Library['verifyAuthenticationResponse']
            >[0]['response'],
            expectedChallenge: challenge.challenge,
            expectedOrigin: origins,
            expectedRPID: rpId,
            credential: {
              id: credential.id,
              publicKey: new Uint8Array(
                Buffer.from(credential.publicKey, 'base64url')
              ),
              counter: credential.counter,
            },
            requireUserVerification: true,
          });
        } catch (cause) {
          throw new PasskeyError('PASSKEY_DENIED', { cause });
        }
        notExpired(challenge);
        if (
          !verified.verified ||
          !verified.authenticationInfo.userVerified ||
          verified.authenticationInfo.credentialDeviceType !==
            credential.deviceType ||
          (await store.advance(
            scope,
            credential.id,
            credential.revision,
            verified.authenticationInfo.newCounter,
            challenge.epoch,
            verified.authenticationInfo.credentialBackedUp
          )) !== true
        ) {
          throw passkeyDenied();
        }
        return {
          tenant: scope.tenant,
          account: scope.account,
          method: 'webauthn',
          verifiedAt: time(),
          credentialId: credential.id,
        };
      });
    },
    /** Require recent independent proof before removing a credential and fencing pending ceremonies.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {string} credentialId - Exact enrolled credential ID.
     * @returns {Promise<boolean>} Whether the store removed it; host must preserve another recovery/login route.
     */
    removeCredential(
      account: AuthAccount,
      session: string,
      credentialId: string
    ) {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        if (
          !passkeyBase64(credentialId, 1024) ||
          (await authorize(scope, 'remove', session)) !== true
        ) {
          throw passkeyDenied();
        }
        return (await store.remove(scope, credentialId)) === true;
      });
    },
    /** Require fresh proof before replacing private recovery digests; plaintext is returned once.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {number} lifetimeMs - Explicit finite lifetime, one second through 30 days.
     * @returns {Promise<string[]>} Eight private codes; store them offline and never log them.
     */
    createRecoveryCodes(
      account: AuthAccount,
      session: string,
      lifetimeMs: number
    ) {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        if (
          !Number.isSafeInteger(lifetimeMs) ||
          lifetimeMs < 1000 ||
          lifetimeMs > 30 * 86400000 ||
          (await authorize(scope, 'recovery-enroll', session)) !== true
        ) {
          throw passkeyDenied();
        }
        /** Eight fresh private 192-bit recovery codes returned once after digest-set persistence. */
        const codes = Array.from({ length: 8 }, () =>
          randomBytes(24).toString('base64url')
        );
        await store.replaceRecovery(
          scope,
          codes.map((code) => hmac(scope, 'recovery', code)),
          time() + lifetimeMs
        );
        return codes;
      });
    },
    /** Atomically consume one recovery digest, revoke all credentials/codes/challenges and fence in-flight verifiers.
     * @param {AuthAccount} account - Host-authenticated tenant/account context, not a browser-submitted identity.
     * @param {string} session - Bounded verified initiating server session.
     * @param {string} code - Private exact recovery proof.
     * @returns {Promise<PasskeyIdentity>} Server recovery proof; application session revocation/enrollment remain explicit host operations.
     */
    recover(
      account: AuthAccount,
      session: string,
      code: string
    ): Promise<PasskeyIdentity> {
      return run(async () => {
        /** Detached fixed account/tenant/RP context, validated before any storage call. */
        const scope = context(account, session);
        if (
          !passkeyBase64(code, 24, 24) ||
          (await store.recover(
            scope,
            hmac(scope, 'recovery', code),
            time()
          )) !== true
        ) {
          throw passkeyDenied();
        }
        return {
          tenant: scope.tenant,
          account: scope.account,
          method: 'recovery',
          verifiedAt: time(),
        };
      });
    },
    /** Stop admission, drain actual verifier/store work and wipe the owned HMAC copy.
     * @returns {Promise<void>} Borrowed persistence stays open; native/hardware browser acceptance is not inferred.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      key.fill(0);
    },
  };
}
