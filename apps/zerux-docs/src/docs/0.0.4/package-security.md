---
{
  "title": "Security primitives",
  "description": "Apply CORS, CSRF, headers, cookies and rate limiting at the correct boundary.",
  "section": "Packages",
  "order": 10,
  "sources": [
    "packages/@zeruxjs/security/README.md",
    "packages/@zeruxjs/security/package.json",
    "packages/@zeruxjs/security/src/encoding.ts",
    "packages/@zeruxjs/security/src/cryptography.ts",
    "packages/@zeruxjs/security/src/csrf.ts",
    "packages/@zeruxjs/security/src/policy.ts",
    "packages/zforge/src/framing.ts",
    "packages/zhost/src/dev/injection.ts"
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

Keyring/authenticator owners require `destroy()`; JWT/JWKS and asynchronous limiter owners require their documented `close()`/drain. The existing CSRF manager and inert structural policy composer have no public disposer; do not invent one. Retaining a handle is a static lint hint, not proof that cleanup ran.

The request, sessionId and response integration are application-provided. Supply a sufficiently strong server-held CSRF secret. A helper returns a policy result; ensure the actual response/handler enforces it.

## CORS versus authorization

An origin allowlist controls browser cross-origin access. It does not authenticate a caller, prevent server-to-server requests or prove tenant membership. Authorize the operation independently. For cookie-authenticated writes, verify origin where supplied and a session-bound CSRF token.

## Rate limiting

`createRateLimiter` is in-memory. Multiple replicas do not share its counters. Configure limits at the edge or use an appropriate shared backend when a global limit matters. Choose identity keys from trusted context rather than arbitrary forwarded headers.

## Filesystem and headers

`ensurePathInsideRoot` is lexical containment, not symlink-safe filesystem authorization. Use appropriate secure file-descriptor handling for private data. A default security-header set is not an XSS proof; configure CSP for your application's assets and avoid unsafe HTML interpolation.

## Install and select the integration

```sh
npm install @zeruxjs/security@0.0.4
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

| Field            | Accepted type/value                                                                    | Optional |
| ---------------- | -------------------------------------------------------------------------------------- | -------- |
| `hsts`           | `boolean \| { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean }` | Yes      |
| `csp`            | `string`                                                                               | Yes      |
| `referrerPolicy` | `"no-referrer" \| "strict-origin-when-cross-origin" \| "same-origin"`                  | Yes      |
| `frameOptions`   | `"DENY" \| "SAMEORIGIN"`                                                               | Yes      |

### CsrfOptions

Double-submit friendly, session-bound signed token. The caller must store the session identifier securely.

| Field        | Accepted type/value | Optional |
| ------------ | ------------------- | -------- |
| `secret`     | `string \| Buffer`  | No       |
| `ttlSeconds` | `number`            | Yes      |
| `now`        | `() => number`      | Yes      |

### CorsOptions

| Field           | Accepted type/value                                  | Optional |
| --------------- | ---------------------------------------------------- | -------- |
| `origins`       | `readonly string[] \| ((origin: string) => boolean)` | No       |
| `methods`       | `readonly string[]`                                  | Yes      |
| `headers`       | `readonly string[]`                                  | Yes      |
| `exposeHeaders` | `readonly string[]`                                  | Yes      |
| `credentials`   | `boolean`                                            | Yes      |
| `maxAgeSeconds` | `number`                                             | Yes      |

### RateLimitOptions

| Field      | Accepted type/value | Optional |
| ---------- | ------------------- | -------- |
| `windowMs` | `number`            | No       |
| `max`      | `number`            | No       |
| `maxKeys`  | `number`            | Yes      |
| `now`      | `() => number`      | Yes      |

### CookieOptions

| Field           | Accepted type/value           | Optional |
| --------------- | ----------------------------- | -------- |
| `maxAgeSeconds` | `number`                      | Yes      |
| `path`          | `string`                      | Yes      |
| `domain`        | `string`                      | Yes      |
| `httpOnly`      | `boolean`                     | Yes      |
| `secure`        | `boolean`                     | Yes      |
| `sameSite`      | `"Strict" \| "Lax" \| "None"` | Yes      |

## Match encoding to the destination

| Helper                   | Supported destination                                               |
| ------------------------ | ------------------------------------------------------------------- |
| escapeHtmlText           | HTML text source                                                    |
| escapeHtmlAttribute      | Fixed, quoted, inert HTML attribute values                          |
| validateNavigationUrl    | Validated HTTP(S) navigation, then attribute-encode at an HTML sink |
| serializeJavaScriptValue | One JSON-compatible JS value inside an HTML script block            |
| serializeCssString       | One quoted CSS string token for a fixed inert string property       |

Import these pure helpers from `@zeruxjs/security/encoding`, or the root. None is a
universal sanitizer. Never use HTML encoding as JavaScript, CSS or URL validation,
and do not concatenate serialized JSON inside an existing JS string/template or
event handler. Script serialization escapes HTML delimiters and U+2028/U+2029;
invalid JSON values/throwing serialization callbacks produce redacted errors.
CSS serialization hex-escapes non-alphanumeric code points, replaces NUL and caps
65536 UTF-16 units. It does not sanitize stylesheets, selectors, url() or arbitrary
style attributes. See [OWASP context guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

Navigation validation rejects credentials, controls/space/backslash obfuscation,
protocol-relative references and non-HTTP(S) schemes. Relative references require
an explicit baseUrl. allowedOrigins is an optional bounded canonical-origin list.
It is not outbound SSRF/DNS/redirect authorization. Identifier normalization is
lossy and collision-prone, not identity or authorization validation.

Legacy escapeHtml remains available with the same valid-input encoding.
serializeJsonForScript still maps null/undefined to an object; the new serializer
preserves JSON null and rejects unsupported top-level values. sanitizeIdentifier
now also normalizes unsafe fallbacks, using item if none remains. Migrate invalid
legacy identifiers to deliberate unique IDs and context-mismatched encoders to
the appropriate helper; valid existing imports stay available.

## Native crypto with explicit policies

```ts
import { randomBytes } from 'node:crypto';
import { createEncryptionKeyring } from '@zeruxjs/security/crypto';
const ring = createEncryptionKeyring({
  current: { id: 'key-1', key: randomBytes(32) }
}); // throwaway example key; persisted records need stable protected keys
try {
  const record = ring.encrypt('private text', 'tenant-7:document-42');
  const plaintext = ring.decrypt(record, 'tenant-7:document-42');
} finally { ring.destroy(); }
```

| Purpose                      | API/policy                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Reversible encryption        | createEncryptionKeyring: AES-256-GCM, 32-byte key, random 12-byte IV, 16-byte tag |
| Shared-secret authentication | createMessageAuthenticator: HMAC-SHA-256 with independent 32-byte keys            |
| Data digest                  | hashData: SHA-256 default, SHA-384 or SHA-512 only, hex output                    |
| Byte comparison              | timingSafeEqualBytes: native equal-length comparison; lengths remain observable   |
| Password KDF                 | Existing auth-owned scrypt API, separate from these primitives                    |

All cryptographic operations use Node crypto/OpenSSL. There are no custom ciphers,
weak password hashes or noncryptographic checksum aliases, and no full Node/JOSE
algorithm parity is promised. HMAC is not public-key signing or encryption. Data
digests are not password KDFs or message authentication. The factories start no
service and read no environment secrets. Node crypto support is required; no
third-party provider, key service or credentials are contacted automatically.
See [Node crypto](https://nodejs.org/api/crypto.html).

Both factories take current `{id,key}`, up to four previous entries and maxBytes
(default 1 MiB, maximum 16 MiB, positive safe integer). IDs are public, unique
1–64-character alphanumeric/underscore/hyphen labels; keys are random bytes from
protected configuration, not padded passwords. Keys are copied. Use separate
keys for encryption and authentication.

Encrypted records have v:1, alg:A256GCM, kid, iv, tag and ciphertext. Authentication
metadata has v:1, alg:HS256, kid and tag, with the original message supplied
separately. Byte fields are canonical unpadded base64url. Version, algorithm, key
ID, purpose domain and a required nonempty context (at most 1024 UTF-8 bytes) are
authenticated. Derive context from server-verified tenant/object identity; neither
a context, ciphertext nor nonce establishes permission. Decrypt validates exact
fields and IV/tag lengths, authenticates before returning plaintext, and clears
its provisional plaintext buffer.

Malformed, wrong-key, wrong-context or tampered ciphertext produces one generic
SecurityRecordError without private values. MAC mismatch/malformed metadata
returns false. Configuration/input policy errors throw. Native-provider failures
remain SecurityCryptoError with trusted internal causes; do not serialize errors,
causes or stacks to clients. No whole-request constant-time guarantee is implied.

## Rotation, cleanup and legacy consumers

Current keys alone encrypt/sign; previous keys decrypt/verify. Distribute a new
key to all replicas before switching the emitting key ID, retain old keys until
records migrate/expire, and remove them only when rejection is intended. Key IDs
cannot be relabeled on existing records because they are authenticated. The
package does not distribute/store keys, enforce expiry/replay policy, coordinate
nonces/volume across replicas or migrate databases. These are package records,
not JWT/JWE or auth session tokens.

destroy is idempotent, clears owned key buffers and rejects further operations.
Buffer clearing is best effort; caller buffers, returned plaintext and VM/native
copies remain outside that guarantee. Synchronous operations own no timer,
socket, worker or listener. Persistent key storage/distribution and deployment-wide
rekey/volume controls belong to the application.

Auth already uses native scrypt/HMAC/AES-GCM independently. No auth source or wire
format changed; its password hashes and existing session blobs are not inputs to
this record API. Migrate through the owning auth validation/reissuance boundary
rather than reinterpret legacy bytes. Configure auth secrets explicitly even in
development instead of relying on known fallback values. This task does not
force user-session invalidation or change tenant/role decisions.

Runtime policy tightening rejects injected cookie/header enums and nonboolean
flags. CORS predicates must return synchronous booleans; async/thenable decisions
reject rather than authorize by truthiness. HTTP(S) origins must be serialized
origins, not URLs with paths or credentials. isSameOriginRequest also requires
canonical expectedOrigin. Method/header lists are bounded and methods uppercase;
preflight denial includes the correct Vary fields. CSRF secrets are 32–4096 bytes,
session IDs at most 1024 UTF-8 bytes without controls, and custom clocks must
return nonnegative safe-integer milliseconds. Canonical valid CSRF token format
is preserved. CSP nonce sizes were already bounded to 16–64 random bytes; nonce
syntax/possession is not authentication and entropy comes from native generation.

Focused checks exercise script/style breaks, invalid algorithms/key/nonce lengths,
tampered records/metadata, context mismatch, rotation, provider failure, comparison
results, owned cleanup, runtime policy rejection and offline installed public
exports/declarations through the shared TypeScript tooling. No live browser/proxy,
distributed rotation, timing measurement or full-system security certification is
claimed. Only installed tooling and native Node crypto are local prerequisites.

JavaScript-value serialization returns a `JSON.parse(...)` expression, preserving
JSON own-property semantics for names such as `__proto__`. It requires the ordinary
JSON intrinsic in the host script context; it is not a JSON document string or a
JavaScript sandbox. The legacy serializeJsonForScript still returns raw escaped
JSON text. If that legacy output is evaluated as an object literal, special
JavaScript object-literal prototype semantics can differ from JSON.parse. Migrate
untrusted JSON data in JavaScript assignments to serializeJavaScriptValue; existing
legacy raw-JSON consumers keep their valid output format.

## Structural policy and devtools framing

Import `createSecurityPolicy` from `@zeruxjs/security/policy` (or the root). Create
one composer per application from trusted configuration, then one response object
before headers or streamed HTML. The returned nonce belongs to that response only.

```ts
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { escapeHtmlAttribute } from '@zeruxjs/security/encoding';
const policy = createSecurityPolicy({ https: true,
  modules: [{ module: 'reports', resources: {
    'connect-src': ['https://reports.example']
  } }],
  approvals: { reports: { 'connect-src': ['https://reports.example'] } }
});
const response = policy.createResponse();
const html = `<script nonce="${escapeHtmlAttribute(response.nonce!)}">console.log('ready')</script>`;
// Apply response.headers to the actual response before sending html.
```

Defaults deny frames, inline style attributes, base/object sources and unspecified
resources, allowing same-origin resource directives with a fresh script nonce.
COOP same-origin, COEP require-corp, CORP same-origin and nosniff apply. Production
HSTS requires explicit trusted https=true. Each module's additional exact source
needs a host base allowance or a per-module approval. Explicit none cannot be
merged away; isolation/nonce conflicts throw SecurityPolicyConflictError with
module/directive/reason diagnostics. Unknown keys, CRLF/control characters,
wildcards, arbitrary schemes, paths, raw nonce sources and eval reject. Lists are
bounded to 64 entries; composed CSP is bounded to 16 KiB. Configuration is snapshotted,
headers are frozen, and no global registry or teardown resource is created.

Use createCspHash(exactInlineText, 'sha256') for script/style hash descriptors
(sha384/sha512 also supported). nonceDirectives selects script-src/style-src or
an empty list. Generate once and pass the nonce to trusted renderers for all chunks;
never reuse it across responses or derive grants from Origin/Referer/Host headers.
Only the host sets frameAncestors; developmentFrameAncestors is prohibited in
production. External ancestor lists omit XFO, which cannot express that policy.
frame-ancestors requires the HTTP CSP header; independent CSP headers intersect.

Zforge registration supports devtools.frameAncestors with explicit exact development
origins. Production documents ignore these grants and retain strict isolation and
framing. Zhost leaves enforced-CSP and explicitly flushed streams untouched. Manual
zforge injectDevClient can accept a response-owned nonce, but styles, connections
and frames still require host approval. Browser errors never trigger policy removal.

COOP can sever opener relationships. COEP requires compatible CORS/CORP responses
and child embedder policies; CORP governs no-cors resource use, not authorization.
Worker scripts need worker-src permission and compatible worker/asset responses.
Secure contexts, ancestors and browser implementation also determine isolation;
headers alone do not prove crossOriginIsolated. See the
[HTML isolation model](https://html.spec.whatwg.org/multipage/browsers.html),
[Fetch CORP policy](https://fetch.spec.whatwg.org/#cross-origin-resource-policy-header)
and [CSP standard](https://www.w3.org/TR/CSP/). This is a constrained policy API,
not full CSP/framework parity. Node regressions cover composition and HTTP bytes;
actual browser/proxy behavior needs deployment verification.

## Capability-aware rate admission

createDistributedRateLimiter requires a security-owned atomic-fixed-window-v1 store, verified tenant/subject identities and explicit endpoint failure policies. It hashes bounded identifiers using the existing HMAC authenticator, never ordinary cache get/set. The legacy memory limiter stays process-scoped; the new memory reference store requires explicit local scope. Quota denial produces safe 429/Retry-After; unavailable accounting/capacity produces 503 unless fail-open was explicitly chosen for an outage. Keep concurrent-request admission separate.

The opt-in cache-redis strategy uses a fixed bounded Lua script, Redis server time, one explicit Cluster hash tag, hash/expiry-index accounting and TTL/cardinality caps. Configure isolated limiter keys, scripting ACLs, noeviction and persistence/failover policy. Lost state can reset quota; atomic execution is not durable consensus. Forwarded IPs are ignored unless an exact configured direct proxy supplies one validated address. Endpoint labels are bounded and diagnostic hooks never include identity/payload data.

See the security README for the compiled public-import example, lifecycle, fixed-window burst behavior and operational limits. Native multi-client/TTL/state-loss acceptance requires CACHE_RATE_LIMIT_REDIS_URL; mocked EVAL does not establish distribution and no services/apps are started automatically.

## JOSE-based JWT policies

Use `createJwtSigner`, `createJwtVerifier` and opt-in `createJwtJwks` from `@zeruxjs/security/jwt`. These are signed compact JWTs, distinct from encrypted records/password hashing/authorization. Algorithm/key policy is explicit: local HS256/384/512, RSA RS/PS256/384/512, P-256/P-384/P-521 ES256/384/512 and EdDSA with Ed25519. ES256K, Ed448, ML-DSA and none are deliberately unavailable. Runtime support is still required.

Verification requires declared algorithm allowlist, issuer/audience, type policy, required claims, subject and JTI policy. Present exp/nbf/iat are integer NumericDates; iat only has an age/future check when maxTokenAgeSeconds is declared. Replay consumption is host-owned and atomic after verification. Optional typ absence must be explicitly allowed; wrong present type fails. Verification never fetches a token's jku/x5u URL or accepts inline keys. Header/key use/curve/kid selection is validated before JOSE import.

Signing owns registered claims and explicit expiry, bounds custom JSON and uses configured kid/private key. Verification rotation uses retained static keys or a bounded, coalesced, cooldown-limited JWKS source. JWKS requires exact approved HTTPS destinations and an injected transport enforcing DNS/IP/TLS policy. Failed/expired caches do not authorize stale keys. Deadlines/cancellation retain native work slots; close drains and cannot forcibly cancel arbitrary store/transport promises. Generic error messages exclude secrets; internal causes stay private. See the package README for complete limits and the runnable public-import example.
