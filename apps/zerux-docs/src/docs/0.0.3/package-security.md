---
{
  "title": "Security primitives",
  "description": "Apply CORS, CSRF, headers, cookies and rate limiting at the correct boundary.",
  "section": "Packages",
  "order": 10,
  "sources": [
    "packages/@zeruxjs/security/README.md",
    "packages/@zeruxjs/security/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/security"
}
---

## Compose policies

```ts
import { createCsrfProtection, evaluateCors, createSecurityHeaders } from '@zeruxjs/security';
const csrf = createCsrfProtection({ secret: process.env.CSRF_KEY! });
const token = csrf.issue(sessionId);
const valid = csrf.verify(token, sessionId);
const cors = evaluateCors(request.headers.origin, {
  origins: ['https://app.example'], credentials: true
});
const headers = createSecurityHeaders({ hsts: true }, true);
```

The request, sessionId and response integration are application-provided. Supply a sufficiently strong server-held CSRF secret. A helper returns a policy result; ensure the actual response/handler enforces it.

## CORS versus authorization

An origin allowlist controls browser cross-origin access. It does not authenticate a caller, prevent server-to-server requests or prove tenant membership. Authorize the operation independently. For cookie-authenticated writes, verify origin where supplied and a session-bound CSRF token.

## Rate limiting

`createRateLimiter` is in-memory. Multiple replicas do not share its counters. Configure limits at the edge or use an appropriate shared backend when a global limit matters. Choose identity keys from trusted context rather than arbitrary forwarded headers.

## Filesystem and headers

`ensurePathInsideRoot` is lexical containment, not symlink-safe filesystem authorization. Use appropriate secure file-descriptor handling for private data. A default security-header set is not an XSS proof; configure CSP for your application's assets and avoid unsafe HTML interpolation.

## Install and select the integration

```sh
npm install @zeruxjs/security@0.0.3
```

There is no automatic `security` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Apply response headers and request protections explicitly in server routes/middleware. Choose CSP, allowed origins, cookie attributes, CSRF binding and rate limits for the application rather than assuming one factory secures every endpoint. Provide adequate secret material through protected server configuration.

## TypeScript: inputs, results and ownership

```ts
import { createSecurityHeaders } from '@zeruxjs/security';

type Inputs = Parameters<typeof createSecurityHeaders>;
type Result = Awaited<ReturnType<typeof createSecurityHeaders>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createSecurityHeaders>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

CORS is not authentication; in-memory rate limits do not coordinate replicas. Lexical path containment is not symlink-safe file authorization. Reject unauthorized unsafe methods before side effects and avoid reflected payloads in error responses. Verify headers/cookies on the real proxy/TLS deployment, where secure transport and forwarded hosts affect behavior.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### SecureHeadersOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `hsts` | `boolean \| { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean }` | Yes |
| `csp` | `string` | Yes |
| `referrerPolicy` | `"no-referrer" \| "strict-origin-when-cross-origin" \| "same-origin"` | Yes |
| `frameOptions` | `"DENY" \| "SAMEORIGIN"` | Yes |

### CsrfOptions

Double-submit friendly, session-bound signed token. The caller must store the session identifier securely.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `secret` | `string \| Buffer` | No |
| `ttlSeconds` | `number` | Yes |
| `now` | `() => number` | Yes |

### CorsOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `origins` | `readonly string[] \| ((origin: string) => boolean)` | No |
| `methods` | `readonly string[]` | Yes |
| `headers` | `readonly string[]` | Yes |
| `exposeHeaders` | `readonly string[]` | Yes |
| `credentials` | `boolean` | Yes |
| `maxAgeSeconds` | `number` | Yes |

### RateLimitOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `windowMs` | `number` | No |
| `max` | `number` | No |
| `maxKeys` | `number` | Yes |
| `now` | `() => number` | Yes |

### CookieOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxAgeSeconds` | `number` | Yes |
| `path` | `string` | Yes |
| `domain` | `string` | Yes |
| `httpOnly` | `boolean` | Yes |
| `secure` | `boolean` | Yes |
| `sameSite` | `"Strict" \| "Lax" \| "None"` | Yes |
