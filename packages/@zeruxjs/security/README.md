# @zeruxjs/security

Framework-independent Node security primitives and pure destination-specific encoders. Use `createSecurityHeaders()` per response; never assume these helpers alone prevent XSS or CSRF. Cookie-authenticated unsafe methods should verify both the origin (when supplied) and a session-bound CSRF token.

```ts
import { createCsrfProtection, evaluateCors, createSecurityHeaders, createRateLimiter, serializeCookie } from '@zeruxjs/security';
const csrf = createCsrfProtection({ secret: process.env.CSRF_KEY! }); // >=32 bytes
const token = csrf.issue(sessionId);
csrf.verify(token, sessionId);
const cors = evaluateCors(request.headers.origin, { origins: ['https://app.example'], credentials: true });
const headers = createSecurityHeaders({ hsts: true }, true);
const limiter = createRateLimiter({ max: 100, windowMs: 60_000 });
```

CORS is not authentication. The legacy createRateLimiter is in-memory and not distributed; the opt-in atomic-store API below is separate. `ensurePathInsideRoot` is a lexical containment check, not a symlink-safe filesystem authorization check. Configure CSP and origin policy for your application. Secrets must come from a secret manager or protected environment variables.

## Destination-specific output encoding

| Public helper              | Supported destination                                        | Boundary                                                                 |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `escapeHtmlText`           | HTML text node source                                        | Encodes markup; does not accept arbitrary HTML                           |
| `escapeHtmlAttribute`      | Fixed, quoted, inert HTML attribute                          | Never event handlers, srcdoc or arbitrary style/URL policy               |
| `validateNavigationUrl`    | HTTP(S) navigation URL                                       | Validate first, then attribute-encode for an HTML sink                   |
| `serializeJavaScriptValue` | One JSON-compatible JavaScript value in an HTML script block | Never interpolate into an existing JS string/template or event attribute |
| `serializeCssString`       | One quoted CSS string token for an inert string property     | Not stylesheet, selector, property-name or url() sanitization            |

Use public imports from `@zeruxjs/security/encoding` for these pure helpers without
Node crypto/path dependencies. They are also exported at the root. Output encoding
is not a generic sanitizer, HTML parser, authorization check or SQL parameterizer.
`validateNavigationUrl` rejects control/space/backslash obfuscation, credentials,
protocol-relative references and non-HTTP(S) schemes. Relative references require
an explicit trusted baseUrl. Optional allowedOrigins contains at most 64 canonical
HTTP(S) origins. This is navigation policy, **not SSRF/DNS/redirect egress control**.
Apply a separate outbound policy before fetching a configurable URL.

```ts
import { validateNavigationUrl, escapeHtmlAttribute,
  serializeJavaScriptValue } from '@zeruxjs/security/encoding';
const href = escapeHtmlAttribute(validateNavigationUrl('/help?q=1', {
  baseUrl: 'https://example.test', allowedOrigins: ['https://example.test']
}));
const data = serializeJavaScriptValue({ text: '</script><script>untrusted</script>' });
// href is for a quoted href; data is for one JS value, e.g. after a fixed `=`.
```

Script serialization escapes `<`, `>`, `&` and U+2028/U+2029 so data cannot close
an enclosing script element. Unsupported top-level JSON values, cyclic values,
BigInt or throwing serialization callbacks reject with a redacted TypeError.
JSON's ordinary omission/coercion rules still apply to nested values. Getters and
toJSON are trusted executable application code. CSS serialization hex-escapes
non-alphanumeric code points within quotes; NUL becomes replacement character.
It caps input at 65536 UTF-16 code units. It does not make arbitrary CSS safe.
Attribute encoding is still required when placing a CSS token into an HTML
attribute; prefer fixed classes and constrained values over dynamic inline CSS.
See [OWASP's context guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

### Legacy imports and migration

`escapeHtml` remains an alias for the HTML text encoder, with the same valid-input
output. It is not safe by itself for a URL, script or CSS destination. Migrate those
call sites to the explicit helper for their destination. `serializeJsonForScript`
retains its legacy null/undefined-to-`{}` behavior; use serializeJavaScriptValue when
JSON null must stay null. Serialization failures now use a generic error rather
than reflecting a callback's private message. `sanitizeIdentifier` is lossy
normalization, not validation, identity or authorization; collisions are possible.
Its fallback is now normalized too, with `item` if nothing safe remains. Replace
unsafe legacy fallback identifiers with deliberate unique application IDs.

## Explicit cryptographic policies

`@zeruxjs/security/crypto` exposes the same crypto APIs as the root. It is Node-only
and uses Node crypto/OpenSSL, not custom cipher/hash implementations. No environment
secret is read and no service starts on import. Callers supply keys explicitly.

| Purpose                              | API                          | Policy                                                                                    |
| ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Reversible records                   | `createEncryptionKeyring`    | AES-256-GCM only, exactly 32-byte keys, random 12-byte IV, 16-byte tag                    |
| Shared-secret message authentication | `createMessageAuthenticator` | HMAC-SHA-256 only, exactly 32-byte keys; not public-key signatures or encryption          |
| Data digest/fingerprint              | `hashData`                   | SHA-256 (default), SHA-384 or SHA-512; hex output; not password hashing or authentication |
| Equal-length byte comparison         | `timingSafeEqualBytes`       | Native timingSafeEqual after bounded length/type checks                                   |
| Password hashing                     | Existing `@zeruxjs/auth` API | Auth owns scrypt/password pepper, verification and legacy migration                       |

There are no MD5/SHA-1 password APIs or custom noncryptographic checksums here.
Do not use a fast data digest or HMAC in place of a password KDF. This allowlist
is not full Node crypto/JOSE/vendor parity; encrypted/authenticated records below
are package formats, not JWT/JWE. Node/OpenSSL algorithm availability remains an
environment prerequisite. See [Node crypto documentation](https://nodejs.org/api/crypto.html).

```ts
import { randomBytes } from 'node:crypto';
import { createEncryptionKeyring } from '@zeruxjs/security/crypto';

// Demonstration only: persistent records require a stable key from a secret store.
const ring = createEncryptionKeyring({ current: { id: 'key-1', key: randomBytes(32) } });
try {
  const record = ring.encrypt('private text', 'tenant-7:document-42');
  const plaintext = ring.decrypt(record, 'tenant-7:document-42').toString('utf8');
} finally { ring.destroy(); }
```

Both factories take current `{id,key}`, up to four previous entries, and optional
maxBytes (default 1 MiB, positive safe integer at most 16 MiB). IDs are public
1–64-character ASCII alphanumeric/underscore/hyphen labels, unique within the ring;
never put secrets or personal data in IDs. Keys must be cryptographically random
bytes from protected configuration, not passwords padded to length. The ring
copies caller-owned keys; caller mutation cannot change an active ring. Use
independent keys for encryption and message authentication. No fallback key or
automatic key derivation is supplied.

Encryption returns `{v:1,alg:'A256GCM',kid,iv,tag,ciphertext}` with canonical unpadded
base64url fields. Authentication returns `{v:1,alg:'HS256',kid,tag}`; pass the original
message separately to verify. A required nonempty context is at most 1024 UTF-8
bytes. Domain, version, algorithm, key ID and context are authenticated; context
mismatch fails. Use a stable context derived from **server-verified** tenant/object
identity. The context, ciphertext, MAC and nonce are not permission grants.

Decrypt accepts an unknown record, validates its exact fields/version/algorithm,
IV/tag lengths and canonical encoding, then authenticates before returning any
plaintext. Unauthenticated update buffers are cleared on failure. Malformed,
unknown-key, wrong-context and tampered records throw the same SecurityRecordError
without keys, plaintext or record contents. verify returns false for malformed or
mismatched authentication records. Invalid configuration, input size or context
throws; native backend failures propagate as SecurityCryptoError with a trusted
server-side cause. Never serialize causes/stacks to clients. Timing-safe comparison
accepts at most 1 MiB per byte input; differing/invalid lengths return false. It
does not hide lengths or make an entire surrounding request constant-time.

### Rotation and ownership

Only current keys encrypt/sign; previous keys decrypt/verify. Distribute the new
verification/decryption key to every replica before emitting records under its ID.
Retain retired keys until old records have been re-encrypted or deliberately
expired/revoked; removing a previous key makes those records unreadable/unverifiable.
Do not rename a key ID on stored records: the ID is authenticated. The package does
not persist keys, migrate databases, enforce expiry/replay protection or coordinate
replicas. Random IV generation does not replace deployment-wide volume/rekey
policies. Applications own durable key distribution and authorized record access.

`destroy()` is idempotent, clears owned key buffers and makes further operations
reject. Retain the returned keyring/authenticator owner even for synchronous use; dropping a temporary factory result bypasses its explicit cleanup. Operations are synchronous and own no timer, listener, socket or worker.
Buffer clearing is best effort, not a guarantee that all VM/OpenSSL/caller copies
have disappeared. Caller keys and returned plaintext remain caller-owned.

Auth already uses native scrypt, HMAC and AES-GCM and is not a consumer of this new
record API. Its session wire format/password verification paths remain unchanged;
there is no automatic conversion of auth session blobs into versioned records.
Migrate through the owning auth/session boundary with explicit validation and
reissuance, rather than reinterpreting legacy ciphertext. Configure auth secrets
explicitly in every environment instead of relying on its known development
fallbacks. No auth algorithm/pepper change or forced user-session migration is
performed by installing these helpers.

## Runtime policy tightening and verification

Cookie SameSite and boolean flags, header policy enums and CSP inputs reject
invalid JavaScript/JSON values instead of emitting arbitrary header text. CORS
origin predicates must synchronously return a boolean; Promises/non-booleans reject
rather than being truthy permission. Native async predicates reject before
invocation. HTTP(S) serialized origins are required, and CORS preflight responses
vary on origin/method/requested headers even when denied. Same-origin checks reject
path/query/credential-bearing origin strings; pass canonical origin configuration.
Method/header lists are bounded; configured methods are normalized to uppercase.
These changes intentionally reject unsafe legacy configuration.

CSRF secrets contain 32–4096 bytes and are copied from caller buffers. Session IDs
are bounded to 1024 UTF-8 bytes without controls; token parsing rejects noncanonical
base64url and invalid types. A custom clock must return a nonnegative safe integer
in milliseconds. The existing HMAC/time/session token format is preserved for
valid issued tokens. CSRF tokens can replay until expiry; use host session/origin
policies and do not mistake them for authentication. CSP nonce generation already
uses native randomBytes with a 16–64-byte size bound; valid syntax alone cannot
prove entropy, and a nonce is never authorization.

Run `npm run build` then `node --experimental-strip-types --test test/*.test.ts` in this package. Focused tests
exercise script/style-breaking values, algorithm/key/nonce policies, metadata and
ciphertext tampering, rotation, native-provider failure, timing-safe comparison
results, cleanup, runtime header policies and an offline npm-installed declaration
consumer using the shared TypeScript tooling. No auth source required changes.
The installed tooling and Node crypto support are required; no live provider,
credentials or browser is needed. Browser/proxy enforcement and distributed key
rollouts require their own deployment checks. Tests do not measure constant-time
execution or certify complete XSS/cryptographic system security.

JavaScript-value serialization returns a `JSON.parse(...)` expression, preserving
JSON own-property semantics for names such as `__proto__`. It requires the ordinary
JSON intrinsic in the host script context; it is not a JSON document string or a
JavaScript sandbox. The legacy serializeJsonForScript still returns raw escaped
JSON text. If that legacy output is evaluated as an object literal, special
JavaScript object-literal prototype semantics can differ from JSON.parse. Migrate
untrusted JSON data in JavaScript assignments to serializeJavaScriptValue; existing
legacy raw-JSON consumers keep their valid output format.

## Structural application policy

`@zeruxjs/security/policy` (also exported at the root) provides the Node-only
`createSecurityPolicy`, `createCspHash`, `assertSecurityNonce` and
`SecurityPolicyConflictError`. This is an opt-in composer; existing
createSecurityHeaders/buildContentSecurityPolicy imports remain available.
The low-level header helper additionally accepts validated
crossOriginResourcePolicy, crossOriginOpenerPolicy and crossOriginEmbedderPolicy
values without changing its defaults.

```ts
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { escapeHtmlAttribute } from '@zeruxjs/security/encoding';

// Once per application, from trusted host configuration.
const policy = createSecurityPolicy({
  https: true,
  modules: [{ module: 'reports', resources: {
    'connect-src': ['https://reports.example']
  } }],
  approvals: { reports: { 'connect-src': ['https://reports.example'] } }
});
// Once per response, before headers or the first streamed chunk.
const response = policy.createResponse();
const html = `<script nonce="${escapeHtmlAttribute(response.nonce!)}">console.log('ready')</script>`;
// Set response.headers on the actual HTTP response, then send html.
```

The factory snapshots configuration and returns a frozen composer; response headers
are frozen too. Each createResponse generates a fresh native random nonce. Share
that single response's nonce with trusted renderers for all its streamed chunks;
never regenerate it per chunk, derive it from request headers, reuse it across
responses, or embed it in untrusted content. Commit the complete policy before
streaming. A nonce authorizes selected inline code, not a caller, tenant or action.
Native randomness failures propagate; there is no fallback or reused nonce. The
composer owns no timers, listeners, sockets or other teardown resources.

Defaults are production mode, same-origin resources, denied frames/inline style
attributes, default-src/base-uri/object-src none, form-action self, frame-ancestors
none, nosniff, COOP same-origin, COEP require-corp and CORP same-origin. HSTS defaults
to one year in production but is emitted only with trusted `https: true`; configure
includeSubDomains/preload deliberately. HSTS maxAgeSeconds must be a safe integer
from 0 through 63072000 even when the current response uses HTTP. Request forwarding headers never select
transport, mode or allowances. Existing low-level header defaults stay unchanged.

Supported resource keys are script-src, style-src, img-src, font-src, connect-src,
frame-src, worker-src, media-src, manifest-src and style-src-attr. Sources support
self/none CSP keywords (including their quotes), canonical exact HTTPS origins,
and WSS origins for connect-src. Development additionally supports HTTP/WS origins.
No wildcards, credentials, paths, arbitrary schemes, raw nonce strings, eval or
unknown directives are accepted. `data:` is supported only for img-src/font-src.
Host-only unsafe-inline styles/attributes are available only in development.
For exact inline text use `createCspHash(text, 'sha256')` (also sha384/sha512), passing
its `{hash,value}` descriptor to script-src/style-src. Whitespace changes the hash.
`nonceDirectives` defaults to script-src, can include style-src, or be empty to
turn nonce generation off. Explicit none cannot coexist with sources or a nonce.
Lists/modules/approvals are bounded to 64 entries and composed CSP to 16 KiB.
Controls, whitespace-bearing origins and unknown configuration keys reject.
This intentionally supports a constrained CSP subset, not every CSP feature.

Modules declare resource needs and optional exact isolation requirements or
requiresNonce. The host approves each extra source through its own base resources
or exact per-module approvals. One module's approval never authorizes another.
An explicit host none is a hard prohibition, even with an approval; to permit
frames, the host must deliberately change frame-src first. Registration order does
not change sorted directives or diagnostics. Conflicts throw
SecurityPolicyConflictError with frozen `{module,directive,reason}` entries rather
than silently dropping requirements or weakening isolation. IDs are public labels;
do not put secrets in them. Diagnostics omit requested source values. Invalid
configuration throws TypeError/RangeError before headers are emitted.

Only the host controls frameAncestors. It defaults to none; self emits XFO
SAMEORIGIN, none emits DENY. Exact external ancestors require CSP and omit XFO,
which cannot express that allowlist. developmentFrameAncestors explicitly permits
self plus exact configured origins only with mode development; supplying it in
production throws. Module requirements and untrusted Origin/Referer/Host headers
cannot grant framing. Set CSP as an HTTP header: frame-ancestors does not work in
a meta policy. Multiple independently emitted CSP headers intersect; the composer
does not rewrite a proxy's policy.

### Isolation and development tooling

COOP same-origin separates cross-origin opener relationships and may affect popup
flows. COEP require-corp requires compatible CORS/CORP responses for cross-origin
resources and compatible embedder policies for child frames. CORP governs no-cors
resource use; it does not replace CORS or authorization. worker-src controls worker
script loading, while workers and their fetched assets still need compatible
response policies. Secure-context, ancestor and browser requirements also apply;
emitting these headers alone does not guarantee crossOriginIsolated. Choose
host isolation explicitly for the application; modules cannot negotiate it weaker.
See the [HTML isolation model](https://html.spec.whatwg.org/multipage/browsers.html),
[Fetch CORP checks](https://fetch.spec.whatwg.org/#cross-origin-resource-policy-header)
and [CSP specification](https://www.w3.org/TR/CSP/). Browser failures are diagnostics,
never a signal to automatically disable protections.

Zforge uses explicit development-only `devtools.frameAncestors` configuration;
allowedDomains and request origins are not framing grants. Production documents
retain strict framing/isolation. Zhost leaves enforced-CSP and explicitly flushed
HTML untouched. An application choosing manual `injectDevClient` may pass its
response-owned nonce; it must also explicitly authorize the client's styles,
WebSocket/connect and frame resources. A script nonce alone cannot authorize all
those resources. No application policy is automatically widened for an overlay.
Focused composer/consumer tests cover conflicts, CRLF rejection, nonce isolation,
production framing, backend failure and streaming/header preservation. Actual
browser/proxy enforcement requires deployment checks; these tests do not run a browser.

## Atomic endpoint rate limits

```ts
import {createDistributedRateLimiter, rateLimitHttpResponse} from '@zeruxjs/security';
import {createRedisCacheHelper, createRedisRateLimitStore,
  type RedisCacheClient} from '@zeruxjs/cache-redis';

export function createLoginAdmission(client: RedisCacheClient, secret: Uint8Array) {
  const helper = createRedisCacheHelper(client, {ownClient: false, commandTimeoutMs: 500});
  const store = createRedisRateLimitStore(helper, {namespace: 'app_login',
    maxKeys: 10000, maxWindowMs: 60000, ownHelper: true});
  const limiter = createDistributedRateLimiter({store, secret, ownStore: true,
    policies: {login: {max: 5, windowMs: 60000, failure: 'closed'}}});
  return {
    async handle(verifiedIdentity: {tenant: string; subject: string}) {
      return rateLimitHttpResponse(await limiter.check('login', verifiedIdentity));
    },
    close: () => limiter.close()
  };
}
```

Create once per application/generation and close from the host lifecycle. An undefined handle response means continue the application handler; denial returns safe JSON with 429/Retry-After, or 503 when accounting is unavailable/capacity-bound. This example owns the store/helper wrapper while leaving the injected client open. Install/configure Redis explicitly; nothing starts on import. The secret must be a host-supplied shared 32-byte key, not a CSP nonce or an authorization token.

The host authenticates/authorizes the tenant and subject before checking sensitive endpoints. Inputs are 1–512 UTF-8 bytes without controls. The limiter reuses the package's context-bound HMAC-SHA-256 authenticator over an unambiguous tuple of endpoint, max/window policy, tenant and subject. Only opaque 43-character digests reach the store. Processes must share the same secret, endpoint policy and store namespace; secret/policy rotation creates new accounting identities and can reset limits. Do not hash a caller-chosen tenant as a substitute for verifying it.

### Semantics and capabilities

AtomicRateLimitStore requires capability atomic-fixed-window-v1 and an explicit process/distributed scope, with claim performing accounting/expiry/cardinality atomically. Ordinary cache get/set, conditional void set and counters alone do not implement that contract. createDistributedRateLimiter requires distributed scope by default; local testing requires requireDistributed:false explicitly. No unavailable distributed store ever falls back to independent memory counters.

This is a first-success-anchored **fixed window**, not a token bucket or rolling window. max is the entire burst allowance in windowMs; accepted weight consumes capacity, denied claims do not. At now >= resetAt a new claim starts a new window. Weights/max are integers 1–1000000; windows are 1–86400000 ms. Fixed-window boundaries can allow adjacent bursts; choose a different store/algorithm contract if smooth refill is required. Existing createRateLimiter and zhost's separate local token bucket retain their own APIs. Rate quotas do not measure in-flight concurrency: keep a separate host concurrency gate (zhost uses 503 for that admission limit).

Up to 32 endpoint policies have bounded static names and an explicit failure:'open'|'closed'. Outage/timeout/operation-overload either allows a degraded result or returns 503 according to that policy; quota denial is 429 and store-cardinality exhaustion always 503. No failed claim is replayed: timeout may have consumed quota. Results carry remaining, server/store now, Unix-ms resetAt and ceil((resetAt-now)/1000) Retry-After seconds, minimum one on denial. Fail-open is an explicit availability choice unsuitable for some auth/abuse controls.

createMemoryRateLimitStore is an optional process-scoped reference, with maxKeys default 10000 (maximum 100000), no eviction of live counters, lazy expiry and an injected nondecreasing clock. It never claims distributed accounting. The legacy memory limiter remains synchronous and process-scoped. Memory state is bounded, not durable or shared across workers.

### Identity, failure and cleanup

resolveRateLimitIp(remoteAddress, {trustedProxies, forwardedFor}) validates IP literals. It ignores forwardedFor by default, even if forged. Only an exact configured direct peer (at most 32 IPs) may supply one verified IP; comma chains/ports/invalid values reject. This is a deliberately narrow single-hop adapter, not CIDR/proxy-chain discovery. The host must configure its proxy to strip/rewrite forwarding headers and normalize socket addresses consistently. A raw request header, subject digest or rate-limit allowance is never authorization.

maxPending defaults to 64 (1–1024), timeoutMs to 1000 (1–120000). AbortSignal/deadlines bound caller wait while uncooperative store work retains capacity until settlement. Caller cancellation rejects; configured outage policy applies to store deadlines/errors. Close rejects stale checks, signals/drains accepted work and closes only an explicitly owned store, then destroys its private MAC key snapshot. Uncooperative custom stores can delay close. onDecision emits only a configured endpoint label, fixed outcome and duration; no tenant/subject/IP/cause. Hook failures are isolated and counted, with at most 16 pending async hooks and dropped-record counters. The host owns hook/exporter cleanup. There is no import-time telemetry or automatic application/proxy restart.

### Redis strategy and acceptance limits

The cache-redis adapter executes one fixed Lua script using Redis TIME. A count hash and expiry sorted set share an explicit {namespace} Cluster tag, giving atomic claims for that partition. Namespace is 1–64 safe ASCII identifier characters; maxKeys is 1–100000 and maxWindowMs 1–86400000. Claim windows cannot exceed that store TTL bound. Cleanup visits at most 128 expired members per claim; live counters are never evicted to admit a new subject. Excess expired backlog can conservatively reject capacity until later cleanup. Both keys receive bounded TTL; after inactivity they expire without background workers. One partition uses one Cluster slot and can become a hotspot; partitioning changes the scope of cardinality limits.

Use a dedicated limiter namespace/ACL with EVAL/TIME/hash/sorted-set/expiry permissions, compatible Redis scripting, **noeviction** and an explicit persistence/failover policy. One missing state key or a type/cardinality mismatch fails rather than repairing live accounting. Losing both keys, a Redis restart, eviction or stale failover can reset quota; this is not consensus or an authorization database. Never share limiter keys with cache.clear()/FLUSHDB, administrative mutation or independently configured stores. A script error is not a rollback guarantee for earlier Redis commands. Lua is bounded and source-reviewed; only live multi-client checks establish deployment atomicity. See [Redis script semantics](https://redis.io/docs/latest/develop/programmability/eval-intro/) and [server time](https://redis.io/docs/latest/commands/time/).

Opt-in live multi-client/TTL/state-loss checks require CACHE_RATE_LIMIT_REDIS_URL pointing to an isolated disposable Redis. Loopback/mocked EVAL fixtures verify framing/deadlines, not native script execution, failover, eviction or Cluster distribution. No service is started automatically and no credentials are generated.

## JWT signing, verification and JWKS

`@zeruxjs/security/jwt` uses maintained **jose 6.2.13** for signed compact JWTs. It is separate from encrypted `/crypto` records, password hashing and authorization. No network starts on import; JWKS requires an explicit configured transport. The same APIs are root exports.

```ts
import { randomBytes } from 'node:crypto';
import { createJwtSigner, createJwtVerifier } from '@zeruxjs/security/jwt';

// Ephemeral local example only. Production keys belong in an application-owned secret/keyring.
const key = { kty: 'oct', k: randomBytes(32).toString('base64url'), kid: 'active', alg: 'HS256' as const };
const signer = createJwtSigner({ key, kid: key.kid, algorithm: 'HS256',
  issuer: 'https://issuer.example', audience: 'example-app', type: 'JWT' });
const verifier = createJwtVerifier({ keys: [key], policy: {
  algorithms: ['HS256'], issuer: 'https://issuer.example', audience: 'example-app', type: 'JWT',
  requiredClaims: ['exp'], subject: 'required', jti: 'optional', maxTokenAgeSeconds: 300,
} });
try {
  const token = await signer.sign({ scope: 'read' }, { subject: 'user-1', ttlSeconds: 60 });
  const claims = await verifier.verify(token);
  // Validate application claims and current tenant permissions before granting access. Never log token/claims.
} finally { await signer.close(); await verifier.close(); }
```

Supported algorithm policy: HS256/384/512 (local symmetric secrets only, minimum matching hash-bit length); RS256/384/512 and PS256/384/512 (RSA 2048–8192 bits); ES256/P-256, ES384/P-384, ES512/P-521; and the registered **EdDSA** algorithm with **Ed25519** keys. Other curves/algorithms, `none`, ES256K, Ed448 and ML-DSA are deliberately unavailable through this API, even if a future library/runtime supports them. Runtime cryptography must support the selected variant. Real-key checks exercised every declared variant on Node 24; this is not certification for every Node/OpenSSL/runtime combination.

Every verification policy explicitly declares `algorithms`, exact `issuer`, `audience` (one or up to eight accepted values), expected `type`, `requiredClaims`, `subject` and `jti`. Subject is `optional`, `required` or `{equals}`. JTI is `optional`, `required` (presence only), or `{consume,maxTtlSeconds}` with an application-owned **atomic** `JwtReplayStore`; ordinary cache get/set cannot prevent replay across instances. Replay keys are SHA-256 digests of issuer/audience/type/JTI, never raw JTIs. Consumption happens after signature/claim validation, forces `exp`, and requires explicit bounded retention (at most seven days, including clock tolerance). A timeout may leave a consumed JTI; no transparent replay is attempted. The replay store stays host-owned.

Issuer/audience are always required by verification. `exp`/`nbf` are enforced when present, and every present `exp`/`nbf`/`iat` must be a nonnegative safe **integer** NumericDate through year 9999; fractional dates are intentionally rejected. Missing `exp` is permitted only if your required-claim policy allows it. `iat` alone is not expiration: only `maxTokenAgeSeconds` (1–604800) requires and checks token age/future issuance. Clock tolerance defaults to zero and is explicitly bounded at 120 seconds. `now()` returns Unix milliseconds. Application claim schemas, permission freshness and revocation remain caller-owned.

The protected header may contain only `alg`, `kid`, `typ`; `kid` is required, bounded and selects exactly one matching algorithm/key. Type is exact/case-sensitive and required by default. `requireType:false` explicitly allows a missing `typ` for profiles such as OIDC; a present wrong type still fails. Headers with `jku`, `x5u`, inline `jwk`, unsupported critical extensions or token-directed key URLs are rejected. JWK key type/curve, `use:'sig'` and verify-only `key_ops` (when present) are checked before import. Asymmetric private verification keys and ambiguous/duplicate kids are rejected. `verifyWithHeader` returns the verified payload plus a frozen `{alg,kid,typ?}` snapshot for protocol-specific checks; never treat decoded-but-unverified claims as identity.

`createJwtSigner` requires an explicit algorithm, kid, signing JWK, issuer, audience and type. It accepts local octet secrets or the corresponding private asymmetric JWK; public-only asymmetric keys and conflicting key metadata are rejected. `sign(customClaims,{subject,ttlSeconds,jti?})` owns registered issuer/audience/subject/iat/exp/JTI fields and rejects attempts to override them. Explicit lifetime is 1 second through `maxLifetimeSeconds` (default 3600, maximum seven days). Claims are bounded JSON (8 KiB, depth 12, 256 nodes); accessors/functions/prototype keys are denied. Signed JWT content is readable, not encrypted: never put passwords, provider tokens or private application payloads in it.

For rotation, distribute new verification keys first, switch the issuer's configured kid/key, then retain old verification keys until all accepted token/replay lifetimes expire (or revoke early deliberately). Static key sets accept at most 16 unique kids. Do not reuse a kid with different material. HMAC secrets must never appear in public JWKS or browser manifests. A signer/verifier snapshots configured material; `close()` releases owned key references after pending operations settle. JavaScript strings/native crypto handles cannot be promised secure zeroization.

### Bounded remote keys and failures

`createJwtJwks({url,allowedUrls,transport,...})` accepts one exact allowlisted HTTPS URL (1–8 entries), with no credentials, query or fragment. Redirects are forbidden and returned response URLs must match. Transport is mandatory; **the host must enforce egress, DNS/IP authorization and TLS policy**. URL syntax alone is not SSRF/DNS-rebinding protection. No discovery, token-supplied URL or speculative key-server fallback occurs.

JWKS responses must be JSON with 1–16 unique-kid asymmetric signing keys. The body is streamed with a UTF-8 byte budget (default 64 KiB, maximum 256 KiB), response/content-type/length checks and reader cancellation/release on failure. One fetch is in flight; at most 32 waiting callers by default (`maxPending`, maximum 256). Cache lifetime defaults to 60 seconds (maximum 10 minutes), cooldown to one second (maximum one minute), and fetch timeout to one second (maximum 10 seconds). Unknown kids may trigger a cooldown-limited refresh; failed/expired caches do not authorize stale keys. No cache-control response can widen these limits. A freshly rotated unknown kid during cooldown can fail temporarily instead of causing a fetch storm.

Verifier tokens are capped at 16 KiB; verification pending work defaults to 32 (maximum 256) and timeout to 2 seconds (maximum 120 seconds). Signer pending work has the same configurable count bound. Verification accepts an optional signal/absolute Unix-millisecond deadline. Cancellation rejects the caller, but retains its native pending slot until actual settlement. Store/network transports must cooperate; `close()` drains and may wait for an uncooperative dependency. Set `ownJwks:true` only when the verifier owns that source; otherwise close it separately. JWKS fetch state and verification diagnostics contain only counts/closed state, not URLs, tokens or keys.

Fixed `JwtVerificationError.code` values are `JWT_REJECTED`, `JWT_UNAVAILABLE`, `JWT_OVERLOAD`, `JWT_CLOSED`. Messages never include claims/keys/URLs. Original JOSE/network/replay causes remain private server diagnostics and must not be serialized to clients. Issuance never grants authorization automatically. See [JOSE verification options](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md) for the maintained primitive; this wrapper intentionally narrows its supported profiles.
