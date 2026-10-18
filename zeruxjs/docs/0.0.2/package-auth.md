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


## Public entry points

Manifest reference for `@zeruxjs/auth@0.0.2`.

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


## Implementation sources

- [packages/@zeruxjs/auth/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/auth/README.md)
- [packages/@zeruxjs/auth/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/auth/package.json)
