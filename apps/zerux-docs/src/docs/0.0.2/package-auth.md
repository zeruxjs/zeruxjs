---
{
  "title": "Authentication and authorization",
  "description": "Combine password/session primitives with application-owned identity and storage.",
  "section": "Packages",
  "order": 9,
  "sources": [
    "packages/@zeruxjs/auth/README.md",
    "packages/@zeruxjs/auth/package.json"
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

## Tenant permissions

`hasTenantPermission` / `requireTenantPermission` demand an authenticated principal, exact tenant and explicit permission, with optional site scope. There is no implicit wildcard administrator. Construct that principal from verified identity and server-side membership, never a submitted role object.

## OAuth and passkeys

PKCE helpers prepare state/verifier and the authorization URL. Store them per login attempt and validate state before exchanging a code. They do not exchange tokens or verify provider ID tokens. Passkey challenge generation is not WebAuthn attestation/assertion verification; use a complete verifier for passkey authentication.

## Install and select the integration

```sh
npm install @zeruxjs/auth@0.0.2
```

There is no automatic `auth` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

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
