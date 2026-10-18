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
