---
{
  "title": "Authentication and authorization",
  "description": "Combine password/session primitives with application-owned identity and storage.",
  "section": "Packages",
  "order": 9,
  "sources": [
    "packages/@zeruxjs/auth/README.md",
    "packages/@zeruxjs/auth/package.json",
    "packages/@zeruxjs/auth/src/core.ts",
    "packages/@zeruxjs/auth/src/shared-auth.ts",
    "packages/@zeruxjs/auth/src/passkeys.ts",
    "packages/@zeruxjs/auth/src/provider-login.ts"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/auth"
}
---

## Choose a complete flow

The package supplies primitives: password hashing/verification, encrypted sessions, user/role database helpers, OTPs, TOTP, scoped tokens and PKCE preparation. Your application still owns login routes, cookies, CSRF, rate limits, user recovery and authorization decisions.

## TOTP and scoped tokens

```ts
import { generateTotpSecret, totpUri, verifyTotp, createTokenStore } from '@zeruxjs/auth';
const secret = generateTotpSecret();
const enrollmentUri = totpUri(secret, 'user@example.com', 'Your application');
const tokenStore = createTokenStore();
const issued = tokenStore.issue('user-id', ['read:posts'], 3600000);
const principal = tokenStore.verify(issued.token, 'read:posts');
```

Encrypt enrollment secrets at rest and do not log the URI or tokens. TOTP verification alone does not stop replay; record accepted time steps. OTP hashes need persisted expiry, attempt limits and one-time consumption.

## Sessions and revocation

Securely configure SECURITY_SESSION_KEY, SECURITY_SESSION_SALT and SECURITY_PASSWORD_SALT. Rotation needs a migration plan. Built-in token/revocation stores are in-memory; use shared persistent state for multiple servers, restart survival and global revocation. Set safe cookie attributes and protect unsafe cookie-authenticated requests against CSRF.

## Shared authentication state

Use `createSharedAuth` with an explicit `AuthPersistence` adapter for multiple server instances. The `auth-cas-v1` contract requires current reads, durable expiry and linearizable revision-checked writes with exact boolean success. Ordinary cache get/set is insufficient. `createMemoryAuthPersistence` is a bounded process-local reference only; the package does not install a production database adapter. A disposable SQLite test fixture exercises two independent connections through public connector exports.

Sessions contain random opaque bearer secrets; persisted records contain HMAC digests. Challenges are bound to the host-verified tenant/account and one of `reset`, `otp`, `magic`; consumption and failed-attempt accounting are atomic. Explicit lifetimes are capped at 15 minutes and attempts at ten (default five). `consumeTotp` atomically rejects accepted/older steps; enrolled secrets stay host-owned and encrypted separately. Keep replica clocks synchronized and credential IDs/parameters stable.

```ts
import { createSharedAuth, type SharedAuthOptions } from '@zeruxjs/auth';

export function configureAuthentication(options: SharedAuthOptions) {
  return createSharedAuth(options); // host supplies durable CAS store, keys and fresh authorization
}
```

`inventory`, `revoke`, `revokeChallenges` and `rotateSession` require an exact true result from application-owned `authorizeFresh`. Enforce recent independent authentication and same-account management permission. Rotation replaces the old session ID atomically; the host selects permitted scopes, with no wildcard interpretation. Revocation does not undo previously admitted requests. Token-key rotation accepts retained keys while issuing under `activeKeyId`; distribute keys before switching issuers and explicitly retire old keys. The independent stable `indexKey` must remain consistent across replicas and TOTP replay history.

`authSessionCookie` emits a Secure/HttpOnly/SameSite=Strict host-only cookie. `readAuthSessionCookie` rejects duplicate, malformed, encoded and control-bearing values. Cookie delivery still requires HTTPS, explicit origin/CSRF checks and endpoint-specific admission limits. The root framework auth option does not register these automatically. Keep login/recovery client responses generic to prevent account enumeration.

Close the manager before closing its host-owned store: `await auth.close()`. It stops admission, drains pending calls and wipes key copies; it cannot forcibly cancel an uncooperative adapter. Pending operations, account records, sessions, challenges, credentials and CAS retries are bounded. Public metadata excludes digests/key IDs; error causes belong only in trusted redacted logs. See the package README for exact limits, migration and runnable public-import example. Existing encrypted sessions, memory token stores and bare TOTP checks retain their original limits and do not transparently migrate.

## Tenant permissions

`hasTenantPermission` / `requireTenantPermission` demand an authenticated principal, exact tenant and explicit permission, with optional site scope. There is no implicit wildcard administrator. Construct that principal from verified identity and server-side membership, never a submitted role object.

## OAuth and passkeys

PKCE helpers prepare state/verifier and the authorization URL. Store them per login attempt and validate state before exchanging a code. Those legacy helpers do not exchange tokens or verify provider ID tokens; use the opt-in provider manager described below. The old `createPasskeyChallenge` also remains generation-only; use `createPasskeyManager` for actual WebAuthn verification.

`createPasskeyManager` lazily loads the optional maintained SimpleWebAuthn server verifier. Configure an application-owned RP ID, exact HTTPS origins, stable 32-byte binding key, `PasskeyStore` and fresh-proof authorizer. The library documentation targets Node LTS 22+; core auth remains usable when optional dependencies are omitted. Account-first, same-origin ceremonies require both presence and user verification, none-format attestation and supported ES256/RS256/EdDSA keys. No hardware provenance or complete WebAuthn feature parity is implied.

```ts
import { createPasskeyManager, type PasskeyManagerOptions } from '@zeruxjs/auth';

export function configurePasskeys(options: PasskeyManagerOptions) {
  return createPasskeyManager(options);
}
```

Use `beginRegistration`/`completeRegistration` and `beginAuthentication`/`completeAuthentication` with a verified tenant/account and server session. Browser options use base64url JSON fields. Challenges are short-lived, session/account/RP-bound and atomically consumed before verification. Successful assertions commit counter/revision CAS before returning a server-side step-up identity. That object is not a client bearer token. Incrementing counters must advance; zero counters still require a unique challenge and fresh revision.

`PasskeyStore` is a distinct `passkey-atomic-v1` contract, not extra fields in `AuthPersistence`. Production adapters must enforce RP-wide credential-ID uniqueness, durable credential/replay state, eight live challenges and 32 credentials per account. `createMemoryPasskeyStore` is bounded process-local reference storage only. Recovery and removal fence in-flight ceremonies with a nonreused account epoch. No production database adapter or usernameless discovery is installed.

Enrollment (including completion), removal and adding recovery codes require `authorizeFresh` to return exactly true after recent independent proof. Recovery codes are random 192-bit secrets stored as account/purpose-bound HMAC digests, with explicit expiry capped at 30 days. Using one code atomically removes all credentials, challenges and the entire recovery-code set; the host must then revoke sessions and authorize replacement enrollment using trusted fresh proof. Failures do not revive consumed material.

`ClientCertificateIdentityAdapter` and `EnterpriseSsoIdentityAdapter` are separate injected verification/disposal contracts, not built-in providers. Certificates require verified TLS identity or a mutually authenticated gateway with authenticated request-bound assertions, never arbitrary forwarded headers. SSO verification owns actual protocol signature, issuer/audience, state/nonce, time and replay checks. The earlier TWT note means JWT; verification/issuance belongs to `@zeruxjs/security/jwt`. HTTP CSRF, origin policy, endpoint admission, account linking and tenant permissions remain host-owned.

Call `await passkeys.close()` before closing its borrowed store. Close drains verifier/store work without pretending to forcibly cancel promises. Public error codes are fixed; internal causes may contain private ceremony data and must never reach clients. See the package README for precise byte/concurrency/TTL limits and migration guidance. [SimpleWebAuthn documentation](https://simplewebauthn.dev/docs/packages/server) and the [WebAuthn specification](https://www.w3.org/TR/webauthn-3/) describe the underlying verification model. Focused software-credential checks are not live browser or hardware acceptance.

## Explicit provider login

`createProviderLogin` adds the authorization-code/S256 flow through declared Google/Microsoft OIDC, GitHub/Discord OAuth2 or explicit custom profiles. Each definition supplies exact authorization/token/user-info endpoints, HTTPS outbound/redirect allowlists, scopes, display label and client authentication. The optional internal security integration owns maintained JOSE verification and bounded JWKS rotation. No network, discovery scan, route or account linking starts on import.

A shared `provider-login-atomic-v1` store binds private PKCE attempts/state/nonce to tenant/provider/server session and consumes them before exchange. Provider-bound code digests reject replay across instances. OIDC validates exact issuer/client audience, time/age, nonce, optional authorized party and supported token hash claims. User-info cannot replace an ID token; OAuth identities are labeled OAuth2, not OIDC. Optional OIDC user-info must match the verified subject.

Identity keys use tenant/provider/issuer/subject, never email. Unverified email is omitted. Linking and unlinking require recent authentication, and storage must enforce unique identity ownership atomically. The memory store is reference-only; production requires durable linearizable operations and expiry. Deadlines retain native pending slots, readers cancel on failure and close drains owned verifier/JWKS work without closing borrowed storage.

LinkedIn/X have separate reviewed protocol metadata and require explicit custom configuration; Facebook remains unverified with no built-in profile. No live vendor parity, SAML, OAuth 1.0a, implicit/device/refresh flow or dynamic discovery is implied. See the package README for current official references, exact budgets and a public-import example. Real app enrollment, consent, credentials, HTTPS callback, egress policy and atomic storage remain live prerequisites.

## Install and select the integration

```sh
npm install @zeruxjs/auth@0.0.4
```

There is no automatic `auth` startup service in `zerux.config.js` for this package. Import its public APIs and create the explicit server owner in the application that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Initialize the package explicitly in owned server startup. Map user/role/meta tables to the application schema, choose the session cookie name and duration, and provide key/salt environment values before session/password operations. The root framework auth field is not an automatic login or middleware registration mechanism. Build a host session verifier and resource/tenant authorization policy around the primitives.

## TypeScript: inputs, results and ownership

```ts
import { setAuthConfig } from '@zeruxjs/auth';

type Inputs = Parameters<typeof setAuthConfig>;
type Result = Awaited<ReturnType<typeof setAuthConfig>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof setAuthConfig>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Persist challenge expiry, attempt limits, one-time use and TOTP replay state. In-memory token and revocation stores do not coordinate multiple replicas. Session creation is not cookie transport; send appropriate HttpOnly/Secure/SameSite policy through the application response. PKCE helpers do not perform an OAuth token exchange or ID-token validation, and the legacy passkey challenge generator is not the opt-in WebAuthn verifier.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### AuthConfig

| Field     | Accepted type/value                                                                                                                                                               | Optional |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `db`      | `{ usersTable: string; rolesTable: string; usermetaTable: string; supportsReturning?: boolean; fields: { userId: string; email: string; passwordHash: string; role: string; }; }` | No       |
| `session` | `{ cookieName: string; expiresIn: number; }`                                                                                                                                      | No       |

### PasswordPolicy

| Field              | Accepted type/value | Optional |
| ------------------ | ------------------- | -------- |
| `minLength`        | `number`            | Yes      |
| `maxLength`        | `number`            | Yes      |
| `requireUppercase` | `boolean`           | Yes      |
| `requireLowercase` | `boolean`           | Yes      |
| `requireDigit`     | `boolean`           | Yes      |
| `requireSymbol`    | `boolean`           | Yes      |

### TotpOptions

| Field       | Accepted type/value              | Optional |
| ----------- | -------------------------------- | -------- |
| `period`    | `number`                         | Yes      |
| `digits`    | `6 \| 8`                         | Yes      |
| `algorithm` | `"sha1" \| "sha256" \| "sha512"` | Yes      |
| `now`       | `number`                         | Yes      |

### OAuthAuthorizationOptions

| Field                   | Accepted type/value      | Optional |
| ----------------------- | ------------------------ | -------- |
| `authorizationEndpoint` | `string`                 | No       |
| `clientId`              | `string`                 | No       |
| `redirectUri`           | `string`                 | No       |
| `allowedRedirectUris`   | `readonly string[]`      | No       |
| `scopes`                | `readonly string[]`      | Yes      |
| `extra`                 | `Record<string, string>` | Yes      |

### TenantPrincipal

Host must obtain this principal only after verifying an authenticated, unexpired session.

| Field         | Accepted type/value | Optional |
| ------------- | ------------------- | -------- |
| `userId`      | `string \| number`  | No       |
| `tenantId`    | `string \| number`  | No       |
| `permissions` | `readonly string[]` | No       |
| `siteIds`     | `readonly string[]` | Yes      |

## Readable source ownership

The package README maps legacy primitives, shared state, verifier/store contracts and provider flow owners separately. Root runtime imports eagerly use Node crypto; no browser runtime entry is supplied. UI code may use erased types or sanitized authorized results, never raw user rows, credentials, PKCE attempts or private causes.

`createSharedAuth`, `createPasskeyManager` and `createProviderLogin` own active operations and copied key material. Await their `close()` before releasing borrowed stores/transports. A timeout only bounds waiting; actual native/host settlement can delay shutdown. Process-local token/revocation/reference stores do not expose a manager close lifecycle or imply distributed persistence. Legacy wildcard role/token behavior remains compatible and does not weaken exact tenant/shared-scope checks.
