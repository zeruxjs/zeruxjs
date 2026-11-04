# @zeruxjs/share

Safe browser sharing, fallback handling, social share links and HTML metadata.

```ts
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
[public-import configuration example](examples/short-links.ts). There is no
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
`/s/`, or `/` for a dedicated short-link host). No incoming Host or Forwarded header
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
api/admin/auth/assets/_actions and host `reservedPaths` are denied. Traversal,
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
