# @zeruxjs/auth

Server-side password hashing, encrypted sessions, user/role database facade, one-time passwords, RFC 6238 authenticator TOTP, scoped API/reset tokens, password policy, and optional revocation store.

Existing `hashPassword`, `verifyPassword`, `createSession`, `verifySession`, database helpers, `createOtp` and passkey challenge _generation_ remain supported. Passkey challenge creation does **not** validate WebAuthn attestation/assertions; use the opt-in `createPasskeyManager` verifier described below. OTP code hashes alone do not enforce expiry or one-time use: use a dedicated persisted challenge record with attempt limits.

```ts
import { generateTotpSecret, generateTotp, totpUri, verifyTotp, createTokenStore, validatePasswordStrength } from '@zeruxjs/auth';
const secret = generateTotpSecret(); // encrypt at rest; never log
const uri = totpUri(secret, 'alice@example.com', 'Your App');
const matches = verifyTotp(generateTotp(secret), secret, { window: 1 }); // local round-trip only
const assessment = validatePasswordStrength('example long password');
const apiKeys = createTokenStore();
const { token } = apiKeys.issue('user-id', ['read:posts'], 3600_000);
const identity = apiKeys.verify(token, 'read:posts');
apiKeys.clear(); // explicit teardown of this process-local example
```

For production sessions set `SECURITY_SESSION_KEY`, `SECURITY_SESSION_SALT` and `SECURITY_PASSWORD_SALT` securely; rotate with planned migration. Built-in token and revocation registries are in-memory and must be replaced with persistent shared stores for distributed deployments. Provide request rate limiting and brute-force protection at the application edge. Do not confuse TOTP validation with replay protection; store and reject already-used time steps.

OAuth authorization-code PKCE helper: `createOAuthAuthorization({authorizationEndpoint, clientId, redirectUri, allowedRedirectUris, scopes})` returns URL, state and verifier. Store the state/verifier per login session server-side and validate state with `verifyOAuthState`; never expose verifier in browser logs or URLs. This helper does not perform token exchange or provider-specific ID token verification.

## Tenant/role authorization

`hasTenantPermission(principal,{tenantId,permission,siteId?})` and `requireTenantPermission(...)` require exact tenant ID and explicit permission and, when specified, allowlisted site ID. No implicit administrator or wildcard access is granted. These helpers require a previously authenticated, validated principal supplied by the host. Table/column config mappings and session config values now fail closed on invalid input. Organization ID `0` is a valid and enforced role scope. For MySQL user inserts set `setAuthConfig({db:{supportsReturning:false}})` to use `insertedIds`; by default the PostgreSQL/SQLite-compatible RETURNING request is retained. In-memory token/session stores remain unsuitable for distributed revocation without a shared backend.

## Shared sessions and one-use challenges

`createSharedAuth` is an opt-in asynchronous API. It does not change `createSession`, `verifySession`, `createTokenStore`, `createOtp` or `verifyTotp`. Those compatibility helpers do not acquire distributed revocation/replay protection. Legacy encrypted sessions cannot be passed to the new opaque-session verifier; migrate by requiring a fresh login. Password hashing remains Node scrypt; password policy checks remain explicit before registration/change. No provider, connection, cookie or telemetry starts on import.

Minimal isolated example using public imports (ephemeral keys and memory are for this example only):

```ts
import { randomBytes } from 'node:crypto';
import { createMemoryAuthPersistence, createSharedAuth } from '@zeruxjs/auth';

const store = createMemoryAuthPersistence(); // process-local, NOT distributed
const auth = createSharedAuth({
  store,
  indexKey: randomBytes(32),
  keys: [{ id: 'v1', key: randomBytes(32) }],
  activeKeyId: 'v1',
  authorizeFresh: async () => false, // supply a real recent-authentication check for management
});
const account = { tenant: 'example', account: 'user-1' }; // host-verified identity
try {
  const issued = await auth.issueSession(account, {
    device: 'laptop', scopes: ['posts:read'], ttlMs: 3_600_000,
  });
  const session = await auth.verifySession(account, issued.token, 'posts:read');
  if (!session) throw new Error('Authentication failed');
} finally {
  await auth.close(); // drains outstanding calls and wipes owned key copies
  store.clear(); // store ownership stays with the host
}
```

For multiple instances, implement the public `AuthPersistence` contract: `capability: 'auth-cas-v1'`, current `read(key)`, and **linearizable** `compareAndSwap(key, revision|null, value, expiresAt)`. Null means create only if absent/expired. Return true only for an exact successful write; false means contention. Revisions must never be reused, including after expiry/deletion. Persist the value and expiry atomically; keep each key tenant/account isolated. Use a pinned database transaction or exact revision-checked affected count, never ordinary cache get/set. Implement bounded acquisition/query deadlines in the adapter; a failed/unknown write outcome must remain an error, not a successful credential issuance. This package ships the bounded memory reference adapter, not a production database/Redis persistence adapter. The focused fixture exercises independent SQLite connections through `@zeruxjs/db-sqlite` and real CAS zero-row misses; it is not a portable adapter certification.

The manager retries pure state transitions at most eight times on CAS conflicts; it never retries external callbacks. At most 32 operations are pending by default (`maxPending`: 1–256). No promise timeout claims to cancel a database operation. `close()` stops admission and waits for native persistence/authorization calls to settle; an uncooperative adapter can delay shutdown. It never closes a borrowed store. The memory adapter defaults to 1,000 accounts (`maxAccounts`: 1–100,000), prunes expired accounts and rejects capacity overflow. It has no eviction that could silently restore a consumed credential.

### Policies and limits

- Sessions: opaque 256-bit bearer secrets, random per-session IDs, expiry up to 30 days, at most 64 active sessions/account. `verifySession` checks exact optional scope and returns null for missing/expired/invalid credentials. Scope lists have at most 32 entries; no wildcard expansion. Returned metadata is cloned. Device labels are bounded host-assigned labels, not raw user-agent/IP history.
- Challenges: `issueChallenge(account,{purpose,ttlMs,maxAttempts?})` supports `reset`, `otp`, `magic`, up to 32 outstanding/account. Lifetime is explicitly required and capped at 15 minutes; attempts default to five (1–10). OTP secrets are uniform six-digit values, other secrets are random 256-bit values. Deliver `id` and `secret` privately; `consumeChallenge(account,{purpose,id,secret})` atomically verifies and consumes, increments failed attempts and removes exhausted records. Wrong account, purpose, expiry, replay or invalid secret returns false. `revokeChallenges(account,purpose?)` explicitly invalidates one purpose or all outstanding challenges after fresh authorization.
- TOTP: `consumeTotp(account,credentialId,code,secret,{period?,digits?,algorithm?,window?})` adds an atomic highest-accepted-step guard to the existing RFC 6238 generator. It accepts only SHA-1/256/512, six/eight digits, periods 10–300 seconds and window 0–5. At most 16 credentials/account; a code for an accepted/older step is denied even on another instance. The stable credential ID and parameters must come from the host's enrolled credential, not the request. Secrets stay host-owned and must be encrypted at rest separately. Replay state is retained at least one hour after the last state write (longer while sessions/challenges survive), exceeding the maximum allowed TOTP window. All replicas need synchronized nondecreasing wall clocks; do not reuse retired credential IDs with different secrets/parameters.
- `inventory(account)`, `revoke(account,id?)`, `rotateSession(account,token,scopes)` and `revokeChallenges` require the configured `authorizeFresh` callback to return exactly true for the account/action. Inventory uses action `revoke-one`. The host must check recent independent authentication, same-account/tenant management permissions and any requested new scopes. `revoke` without an ID invalidates all sessions; challenge revocation is separate. Rotation atomically replaces the old ID, preserving its remaining expiry/device and applying host-approved exact scopes. Invoke rotation on privilege changes and revoke other sessions when policy requires. Recheck authorization for sensitive work: revocation cannot undo requests already admitted.
- A successful challenge consume grants only the named purpose for that account. It does not change a password, grant arbitrary scopes, send email or create a session. Coordinate password updates/revocation with your durable workflow. A downstream failure after consumption requires a new challenge; it never revives the original token.

### Keys, HTTP and diagnostics

Use a stable, separate 32-byte `indexKey` on all instances to HMAC tenant/account tuples into store keys. Changing it abandons existing state and invalidates sessions/replay history; do not rotate it during active TOTP enrollment without a coordinated migration. The rotating `keys` list contains 1–8 distinct IDs with 32-byte HMAC keys. All new records use `activeKeyId`; retained keys verify old records. Distribute the new key to every verifier before switching issuers, then remove old keys after the longest record lifetime (or explicitly invalidate early). Do not reuse key IDs with changed material. No encryption key/material is returned in sessions or inventory. Storage contains keyed SHA-256 digests, never bearer/OTP plaintext; public session results omit digest/key ID. Indexing, token verification and encrypted TOTP storage are separate policies.

`authSessionCookie(token,maxAgeSeconds)` emits a host-only `__Host-session` cookie with `Path=/; Secure; HttpOnly; SameSite=Strict` and no Domain. `readAuthSessionCookie(header,name?)` rejects duplicate selected cookies, oversized/control-bearing headers, encoded and malformed tokens. HTTPS is required. These helpers only handle the new opaque sessions. Enforce configured origin/CSRF checks on cookie-authenticated writes and endpoint-specific distributed rate limits before login/recovery/TOTP attempts; neither SameSite nor per-challenge attempts replaces those controls. Never derive account/tenant identity or management scopes directly from unverified request fields/forwarded headers. Return the same generic login/recovery response for unknown and known accounts; avoid exposing inventory, issuance, failure reasons or timing as an enumeration API.

`AuthStateError` exposes fixed `AUTH_INVALID`, `AUTH_UNAVAILABLE`, `AUTH_CAPACITY`, `AUTH_CLOSED` codes. Keep causes in trusted redacted logs only; never serialize a cause, cookie, code, secret or raw persistence record to clients. No global event handlers are installed.

Policies follow [RFC 6238 replay guidance](https://www.rfc-editor.org/rfc/rfc6238.html) and [OWASP session renewal guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); these primitives are not a complete authentication server or WebAuthn/OAuth verifier.

## WebAuthn and step-up identity

`createPasskeyManager` performs registration and assertion verification with **SimpleWebAuthn server 14.0.3**, installed as a lazy optional dependency. Core auth imports and declarations work with `npm install --omit=optional`; configured WebAuthn use then fails with `PASSKEY_UNAVAILABLE`. The verifier documentation targets Node LTS 22+; these checks ran on Node 24. No browser, provider request, metadata download or background worker is started by this package. Install the optional dependency before building this package from source.

The old `createPasskeyChallenge` remains a challenge-only compatibility helper. Its output is not a persisted ceremony for the new verifier. Use the complete flow below instead. The manager supports **account-first, same-origin step-up**, requires both user presence and user verification, requests `attestation: 'none'`, and accepts only none-format registration with ES256 (-7), RS256 (-257) or EdDSA (-8). It does not certify hardware provenance, implement enterprise attestation, accept cross-origin iframes or provide usernameless discovery. Algorithm cryptography belongs to the maintained verifier/runtime; the focused cryptographic fixture exercises ES256, not every device/algorithm combination.

Minimal public-import integration (host-provided functions are deliberately required):

```ts
import { createPasskeyManager, type PasskeyManagerOptions } from '@zeruxjs/auth';

export function configurePasskeys(options: PasskeyManagerOptions) {
  const passkeys = createPasskeyManager(options);
  return {
    // account/session come from verified server context; userName is a bounded display label
    begin: passkeys.beginRegistration,
    finish: passkeys.completeRegistration,
    beginStepUp: passkeys.beginAuthentication,
    finishStepUp: passkeys.completeAuthentication,
    close: () => passkeys.close(),
  };
}
```

Configure one application-owned manager with an explicit DNS `rpId`, display `rpName`, exact `origins` (1–8), stable 32-byte `bindingKey`, `store`, and `authorizeFresh`. Origins must be HTTPS origins under that RP ID; only `http://localhost[:port]` is accepted for local development with RP ID `localhost`. There are no wildcards, inferred forwarded origins or caller-selected RP IDs. Keep the binding key outside credential storage and stable across instances/restarts; changing it invalidates recovery-code digests and changes handles for accounts without existing credentials. Existing credentials retain their persisted opaque user handle.

`beginRegistration(account,session,userName)` returns `{id,options}`; privately bind the returned ID to this server session. Send `options` to a WebAuthn client (base64url fields require conversion for native `navigator.credentials`, or use a compatible browser library). Submit the credential JSON and ceremony ID to `completeRegistration(account,session,id,response)`. Successful completion returns the credential ID only after atomic insertion. `beginAuthentication`/`completeAuthentication` follow the same pattern; successful assertion returns `{tenant,account,method:'webauthn',verifiedAt,credentialId}` only after the counter/revision update commits. Check credential ownership and optional returned userHandle against the persisted account. A returned server identity object is **not a bearer token**: never trust a client-submitted copy as recent proof or permission. The host decides how to record fresh proof and rotate/invalidate sessions using the shared-auth APIs.

### Shared credential persistence and replay policy

`PasskeyStore` is a separate auth-owned `passkey-atomic-v1` contract because `AuthPersistence` does not contain WebAuthn credentials. Do not add these fields to shared-auth records. Implement current reads and atomic operations exactly as documented in its declaration:

- Persist credential public key (base64url COSE bytes), stable user handle, counter, opaque nonreused revision, device type and backup flag. Enforce **RP-wide credential-ID uniqueness across accounts and tenants**. Cap credentials at 32/account and live challenges at eight/account. Credentials/replay revisions must survive restarts; never silently evict them.
- Bind each challenge to tenant, account, RP, server session, ceremony kind and an account epoch. Challenge lifetime defaults to 120 seconds (`challengeTtlMs`: 1–300 seconds). Atomically take it **before verification**, allowing one attempt only; failures burn it. Wrong session/account cannot take it. A backend failure after consumption requires a new ceremony. Recheck expiry before storing success.
- Incrementing counters must strictly increase. Zero-to-zero counters are allowed for authenticators that do not maintain a counter (including synced passkeys), but every assertion still requires a new challenge and successful revision CAS, even at zero. Concurrent stale revisions fail closed; the host may retry with a new ceremony. Counters alone do not prove clone detection for synced passkeys.
- Recovery atomically consumes its digest, removes **all** credentials, pending challenges and the full recovery-code set, and rotates the epoch. Registration/assertion persistence requires the unchanged epoch, fencing already-running verifiers. Removing a credential also fences pending ceremonies. Ordinary cache get/set or separate consume/delete writes do not satisfy this contract.

`createMemoryPasskeyStore({maxAccounts?})` is a process-local bounded reference (default 1,000; maximum 10,000 accounts), not a production distributed adapter. It never evicts enrolled credentials. Its `clear()` destroys replay/identity state and is for test/owned teardown only. A production store needs its own capacity, retention, encryption, deadlines, backup and atomicity acceptance checks. The host owns its connection; manager close does not close it.

### Enrollment, recovery and HTTP boundaries

`authorizeFresh(account,action,session)` must return exactly true after **recent independent authentication** for that tenant/account. Actions are `enroll`, `remove`, `recovery-enroll`. Enrollment checks this before options and again at completion. `removeCredential` and `createRecoveryCodes` require it too. This package does not infer proof from a cookie, response object or forwarded header. Initial enrollment needs an existing independently verified route (for example a password plus enrolled second factor); do not authorize initial enrollment merely because the submitted account exists.

`createRecoveryCodes(account,session,lifetimeMs)` replaces the set with eight random 192-bit codes, returned once. Explicit lifetime is 1 second–30 days. Only purpose/account/RP-bound HMAC-SHA-256 digests are stored. Store codes privately offline; never log them or expose the stored digests. `recover(account,session,code)` returns method `recovery` after atomic lost-device revocation. **Using one code invalidates the entire set**, so later generate a new set after recent proof. Recovery intentionally sacrifices availability of the other codes to fence a lost device. It does not automatically revoke application sessions: record the verified recovery proof server-side, revoke shared sessions using fresh authorization, then permit replacement enrollment under host policy. Invalid/expired/reused recovery codes have the same generic denial. Backend uncertainty is not successful recovery.

All calls require host-verified account/tenant and a bounded server session identifier, not a raw user-supplied account assertion. Enforce origin/CSRF checks and distributed admission for enrollment, assertions and recovery before invoking the manager. No login/discovery HTTP routes are installed. Avoid account enumeration when translating denials to client responses. Request bodies must be bounded before JSON parsing; direct response processing additionally bounds bytes (128 KiB), structure depth/nodes, client data, attestation and signature lengths. At most 16 operations run per manager by default (`maxPending`: 1–64). `close()` stops admission, drains native verifier/store calls and wipes owned HMAC bytes, without claiming to forcibly cancel an uncooperative promise.

`PasskeyError` exposes fixed `PASSKEY_DENIED`, `PASSKEY_UNAVAILABLE`, `PASSKEY_CAPACITY`, `PASSKEY_CLOSED` messages/codes. Verifier/store causes may contain private ceremony details: keep them in trusted redacted logs, never client JSON. No raw responses, codes or keys are emitted through event hooks.

### Other step-up adapters

`ClientCertificateIdentityAdapter<TrustedTlsContext>` and `EnterpriseSsoIdentityAdapter<AssertionInput>` are **separate injected contracts**, not configured authentication providers. Adapters own verification, bounded deadlines/signals and optional disposal. Certificate identity requires a verified TLS peer certificate and host trust roots, or a mutually authenticated trusted gateway with authenticated, request-bound assertions. An arbitrary forwarded certificate header, `authorized` field or certificate-shaped JSON is never authenticated evidence. SSO adapters must validate their actual protocol's signed issuer/audience, state/nonce, expiry and replay properties; OAuth profile data alone is not an identity assertion. Neither adapter auto-links accounts or bypasses tenant permissions. No concrete certificate/SSO adapter is shipped here. The earlier “TWT” note means JWT; the JOSE-based JWT API belongs to `@zeruxjs/security/jwt`, not a new token protocol.

Verification follows [SimpleWebAuthn's server API](https://simplewebauthn.dev/docs/packages/server) and [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/). Software-credential tests exercise real cryptography and hostile inputs; they are not hardware-authenticator or live-browser acceptance. A functioning browser/authenticator, HTTPS RP and production atomic store remain deployment prerequisites.

## Explicit OAuth/OIDC provider login

`createProviderLogin` completes authorization-code + S256 PKCE beyond the legacy URL helper. It accepts an explicit immutable `providers` list, a `provider-login-atomic-v1` store, stable 32-byte `bindingKey`, mandatory host-owned `transport`, and `authorizeFresh`. No endpoints are discovered/scanned, providers registered globally, HTTP routes installed, network opened or account linked on import. OIDC lazily uses the optional internal `@zeruxjs/security/jwt` integration (maintained JOSE); install it when deploying OIDC. Core auth declarations/imports work with optional dependencies omitted. There is no separate “TWT” protocol: that note meant JWT.

```ts
import { createProviderLogin, type ProviderLoginOptions } from '@zeruxjs/auth';

export async function startProviderLogin(options: ProviderLoginOptions) {
  const login = createProviderLogin(options); // production supplies durable atomic store, secrets and egress transport
  try {
    return await login.begin('example', { tenant: 'tenant-1', session: 'host-verified-session' },
      'https://app.example/callback');
  } finally { await login.close(); } // close after all flows when retaining one application-owned manager
}
```

Every `LoginProvider` declares `id`, `profile`, `protocol`, `label`, exact `issuer`, authorization/token/user-info endpoints, exact HTTPS `allowedUrls`, redirect URI allowlist, scopes, client ID and token authentication (`none`, `client_secret_post`, `client_secret_basic`). Secrets are required only for the declared confidential method, never embedded in URLs. Configuration has at most 16 providers, eight outbound/redirect URLs and 32 scopes/provider. Redirects must be HTTPS (HTTP only for localhost/127.0.0.1 development), with no credentials/query/fragment. Outbound endpoints require HTTPS, no credentials/query/fragment and exact host approval; redirects and changed response destinations are rejected. The transport receives `credentials:'omit'`, `redirect:'error'` and explicit signals. **It must enforce DNS/IP/egress and TLS policy**; string allowlists alone cannot prevent DNS rebinding. The host validates tenant/session and HTTP CSRF/origin/admission before calling these APIs.

`begin(providerId,context,redirectUri,linkAccount?)` returns the authorization URL and expiry; it does not return the PKCE verifier. The URL contains random state plus S256 challenge, and an OIDC nonce where applicable. Persisted attempts are bound to tenant, provider and an HMAC of the server session; state/code lookup keys are HMAC digests. The PKCE verifier must remain private and encrypted by a production store. Attempts expire after five minutes. Deliver the URL only through your controlled redirect flow; never log its state or codes.

Pass **query** `URLSearchParams` from the registered callback to `complete(providerId,context,parameters,{signal?,deadline?})`. Duplicate state/code/issuer/error parameters, mismatched session/tenant/provider, authorization errors and invalid issuer are denied. `requireAuthorizationIssuer:true` requires an exact callback `iss`; whenever supplied it must match even if optional. The attempt is atomically consumed before exchange, then a provider-bound code digest is claimed for ten minutes to prevent reuse with another state. A failed/unknown exchange requires a new login; no token request is automatically retried. State and nonce are independent, one-use and session bound.

The token exchange sends code, verifier, redirect and the declared client authentication over the approved transport. Responses/readers are bounded/cancelled, redirects forbidden and body JSON validated. Only Bearer access tokens are accepted. Access/refresh/ID tokens remain internal, are not returned or persisted by this API, and must never be logged by your transport. `complete` returns `{identity,linked}` with stable provider/issuer/subject and sanitized mapped profile fields. It creates no user/session or role/permission grant. Resolve accounts by the verified tenant/provider/issuer/subject binding, never email/username or a client-submitted copy of the result.

OIDC requires an explicit `jwksUrl`, allowlisted asymmetric `algorithms` (default RS256), openid scope, exp/iat/sub/nonce, exact issuer/client audience, bounded 30-second skew and maximum five-minute issuance age. Signature/JWK/key-rotation checks use the shared JWT verifier/cache. Expected `typ` defaults to JWT with absence allowed per OIDC; `idTokenType:{value,required}` can require it. A present wrong type fails. Additional audiences are deliberately rejected, and a present `azp` must equal the client. Nonce must equal the consumed attempt. Present `at_hash`/`c_hash` are checked with the registered SHA-256/384/512 JWS profile; EdDSA tokens containing those hash claims are deliberately unavailable in this wrapper. Optional `loadUserInfo` additionally requires user-info `sub` to equal the verified ID-token subject. User-info is never an alternative to OIDC verification.

### Declared provider profiles

No entry installs a vendor's endpoints or scopes automatically. Register them from current official metadata/docs and your actual application enrollment:

| Profile     | Protocol and identity mapping                                                                                                | Email behavior                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `google`    | OIDC `sub`; exact configured issuer/client                                                                                   | Only `email_verified:true` retains email                                       |
| `microsoft` | Tenant-specific OIDC `sub`; configure exact issuer and approved tenant endpoints, not an unrestricted common-tenant wildcard | email/preferred_username is not treated as verified identity                   |
| `github`    | OAuth code + `/user` numeric stable `id`; user-info identity is explicitly `protocol:'oauth2'`                               | `/user` does not prove email verification, so email is omitted                 |
| `discord`   | OAuth code + `/users/@me` string ID; explicitly declare identify/email scopes and callback issuer policy                     | `verified:true` is required to retain email                                    |
| `custom`    | Explicit protocol and trusted `mapProfile` callback; an OIDC mapping cannot change the verified `sub`                        | Host must establish actual verification semantics; unverified email is omitted |

`profiles()` exposes only id/label/protocol/profile display metadata, with no client secrets/endpoints/tokens. Display names are text, not safe HTML. No email—even verified email—auto-links an account. Passing `linkAccount` requires `authorizeFresh(account,'link',session)` before authorization **and again on callback**; the shared store atomically enforces a unique owner for tenant/provider/issuer/subject. `unlink(account,session,providerId,subject)` also requires fresh proof and removes only that account's binding. The host must preserve another login/recovery route and current tenant permissions. No linked identity is a wildcard administrator.

Separate `providerProtocolInformation` metadata records reviewed LinkedIn OIDC and X OAuth2-PKCE documentation, but neither has a dedicated built-in profile. They require explicit custom configuration/mapping and their actual application approvals. Facebook remains unverified and has no implemented profile: its primary manual-flow page was unavailable during this verification. Do not infer ID-token behavior across these providers. This package does not implement SAML, OAuth 1.0a, implicit/device/refresh grants, JWE ID tokens, private-key-JWT client authentication, dynamic discovery or full vendor parity.

### Persistence, bounds and cleanup

`ProviderLoginStore` requires linearizable attempt consumption and code claim, durable expiry, unique identity ownership and fresh reads. Never emulate it with ordinary cache get/set. `createMemoryProviderLoginStore` is a process-local reference with default 1,000 live attempts and 1,000 retained code claims (`maxEntries`, maximum 10,000 each), plus 10,000 links (`maxLinks`, maximum 100,000). Expired transient records are pruned; links are never silently evicted. Clear only during owned test teardown. This task supplies the shared contract/reference, not a certified production database adapter.

The manager defaults to 32 pending operations (maximum 128), five-second operation deadlines (maximum 30 seconds), 64 KiB JSON responses (maximum 256 KiB), five-minute attempts and ten-minute code-replay retention. Callback query input is bounded to 16 fields/8 KiB. JWKS cache defaults to 60 seconds (maximum 10 minutes) and cooldown one second (maximum one minute); each source coalesces bounded refreshes. A newly rotated unknown kid during cooldown can fail closed. Custom claim mapping and authorization callbacks are trusted code and must not block.

Deadlines/cancellation reject the caller but retain native slots until store/transport/verification settlement. The signal is checked before later exchange/link/unlink work; an already-running storage write can have an unknown outcome. No transparent replay or memory fallback occurs. `await login.close()` aborts cooperative work, drains pending operations and owned JWT/JWKS instances, and releases key/config references. It leaves borrowed persistence/transport ownership with the host and may wait for uncooperative dependencies.

`ProviderLoginError` exposes only `LOGIN_DENIED`, `LOGIN_UNAVAILABLE`, `LOGIN_CAPACITY`, `LOGIN_CLOSED`. Causes can contain private provider details; keep them in trusted redacted diagnostics, never client JSON. Use uniform login/recovery client responses to avoid account enumeration.

Primary references reviewed: [OIDC Core validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [Google](https://developers.google.com/identity/openid-connect/openid-connect), [Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Discord](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx), [LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2), [X](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code). Isolated fixtures exercise real JWT cryptography and scripted HTTP, not live provider acceptance. Live registration, credentials, consent, HTTPS callbacks, production egress policy and atomic storage remain prerequisites.

## Source ownership and compatibility boundaries

| Owner                                                            | Responsibility and limit                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.ts`                                                        | Process-global legacy mappings, scrypt compatibility, encrypted sessions and database helpers. Never change global mappings per concurrent tenant request. `verifyUser` returns a private raw row that can include hashes; sanitize before any client output. Metadata lookup/update/insert is not an atomic upsert. |
| `password-policy.ts`, `totp.ts`, `oauth.ts`                      | Explicit policy assessment, code calculation/validation and PKCE URL/state helpers. None persists enrollment, consumes proof or performs token exchange. Enrollment URIs contain private secrets.                                                                                                                    |
| `token-store.ts`, `session-store.ts`                             | Bounded process-local compatibility registries. Legacy token/role wildcard semantics are preserved; exact tenant/shared scopes remain separate.                                                                                                                                                                      |
| `tenant-authorization.ts`, `step-up.ts`                          | Exact claim checks and explicit injected verification contracts; labels alone never authenticate a request.                                                                                                                                                                                                          |
| `shared-auth.ts`                                                 | Linearizable opaque sessions/challenges/TOTP replay state over a borrowed primary, finite pure CAS retries and key-copy cleanup after drain.                                                                                                                                                                         |
| `passkey-store.ts`, `passkeys.ts`                                | Atomic ceremony/credential/recovery contracts and lazy maintained verification. Consumed ceremonies never revive after errors; zero counters still require a fresh revision CAS.                                                                                                                                     |
| `provider-store.ts`, `provider-profiles.ts`, `provider-login.ts` | Explicit bounded provider flow, atomic replay/identity ownership, declared mappings and owned optional JWT/JWKS cleanup. No live endpoint discovery or automatic email account linking.                                                                                                                              |

The three application managers (`createSharedAuth`, `createPasskeyManager`, `createProviderLogin`) must be closed before their borrowed stores/transports are released. Their close operations drain actual work before wiping owned key copies; cancellation or timeout cannot forcibly terminate arbitrary host code. Local memory/token/revocation helpers expose no close handle. Existing public root exports and legacy crypto wire formats remain compatible; this source map adds no browser runtime entry or authentication route.
