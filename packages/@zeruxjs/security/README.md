# @zeruxjs/security

Framework-independent server security primitives. Use `createSecurityHeaders()` per response; never assume these helpers alone prevent XSS or CSRF. Cookie-authenticated unsafe methods should verify both the origin (when supplied) and a session-bound CSRF token.

```ts
import { createCsrfProtection, evaluateCors, createSecurityHeaders, createRateLimiter, serializeCookie } from '@zeruxjs/security';
const csrf = createCsrfProtection({ secret: process.env.CSRF_KEY! }); // >=32 bytes
const token = csrf.issue(sessionId);
csrf.verify(token, sessionId);
const cors = evaluateCors(request.headers.origin, { origins: ['https://app.example'], credentials: true });
const headers = createSecurityHeaders({ hsts: true }, true);
const limiter = createRateLimiter({ max: 100, windowMs: 60_000 });
```

CORS is not authentication. The limiter is in-memory and not distributed. `ensurePathInsideRoot` is a lexical containment check, not a symlink-safe filesystem authorization check. Configure CSP and origin policy for your application. Secrets must come from a secret manager or protected environment variables.
