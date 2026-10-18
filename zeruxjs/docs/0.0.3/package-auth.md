# Authentication and authorization

Combine password/session primitives with application-owned identity and storage.


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

## Tenant permissions

`hasTenantPermission` / `requireTenantPermission` demand an authenticated principal, exact tenant and explicit permission, with optional site scope. There is no implicit wildcard administrator. Construct that principal from verified identity and server-side membership, never a submitted role object.

## OAuth and passkeys

PKCE helpers prepare state/verifier and the authorization URL. Store them per login attempt and validate state before exchanging a code. They do not exchange tokens or verify provider ID tokens. Passkey challenge generation is not WebAuthn attestation/assertion verification; use a complete verifier for passkey authentication.

## Install and select the integration

```sh
npm install @zeruxjs/auth@0.0.3
```

There is no automatic `auth` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/zeruxjs/docs/0.0.3/configuration-reference.md) and [TypeScript](/zeruxjs/docs/0.0.3/typescript.md).

## A practical integration workflow

Initialize the package explicitly in owned server startup. Map user/role/meta tables to the application schema, choose the session cookie name and duration, and provide key/salt environment values before session/password operations. The root framework auth field is not an automatic login or middleware registration mechanism. Build a host session verifier and resource/tenant authorization policy around the primitives.

## TypeScript: inputs, results and ownership

```ts
import { setAuthConfig } from '@zeruxjs/auth';

type Inputs = Parameters<typeof setAuthConfig>;
type Result = Awaited<ReturnType<typeof setAuthConfig>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof setAuthConfig>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.3/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Persist challenge expiry, attempt limits, one-time use and TOTP replay state. In-memory token and revocation stores do not coordinate multiple replicas. Session creation is not cookie transport; send appropriate HttpOnly/Secure/SameSite policy through the application response. PKCE helpers do not perform an OAuth token exchange or ID-token validation, and passkey challenge generation is not WebAuthn verification.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### AuthConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `db` | `{ usersTable: string; rolesTable: string; usermetaTable: string; /** Set false on engines (e.g. MySQL) without INSERT .. RETURNING; inspect insertedIds instead. */ supportsReturning?: boolean; fields: { userId: string; email: string; passwordHash: string; role: string; }; }` | No |
| `session` | `{ cookieName: string; expiresIn: number; }` | No |

### PasswordPolicy

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `minLength` | `number` | Yes |
| `maxLength` | `number` | Yes |
| `requireUppercase` | `boolean` | Yes |
| `requireLowercase` | `boolean` | Yes |
| `requireDigit` | `boolean` | Yes |
| `requireSymbol` | `boolean` | Yes |

### TotpOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `period` | `number` | Yes |
| `digits` | `6 \| 8` | Yes |
| `algorithm` | `"sha1" \| "sha256" \| "sha512"` | Yes |
| `now` | `number` | Yes |

### OAuthAuthorizationOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `authorizationEndpoint` | `string` | No |
| `clientId` | `string` | No |
| `redirectUri` | `string` | No |
| `allowedRedirectUris` | `readonly string[]` | No |
| `scopes` | `readonly string[]` | Yes |
| `extra` | `Record<string, string>` | Yes |

### TenantPrincipal

Host must obtain this principal only after verifying an authenticated, unexpired session.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `userId` | `string \| number` | No |
| `tenantId` | `string \| number` | No |
| `permissions` | `readonly string[]` | No |
| `siteIds` | `readonly string[]` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/auth@0.0.3`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/auth

Server-side password hashing, encrypted sessions, user/role database facade, one-time passwords, RFC 6238 authenticator TOTP, scoped API/reset tokens, password policy, and optional revocation store.

Existing `hashPassword`, `verifyPassword`, `createSession`, `verifySession`, database helpers, `createOtp` and passkey challenge *generation* remain supported. Passkey challenge creation does **not** validate WebAuthn attestation/assertions; use a full WebAuthn verifier. OTP code hashes alone do not enforce expiry or one-time use: use a dedicated persisted challenge record with attempt limits.

```ts
import { generateTotpSecret, totpUri, verifyTotp, createTokenStore, validatePasswordStrength } from '@zeruxjs/auth';
const secret = generateTotpSecret(); // encrypt at rest; never log
const uri = totpUri(secret, 'alice@example.com', 'Your App');
const matches = verifyTotp(userInput, secret, { window: 1 });
const apiKeys = createTokenStore();
const { token } = apiKeys.issue('user-id', ['read:posts'], 3600_000);
const identity = apiKeys.verify(token, 'read:posts');
```

For production sessions set `SECURITY_SESSION_KEY`, `SECURITY_SESSION_SALT` and `SECURITY_PASSWORD_SALT` securely; rotate with planned migration. Built-in token and revocation registries are in-memory and must be replaced with persistent shared stores for distributed deployments. Provide request rate limiting and brute-force protection at the application edge. Do not confuse TOTP validation with replay protection; store and reject already-used time steps.

OAuth authorization-code PKCE helper: `createOAuthAuthorization({authorizationEndpoint, clientId, redirectUri, allowedRedirectUris, scopes})` returns URL, state and verifier. Store the state/verifier per login session server-side and validate state with `verifyOAuthState`; never expose verifier in browser logs or URLs. This helper does not perform token exchange or provider-specific ID token verification.

## Section 74 tenant/role authorization

`hasTenantPermission(principal,{tenantId,permission,siteId?})` and `requireTenantPermission(...)` require exact tenant ID and explicit permission and, when specified, allowlisted site ID. No implicit administrator or wildcard access is granted. These helpers require a previously authenticated, validated principal supplied by the host. Table/column config mappings and session config values now fail closed on invalid input. Organization ID `0` is a valid and enforced role scope. For MySQL user inserts set `setAuthConfig({db:{supportsReturning:false}})` to use `insertedIds`; by default the PostgreSQL/SQLite-compatible RETURNING request is retained. In-memory token/session stores remain unsuitable for distributed revocation without a shared backend.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/auth/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/auth/README.md)
- [packages/@zeruxjs/auth/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/auth/package.json)
