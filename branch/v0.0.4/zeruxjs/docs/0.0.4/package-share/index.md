# Sharing and metadata

Use native share, clipboard fallback and safe public links without surprising cancellation behavior.


## User-driven sharing

```ts
import { createShareController } from '@zeruxjs/share';
const controller = createShareController({
  share: data => navigator.share(data),
  writeText: text => navigator.clipboard.writeText(text)
});
// Invoke from an explicit user gesture:
const result = await controller.share({ url: 'https://example.com/article', title: 'Article' });
```

Native share/clipboard access needs browser permissions and usually a user gesture. Unavailable/unsupported/denied native sharing can fall back to clipboard. User AbortError cancellation must not unexpectedly copy data.

## Public URLs

URLs must be credential-free HTTP(S). Do not share session tokens or private signed links accidentally. Social links use noopener/noreferrer, and the package never opens a new browser tab automatically.

## Metadata

createShareMetadata creates escaped public metadata, not a complete SEO strategy or publication workflow. Choose the canonical URL and preview image policy in the application; private content requires separate access control.

## Install and select the integration

```sh
npm install @zeruxjs/share@0.0.4
```

There is no automatic `share` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Keep native sharing behind an explicit user gesture and supply validated credential-free HTTP(S) URLs. Inject share/clipboard capabilities into a controller when testing or using a custom environment. Use the outcome to tell whether a share, copy or cancellation occurred instead of assuming every resolved call sent content to another app.

## TypeScript: inputs, results and ownership

```ts
import { createShareController } from '@zeruxjs/share';

type Inputs = Parameters<typeof createShareController>;
type Result = Awaited<ReturnType<typeof createShareController>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createShareController>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Do not copy to clipboard after a user AbortError cancellation. Native share and clipboard APIs can be unavailable or denied; present a usable manual link as fallback. Third-party share links need noopener/noreferrer, and metadata helpers must escape titles/descriptions. No configuration key automatically adds share buttons to the application.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ShareData

| Field   | Accepted type/value | Optional |
| ------- | ------------------- | -------- |
| `url`   | `string`            | No       |
| `title` | `string`            | Yes      |
| `text`  | `string`            | Yes      |

### ShareEnvironment

| Field       | Accepted type/value               | Optional |
| ----------- | --------------------------------- | -------- |
| `share`     | `(data:ShareData)=>Promise<void>` | Yes      |
| `writeText` | `(text:string)=>Promise<void>`    | Yes      |
| `open`      | `(url:string)=>void`              | Yes      |

### ShareCapabilities

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `native`    | `boolean`           | No       |
| `clipboard` | `boolean`           | No       |

## Add persistent short links separately

The server-only `@zeruxjs/share/server` entry creates an explicit service over a
host-owned durable create-only/CAS store. It does not change browser sharing or
start a listener. The public-import example accepts host store/session-authorizer
callbacks; the host mounts the resolution handler and closes the service before
its borrowed database. No management HTTP endpoints are mounted automatically.

Default links use 144-bit random slugs, 302/no-store, bounded expiry and owner/tenant
checks. Custom slugs reserve a global public namespace atomically; expired/revoked
slugs must never be recycled. Reserved application/framework paths and destination
origin/path policy prevent local collisions and unapproved redirects. Management
requires fresh verified session permissions, revision CAS and host HTTP CSRF/rate
controls. A short URL does not authorize access at its destination.

Permanent 301/308 is explicit and permitted only for nonexpiring, uneditable,
non-revocable records with an approved cache lifetime. A cached redirect cannot be
recalled by editing storage. Temporary links remain no-store. Unknown write
acknowledgements require authorized reconciliation, not automatic retry.

Optional click collection is consent-gated and pseudonymous, emits no raw recipient
or destination, and cannot replace a valid redirect when analytics fails. Close
aborts/drains actual store/analytics work; callbacks and stores stay host-owned.
Tests exercise duplicate/CAS races through two real SQLite pins on a disposable
file, plus browser fallback and failure fixtures. Production crash recovery,
mobile share-sheet behavior and session/consent/proxy deployment are not inferred
from those checks.

The optional `@zeruxjs/share/sqlite` store borrows a native synchronous connector,
requires explicit host persistent-file qualification and initializes its table only
when requested. Create-only/CAS work uses the existing database transaction pin;
there is no independent transaction engine or implicit connector ownership.

Drain the short-link service before disconnecting its borrowed database or store.
Caller timeout or cancellation stops waiting, but does not prove a storage rollback:
unsettled native operations retain their capacity until actual completion. Optional
analytics has separate bounded work and cannot block a valid redirect on failure.
Browser sharing controllers own no listeners and need no invented teardown method.


## Public entry points

Manifest reference for `@zeruxjs/share@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./server": "./dist/server.js",
    "./*": "./*",
    "./sqlite": "./dist/sqlite-store.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@zeruxjs/db-sqlite": "0.0.4"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/share

Safe browser sharing, fallback handling, social share links and HTML metadata.

```ts
import { createShareController, createShareMetadata } from '@zeruxjs/share';

const controller = createShareController({
  share: data => navigator.share(data),
  writeText: text => navigator.clipboard.writeText(text)
});
const outcome = await controller.share({url:'https://example.com/post',title:'Post'});
const tags = createShareMetadata({url:'https://example.com/post',title:'Post',image:'https://example.com/image.png'});
```

The browser `shareOrCopy()` function prefers `navigator.share`, falls back to clipboard only for unavailable/not-supported/denied share operations, and **does not copy after an `AbortError` user cancellation**. It never auto-opens browser tabs. `shareLinkAttributes` sets `rel="noopener noreferrer"` on third-party links, and metadata/canonical tags escape markup. URLs must be credential-free HTTP(S). Native share/clipboard APIs typically require user gestures and permissions.

## Opt-in persistent server short links

`@zeruxjs/share/server` adds `createShortLinkService`. Browser/root imports remain
Node-free and do not import the server's crypto/store code. Existing deep paths
remain resolvable; the server entry is explicit. See the
[public-import configuration example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/examples/short-links.ts). There is no
listener, package scanning, automatic framework service or default memory store.

Supply an application-owned `short-links-cas-v1` store with `durable:true` and
linearizable `reserve`, `read`, `compareAndSwap` methods. Reservation is atomic
create-only across all instances in a public origin/namespace. Keep a reservation
or tombstone **forever** even after expiry/revocation; recycling a slug can send an
old shared URL to another owner's content. TTL deletion alone is not a compatible
store. CAS compares the expected revision and atomically replaces the whole record.
A declaration of durability is a contract, not proof of a production backend.
Host migrations, encryption, retention, backups and database cleanup stay host-owned.

The package-local fixture uses a disposable SQLite file, two connectors and real
public `transactionSync` pins for create-only/CAS checks, with no await across a
native transaction. It exercises the optional store implementation; it is not multi-process/crash-recovery qualification. The verified shared-auth contract can
supply the host session check; no cookie/header is automatically authenticated here.

### Creation, access and namespaces

Configure a fixed absolute HTTP(S) origin and slash-terminated prefix (default
`/s/`, or `/branch/v0.0.4/` for a dedicated short-link host). No incoming Host or Forwarded header
chooses the origin. Requests whose URL origin/explicit Host do not match return
421; normalize proxy URLs only at an independently verified host boundary.
Never copy unverified forwarded headers into that boundary. Root mounting requires
the host to check route precedence and reserve all existing application paths.

`authorize(context,operation,signal)` is mandatory on create/read/edit/revoke. It
must verify the current session, tenant, operation permission and recent proof
for sensitive edits/revocation. Return opaque `{tenant,subject}` or null. Tenant
and owner are stored from that result, never from create input. Each management
read/write checks the stored tenant and owner; trusted `manageTenant:true` grants
management only within that same tenant. The service supplies no management HTTP
routes: the host owns method/body limits, origin/CSRF, rate admission and error
responses when exposing these methods.

`create(context,{destination,slug?,expiresAt?,status?,editable?,revocable?})` uses
144 random bits (24 URL-safe characters) by default. Explicit slugs are 3–64
URL-safe characters. IDs are public locators, **not bearer authorization**. A custom
slug collision returns CONFLICT; generated collisions retry at most three times,
and no retry follows an unknown storage acknowledgement. Framework names such as
api/admin/auth/assets/\_actions and host `reservedPaths` are denied. Traversal,
encoded path separators and nested slug paths reject. Slugs are case-sensitive;
reserved paths are protected case-insensitively. Names are globally reserved within
the configured public namespace, not reusable per tenant.

Destinations must be credential-free HTTP(S), under an exact configured
`allowedOrigins` list; no wildcard origins, unsafe schemes or request-derived target
is accepted. Same short-link origin/prefix targets reject to prevent local link
chains, including the whole short domain for root mode. A synchronous host
`allowDestination(normalizedUrl)` may additionally restrict paths/query parameters
and is rechecked at resolution. It must return literal true; failure blocks the
redirect. Keep allowed destination hosts trusted: their own open redirects or
later responses are outside this service's control. No destination is fetched or
probed. Destination authentication, permissions and signed-URL handling remain
separate application policies. Never log stored sensitive destinations.

### Expiry, edit policy and cached redirects

Default policy is **302**, editable/revocable, expiring after 30 days. Configure
defaultTtlMs/maxTtlMs (maximum one year) deliberately; default must fit maximum.
An explicit expiresAt must be a future bounded millisecond timestamp, or null for
no expiry. A record expires when `now >= expiresAt`; missing, expired and revoked
records all resolve to body-free no-store 404. Expiry uses the trusted server clock,
so replicas must synchronize clocks. Reads for an authorized owner may still
inspect an expired/revoked record for reconciliation.

301/302/307/308 are supported. Temporary 302/307 responses use no-store. Permanent
301/308 creation requires all of: explicit `permanentCacheSeconds`, expiresAt:null,
editable:false and revocable:false. Such records cannot be edited/revoked through
this API. Changing server policy can deny later requests, but it cannot recall a
redirect already cached by a browser/proxy. Permanent status is therefore not a
default or a way to create an expiring/retargetable campaign link. See the
[HTTP redirect semantics](https://www.rfc-editor.org/rfc/rfc9110.html); public
resolution here admits GET/HEAD only, preventing accidental write/body forwarding.

`edit(context,slug,{destination,expectedRevision})` changes only the destination;
expiry/status/ownership/cache policy do not change. Stale CAS revisions return
CONFLICT. Noneditable, expired or revoked records reject edits. `revoke` requires
the current revision and revocable policy, writes an irreversible tombstone, and
never frees the slug. No silent last-writer-wins or physical delete is supplied.

Store/dependency failures produce redacted UNAVAILABLE errors; writes whose
acknowledgement is lost have outcome unknown and may include uncertainSlug for an
authorized follow-up read. Do not automatically recreate or retry that operation.
Redirect failures return body-free no-store 503; stored error causes are private.
No successful redirect is fabricated when storage is unavailable.

### Optional consented click collection and cleanup

Analytics is off unless explicitly configured. Supply a 32-byte private key,
synchronous consent(request) and record(event,signal). Consent must return literal
true; this is host consent policy, not a browser claim inferred by the service.
Only GET redirects are counted, never HEAD. Events contain schema/action, UTC day
and a keyed link pseudonym—no tenant/owner IDs, destination, IP, user-agent,
recipient, cookies or referrer. Pseudonyms are not anonymization; apply host privacy
and retention policy. Cached redirects may bypass the server and are not counted.

Optional collection errors never replace or delay awaiting a valid redirect.
Collection has separate bounded pending work (16 default, 1–128) and cooperative
abort deadline (1000 ms default, 1–10000). On saturation it drops collection with a
fixed counter rather than queueing identities. Trusted callbacks must avoid
blocking JavaScript synchronously; no timer can preempt arbitrary code.

Management/redirect work defaults to 32 native pending operations (1–128) and a
5000 ms deadline (1–60000). Caller cancellation/deadline returns promptly while
native work retains its slot until settlement. No timeout proves rollback. Await
close to stop admission, abort cooperative work and drain both native store and
analytics promises before closing their host-owned resources. The store is always
borrowed. Noncooperative callbacks can delay close. status reports fixed counters
without identifiers; copied analytics key material is cleared after drain.

### Browser qualification and limits

Native sharing still requires feature detection, user gesture and platform
permissions under the [Web Share API](https://www.w3.org/TR/web-share/). Noncallable
native properties are treated as unavailable; clipboard fallback still occurs only
for unsupported/denied sharing, and user AbortError never triggers a copy. Social
provider names and HTTP(S) URLs validate at runtime. No popup is opened automatically.

Checks include SSR/browser fallback fixtures, duplicate reservations, unauthorized
owner/tenant edits, expiry, stale CAS, malicious/reserved paths, optional analytics
outage and actual-settlement cleanup. The SQLite fixture touches only a disposable
temporary file and closes borrowed connectors separately. Real mobile share sheets,
production durable-store crash recovery, host session/CSRF/consent and deployed
proxy/cache behavior require separate qualification; no live service was used.

### Optional borrowed SQLite store

`@zeruxjs/share/sqlite` exports
`createSqliteShortLinkStore({database,persistent:true,table?,initialize?})` over the
optional `@zeruxjs/db-sqlite` peer. Supply a writable native synchronous connector
with host-managed persistent file storage. `persistent:true` is the host's explicit
qualification: the adapter cannot infer deployment durability from a connector or
make an in-memory database persistent. It must never be used to bless `:memory:`.

The table defaults to share_short_links. Schema creation happens only with
initialize:true; the host owns that table's schema, namespace and migrations.
The implementation uses the database-owned transactionSync pin for atomic
read-before-insert reservation and conditional revision updates, with no await
across BEGIN/COMMIT. It never expires/deletes rows or reuses keys. A malformed
row/multiple CAS update rejects; the native transaction rolls back. Rows are
bounded JSON records, not an encryption layer.

The connector stays borrowed and remains usable after service.close(). Close it
separately after all services drain. Configure busy timeout/WAL/disk policy through
the SQLite package; native synchronous locks can block the JS event loop, so the
service's cooperative timer cannot hard-interrupt them. Real file/disk, backup,
crash, multi-process and cross-machine behavior need host qualification. Other
databases implement ShortLinkStore directly; no independent transaction system or
SQL discovery is added.


## Implementation sources

- [packages/@zeruxjs/share/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/README.md)
- [packages/@zeruxjs/share/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/package.json)
- [packages/@zeruxjs/share/src/server.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/src/server.ts)
- [packages/@zeruxjs/share/src/sqlite-store.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/src/sqlite-store.ts)
- [packages/@zeruxjs/share/examples/short-links.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/examples/short-links.ts)
