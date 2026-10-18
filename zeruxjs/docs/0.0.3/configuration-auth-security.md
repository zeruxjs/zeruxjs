# Authentication and security setup

Understand configuration hooks, environment-backed keys and explicit enforcement in application code.


## No automatic login or middleware from an open config key

The root ZeruxConfig declares `auth` and `security`, but the current core service bootstrap does not automatically turn them into a login service, CSRF protection or authorization middleware. This matters because the root type also allows custom keys: a value accepted by TypeScript is not proof that a runtime consumer reads it.

Use `@zeruxjs/auth` and `@zeruxjs/security` explicitly in owned server code. Install the packages, provision session/password key material through the process environment, define the application's database schema, and add route/middleware authorization. Configuration is input; enforcement occurs where the request is authenticated and an operation is authorized.

## Configure the auth package deliberately

```ts
import { setAuthConfig, getAuthConfig } from '@zeruxjs/auth';
const current = getAuthConfig();
setAuthConfig({
  session: { cookieName: 'application_session', expiresIn: 3600 },
  db: { ...current.db, usersTable: 'users', rolesTable: 'groups',
    usermetaTable: 'usermeta', supportsReturning: true },
});
```

Call this in the owning server initialization path, not a browser entry point or on every request. The package's session expiration is in seconds. Its default cookie name is `proworkspace_session` and default expiration is 86,400 seconds; choose application-specific settings deliberately. Mapping identifiers are validated. For MySQL without INSERT RETURNING, choose `supportsReturning: false` and follow the insert-ID contract.

## Keys and salts

Provide `SECURITY_SESSION_KEY`, `SECURITY_SESSION_SALT` and `SECURITY_PASSWORD_SALT` securely. Session key/salt code can use the encryption-key environment fallback, but production rejects the built-in development fallback values. Do not rely on defaults or put real material in example config, logs, source links or generated docs. Plan key rotation and invalidation before switching secrets: encryption, cookies, tokens and stored passwords can have different compatibility requirements.

## Enforce a request policy

After authenticating a session, authorize the exact tenant, resource and action. Validate unsafe-method origins and a session-bound CSRF token for cookie-authenticated writes. Use the security package's helpers explicitly; setting `security: {}` does not add headers or limits to every route. CORS only controls browser response access and is not authentication.

Token/revocation maps in the auth package are process-local unless replaced or integrated with shared persistence. A restart or another replica can therefore change revocation semantics. Persist OTP challenge expiry/attempt/replay state and TOTP replay tracking separately. Passkey challenge creation is not complete WebAuthn verification.

## TypeScript and verification

Prefer `Parameters<typeof setAuthConfig>[0]` for the package's actual settings rather than the root config's broad auth field. Use `unknown` for decoded request/session content until validation succeeds. A typed principal is meaningful only after cryptographic/session verification and application authorization.

Test missing/expired/tampered tokens, logged-out access, role changes, cross-tenant requests, CSRF failures and shared-store outages. Do not report a successful config typecheck as a security audit. Protected dashboards in tags, reports, queue and email need their own application callbacks and should remain denied until those callbacks are implemented.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
