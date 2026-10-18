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
