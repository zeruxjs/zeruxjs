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
