# @zeruxjs/files

Multiple named storage connectors for binary objects, including local **S3-lite** and AWS S3-compatible providers (MinIO, RustFS, Ceph, etc.). A common bucket/key API supports uploads, downloads, streaming, ranges, metadata, copies, list, delete, public/private visibility, expiring URLs (where supported), and an optional bounded public-byte cache.

## Storage manager

```ts
import {createFileManager, createLocalStorage, createS3Storage, createFileResponse, uploadFileRequest} from '@zeruxjs/files';

const files = createFileManager({
  defaultStorage:'local',
  cache:{maxEntries:200,maxBytes:32*1024*1024,ttlMs:30_000},
  stores:[
    {name:'local',driver:createLocalStorage({root:'./private/files'})},
    {name:'object',driver:createS3Storage({
      region:'us-east-1',endpoint:'https://s3.internal.example',forcePathStyle:true,
      credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!},
      // Set only after qualifying these operations against your custom backend.
      providerCapabilities:{range:true,multipart:true,createOnlyWrite:true,signedUrls:true},
      encryption:{mode:'AES256'}
    }),allowedBuckets:['uploads']}
  ]
});

const addr={storage:'local',bucket:'uploads',key:'images/photo.webp'};
await files.put(addr,new Uint8Array([1,2,3]),{contentType:'image/webp',visibility:'private'});
await files.stat(addr);
for await(const bytes of await files.read(addr)) {/* consume with backpressure */}
await files.copy(addr,{storage:'object',bucket:'uploads',key:'images/photo.webp'},{ifNoneMatch:false}); // explicit overwrite semantics for streamed S3 copies
await files.close();
```

The same S3 adapter works with **AWS**, **MinIO**, **RustFS** and S3-compatible endpoints using `endpoint`, `region`, `forcePathStyle`, and `allowInsecureHttp` (only for trusted local connections). Third-party implementations may differ in multipart, KMS, ACL, signing and versioning support; verify against your provider. The `publicUrl` method is a URL formatter, not permission authorization.

### AWS credentials and encryption

Credential modes are mutually exclusive: AWS SDK **default credential provider chain**, `profile`, explicit `credentials`, `assumeRole` (STS with source credentials/profile, optional external ID/MFA), or `webIdentity` (OIDC token file + role ARN). An ARN identifies the target role; you still need a trusted source identity allowed to assume it.

For AWS S3, choose `encryption:{mode:'AES256'}`, `encryption:{mode:'aws:kms',keyId:'alias/uploads',bucketKeyEnabled:true}`, or `encryption:{mode:'SSE-C',customerKeyBase64:'...'}`. Use HTTPS for customer-provided encryption keys. Your IAM/bucket/KMS policies must authorize the requested operation. For CloudFront URL signing configure `publicBaseUrl` plus `cloudFrontSigning:{keyPairId,privateKey}`; URL signing does not itself configure your distribution or origin access.

The S3-specific client is accessible to trusted server code via `getClient()`, so advanced AWS operations (bucket policies, lifecycle, versioning, replication, multipart cleanup, etc.) can be done with official AWS SDK commands instead of promising storage-independent abstractions.

### HTTP streaming and authorization

```ts
// In an authenticated GET/HEAD application route:
return createFileResponse(files,addr,request,{
  authorize: async(req,addr,action)=>await canAccessFile(req,addr,action),
  inline:true
});
// In an authenticated PUT/POST application route:
return uploadFileRequest(files,addr,request,{
  maxBytes:16*1024*1024,visibility:'private',
  authorize: async(req,addr,action)=>await canAccessFile(req,addr,action)
});
```

File downloads use Fetch streams, ETags, conditional requests and single byte ranges where the storage backend supports them. Private files require an authorization callback in `createFileResponse`. Never expose a handler without authenticating uploads or checking write permission; `@zeruxjs/auth` may be used in these callbacks. For any file type, prefer attachment download unless a carefully allowlisted inline type is required. Encryption-aware local storage verifies AES-GCM authentication before emitting plaintext; encrypted local objects do not support byte ranges.

Local S3-lite is S3-**style** object addressing; it is _not_ an HTTP server implementing the entire AWS S3 wire API. If you need third-party S3 SDK clients connecting over HTTP, use MinIO/RustFS or another actual S3 server.

Install official AWS SDK modules including `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/credential-providers`, `@aws-sdk/s3-request-presigner`, and `@aws-sdk/cloudfront-signer`. The runtime imports them lazily. SDK integration tests use an injected client, not live cloud infrastructure.

### Streamed request/copy safety

Fetch uploads validate a declared `Content-Length` **inside the stream** and reject missing/excess bytes before storage commits; they do not delete already-committed keys as cleanup. All manager copies, including storage-native copies, enforce destination `allowedTypes` and `maxBytes`. Do not use a signed PUT or raw driver call as a substitute for tenant authorization. S3 streaming create-only writes and create-only native copies are rejected; use explicit overwrite semantics only when your application permits them, or buffer within an application-owned size limit and use conditional PutObject.

## Provider capabilities and migration

`files.getDriver(name).capabilities` is an immutable snapshot. Legacy third-party drivers may omit it; absence/`'unknown'` is not proof of support. Local storage reports ranges (disabled when configured for encrypted objects), no multipart/signed URLs, atomic create-only buffer/stream writes, no native copy, and its configured encryption mode. S3 reports ranges, multipart, presigning and conditional **buffer** PutObject for AWS; custom endpoints default these fields to `'unknown'`. A host may explicitly qualify `providerCapabilities:{range,multipart,signedUrls,createOnlyWrite}` after backend testing. Requests requiring a false/unknown capability fail with `UNSUPPORTED_CAPABILITY` before SDK dispatch. Ordinary full reads and explicit overwrite buffer writes remain available. Encryption lists the configured mode, not a certification of backend/KMS policy support.

The adapter reports `createOnlyStream:false` and `createOnlyCopy:false`: a preflight HEAD cannot make a competing multipart/copy write atomic. Those operations now reject the default `ifNoneMatch:true`; the old best-effort behavior was unsafe. Migrate by using a bounded `Uint8Array` with conditional PutObject or deliberately opt into `ifNoneMatch:false` if overwrite is acceptable. The manager preserves buffer inputs instead of converting them to multipart streams. Cross-store streamed copies and Fetch streaming uploads cannot claim atomic S3 create-only semantics. The Fetch upload helper continues to require create-only writes and consequently rejects this S3 path; it does not silently relax protection.

Signed PUTs preserve metadata/visibility and the default `If-None-Match: *` condition. Callers must send the headers required by the generated signature. Signed PUT cannot enforce `maxBytes`, request signals, object expiry, or manager size/type policies, and rejects those combinations. Read-only managers never issue signed PUTs. Method and lifetime are validated at the manager and direct driver boundaries; signing lasts 1–604800 seconds and temporary credentials may expire earlier. SDK/provider validation, revocation and server time remain authoritative. A signed S3/CloudFront URL is a bearer capability to that backend, not an application login. Requests served through `createFileResponse` still run the configured authorization callback, even if the query string contains this application's signature. Do not accept query signatures as tenant identity.

Custom S3 endpoints must be HTTP(S) origins without credentials, query, fragments or path prefixes. HTTP needs explicit `allowInsecureHttp`; SSE-C needs HTTPS. Optional `allowedEndpointOrigins` approves exact origins (maximum 32); a configured endpoint outside it rejects. Owned clients explicitly disable SDK region redirects (`followRegionRedirects:false`); Node's S3 handler does not follow arbitrary HTTP redirects. Configure the correct region. This is not a DNS-rebinding/firewall defense: the host must restrict DNS/network egress. Injected clients own transport, redirects, credentials and refresh, so passing credential modes/observers alongside `client` rejects rather than pretending to control them. Endpoint fields on an injected client describe host intent; the host must enforce that intent in its transport. `getClient()` remains a trusted-server escape hatch.

## IAM Roles Anywhere and credential diagnostics

The maintained AWS [process provider](https://docs.aws.amazon.com/sdkref/latest/guide/feature-process-credentials.html) supports the official [IAM Roles Anywhere signing helper](https://docs.aws.amazon.com/sdkref/latest/guide/access-rolesanywhere.html). Configure `credential_process` in a **trusted server-owned** AWS shared-config profile using the helper, certificate/private-key paths, role ARN, trust anchor and Roles Anywhere profile ARN. The library never constructs a shell command or accepts certificate material from an HTTP caller. Shared config is executable-code trust: restrict its permissions and install/verify the official helper separately. Do not write helper stderr, raw SDK error causes or credentials to client responses/logs.

```ts
import {createFileManager, createS3Storage} from '@zeruxjs/files';

export async function storeDocument(bytes: Uint8Array) {
  const driver = createS3Storage({
    region: 'us-east-1',
    rolesAnywhere: {profile: 'files-roles-anywhere'},
    onCredentialStatus: ({status, expiresAt}) => {
      // Only fixed status and epoch-millisecond expiry; no keys, profiles or object names.
      void status; void expiresAt;
    }
  });
  const files = createFileManager({stores: [
    {name: 'documents', driver, allowedBuckets: ['documents'], keyPrefix: 'public/', maxBytes: 1024 * 1024}
  ]});
  try {
    return await files.put({bucket: 'documents', key: 'public/example.txt'}, bytes,
      {contentType: 'text/plain', visibility: 'private'});
  } finally { await files.close(); }
}
```

`rolesAnywhere:{profile}` is mutually exclusive with existing default/profile/explicit/assume-role/web-identity modes. It lazily selects official `fromProcess`; it does not install/run the helper on import or manufacture an X.509 signer. AWS SDK client memoization owns refresh based on the helper's `Expiration`; no library timer or background worker is created. The provider/helper owns subprocess lifetime and SDK timeouts; this API adds no hard subprocess cancellation guarantee. Existing `profile`/default chains can also use trusted process profiles. Roles Anywhere does not mean OAuth or a generic S3 password: `@zeruxjs/auth` verifies application principals at the HTTP boundary, while AWS credentials sign backend requests.

`AwsKeyCredentials` now retains optional `expiration:Date`. `monitorAwsCredentials(provider, observer)` validates every resolution, preserves expiration and emits frozen `{status:'valid'|'expiring'|'expired'|'failed', expiresAt?}` records. `expiring` means at most five minutes remain. `resolveAwsCredentials` wraps explicit refresh providers and configured SDK providers; enabling `onCredentialStatus` also observes the default chain. Static credentials without expiry remain compatible. Expired results reject with `CREDENTIALS_EXPIRED`; invalid results/refresh failures reject with `CREDENTIALS_FAILED` and a fixed message. Trusted private error causes are retained; observer exceptions cannot change signing. Notifications occur on provider resolution, not every request or timer tick; no key values, session tokens, certificate paths, bucket/key labels or raw failure messages reach the hook. Refresh failures propagate and do not fall back to another identity; a later request can retry resolution.

`close()` is idempotent and awaits pending client creation. Owned clients are destroyed once; injected clients stay open unless `ownClient:true` explicitly transfers ownership. Closing does not terminate a borrowed SDK credential provider or helper belonging to another client. No provider is automatically selected from an application user's credentials.

Focused offline tests cover conflicting modes, expiry/refresh failure, denied bucket/key, capability checks, signing validation, unchanged HTTP authorization, and owned/borrowed close. A packed consumer verifies public JavaScript/declarations. Disposable S3/MinIO concurrency, actual expired-URL rejection/clock skew, multipart cleanup and live Roles Anywhere certificate/helper refresh require configured infrastructure and are not claimed by SDK fixtures.

## Resumable uploads

`createResumableUploads` is an explicit server-side coordinator over a policy-aware file manager and a private disk journal. It supplies `initiate`, `uploadPart`, `listParts`, `finalize`, `abort`, `previewCleanup`, `cleanup` and draining `close`. It starts no server, timer or cleanup job. Local storage remains S3-style object addressing, not an AWS HTTP protocol implementation.

```ts
import {createHash} from 'node:crypto';
import {createResumableUploads} from '@zeruxjs/files';
import type {StorageManager, UploadIdentity, ResumableUploadOptions} from '@zeruxjs/files';

export async function uploadExample(
  files: StorageManager, privateRoot: string, identity: UploadIdentity,
  authorize: ResumableUploadOptions['authorize']
) {
  const uploads = createResumableUploads({files, root: privateRoot, authorize,
    maxBytes: 1024 * 1024, maxPartBytes: 1024 * 1024, maxSessions: 20});
  const bytes = new TextEncoder().encode('A resumable document');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    const session = await uploads.initiate(identity,
      {bucket: 'uploads', key: 'example.txt'},
      {size: bytes.length, sha256, contentType: 'text/plain', visibility: 'private'});
    // Persist session.id in the authenticated application's own upload inventory.
    await uploads.uploadPart(identity, session.id, 1, bytes, {size: bytes.length, sha256});
    return await uploads.finalize(identity, session.id, [1]);
  } finally { await uploads.close(); } // files remains borrowed; its owner closes it later
}
```

The host supplies **verified** `{tenant,subject}` identities and a mandatory authorization callback for every operation, including retries and completed receipts. IDs are random 192-bit references, not bearer authorization. Journals bind both identity fields using a digest; the raw identity is not stored in session records. Authorize the canonical storage/bucket/key against current tenant policy and enforce origin/CSRF on cookie-authenticated HTTP writes. No resumable HTTP endpoint or automatic authentication is added. `files.validateWrite(address, options)` checks bucket/prefix/read-only/type and declared-size policies before acquiring an upload, and returns the canonical named address. Finalization checks current policies again. Request identities, public IDs and cleanup previews never expose native S3 upload IDs.

Use the same private root and stable named-provider configuration to resume: construct a new coordinator and call `listParts(identity,id)`, resend missing parts, then finalize. Parts are immutable; a repeat with the same number, declared length and hash returns its accepted receipt without consuming replacement content. A differing receipt rejects `UPLOAD_PART_CONFLICT`. Failed/interrupted uploads leave previous accepted parts intact. Operations on the same session use a filesystem lease and reject competing work with `UPLOAD_BUSY`; there is no hidden retry queue. This is local/shared-filesystem coordination, not a distributed lock service. The host must ensure coherent exclusive mkdir/rename semantics and restrict root/configuration access.

Defaults are 1 GiB per object, 8 MiB per part (hard maximum 64 MiB), 1000 parts, 100 retained sessions, 8 pending calls and one-hour expiry (maximum seven days). Configure disk quotas; retained receipts count toward session limits. Zero-byte objects use ordinary `put`, not this API. Each part accepts at most 65536 source chunks and uses one bounded part buffer. Each part supplies an exact positive `size` and lowercase hexadecimal SHA-256; the coordinator copies/validates bounded stream chunks before staging or backend dispatch. An exceeded/missing byte count rejects. Accepted parts must finalize as exactly `[1,2,...,N]`; aggregate bytes and whole-object SHA-256 must match initiation. `maxBytes` supplied at initiation cannot be lower than declared object size. Up to 30 user metadata fields are accepted, reserving two `zx-upload-*` fields for reconciliation; that prefix is unavailable to callers.

Local staging uses private 0700 directories, 0600 exclusive temporary files, fsync and atomic part/journal rename, with canonical-root, no-follow file and symlink checks. Create-only object bytes commit through the existing atomic link operation: competing sessions produce one winner; losers receive `FILE_EXISTS`. Local object bytes and metadata sidecars are separate filesystem operations, so this is not a crash-atomic multi-file transaction. Journals and staged parts are plaintext even when final objects use encryption: put the private journal on a host-encrypted volume and do not serve it publicly. The root parent must already exist, and all ancestors must resolve canonically. The filesystem/configuration owner is trusted; these checks are not a sandbox against a hostile owner changing ancestors concurrently.

AWS uses actual SDK CreateMultipartUpload/UploadPart/ListParts/CompleteMultipartUpload/AbortMultipartUpload commands. `resumableMultipart` and `multipartCreateOnly` are separate capabilities from the existing automatic `lib-storage` streaming path. AWS defaults both to true; custom endpoints require explicit qualification in `providerCapabilities`, including SHA-256 composite checksum and conditional completion support. Local storage reports staged resumable support even though native `multipart` remains false. Unknown/unsupported custom providers reject before initiation. The ordinary streamed `put` and copy restrictions described above remain unchanged.

S3 validates per-part SHA-256 checksums and the coordinator keeps its own accepted ETag/checksum ledger; native ListParts is reconciled against that ledger rather than used as the completion authority. All but the final native part require at least 5 MiB. The coordinator rereads staged bytes to verify a **full-object SHA-256**, while AWS completion uses **SHA-256 COMPOSITE** checksums; these are distinct digests. Create-only completion sends `If-None-Match: *`; a 412 is a definite conflict, while 409/transport/timeout failures remain uncertain. SSE/KMS/SSE-C settings and configured credentials remain owned by the existing S3 driver. See AWS [multipart integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html) and [conditional completion](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html). `multipartOperations` is a trusted low-level driver escape hatch, not a tenant-authorized HTTP API.

Finalization durably enters `finalizing` before any commit. Success records a result, removes staged parts, and repeated matching finalizations return that receipt. After a lost response or ambiguous failure, another finalize only reconciles an existing object with the same upload ID/size/expected-hash metadata; it never automatically repeats the write. Missing/mismatched evidence returns `UPLOAD_UNCERTAIN`. This reconciliation trusts an unmodified private journal and provider metadata under host-controlled write permissions; it is not independent proof against an out-of-band writer forging metadata. Never convert uncertainty into an automatic overwrite. Definitive conflicts leave the session open for inspection/abort. Completed receipts remain replayable until explicit cleanup, even after upload expiry. Expired open sessions reject new parts/finalization; list/abort remain available for inspection and cleanup.

Cancellation is cooperative: part ingestion and local verification observe signals; native part/complete requests pass signals to the SDK. A completion cancelled after dispatch may have committed and stays fenced. Reader sources/SDK calls that do not settle are not forcibly terminated by a Promise deadline. `close()` rejects new calls and waits for actual in-flight settlement, retaining sessions and leaving the borrowed manager/client ownership intact. Close the coordinator before its file manager.

Cleanup is never automatic. `previewCleanup({cursor?,limit?})` scans a bounded registry and returns at most 100 expired candidates with opaque ID, expiry, status and revision; it must be exposed only through a host-authorized administrative path. A page can contain no candidates and still have `nextCursor`. `cleanup(preview.items)` requires an explicitly configured `approveCleanup` callback, then locks and rechecks each revision/expiry before aborting native uploads and removing staging. A transient abort failure propagates and retains the journal for retry. Healthy or changed sessions are not deleted; `finalizing` sessions are never offered or automatically aborted. Aborted sessions retain a receipt until approved cleanup. Close does not erase sessions.

There is no automatic stale-lease breaking: after a process crash, the operator must establish that its owner is dead before removing a `.lock` directory. A crash/lost response during native initiation may leave an unjournaled S3 upload ID; configure an S3 `AbortIncompleteMultipartUpload` lifecycle policy and reconcile provider inventory administratively. Session cleanup does not scan/delete arbitrary bucket uploads. Local commit/metadata failures or uncertain remote completion may likewise require operator reconciliation. Do not delete a potentially live session to resolve a retry.

Focused checks exercise local restart/resume, rejected tenants and hashes, stream interruption, ordered completion, concurrent create-only winners, expiry/approval/revision cleanup, symlink rejection, draining close and SDK multipart failure/lost-response reconciliation. S3 fixtures exercise real SDK command objects, not a live S3 service. Disposable AWS/MinIO conditional completion, checksum interoperability, backend lifecycle cleanup and crash/power-loss behavior require separate live qualification.

### Fetch client and ownership

Import `createFilesClient` from `@zeruxjs/files/client` in browser code. This exact subpath has no Node/AWS imports; the storage root remains server-only. The client borrows Fetch and creates no persistent listeners, timers or close handle. `download` returns a Response whose body the caller must consume or cancel; `bytes` buffers small objects (16 MiB default) and releases an acquired reader. Pass a trusted positive finite byte ceiling. This client does not authenticate a tenant or validate JSON receipts independently; the server must authorize each operation.

The token-authorizer factory borrows its verifier. Persistence, expiry, revocation and scope enforcement belong to that verifier; this factory does not imply an in-memory or durable auth store. The raw byte cache is process-local and policy-free. The file manager excludes private/encrypted objects from its cache, and cached byte arrays are copied on read and write.

```ts
import { createFilesClient } from '@zeruxjs/files/client';

// Configure a host-authorized object route; the facade does not create that route.
const client = createFilesClient({ baseUrl: 'https://files.example/public/' });
const bytes = await client.bytes('manual.txt', 64 * 1024);
console.log(bytes.byteLength);
```

Close a resumable coordinator before its manager. Manager `close()` calls each
unique configured driver's optional close and clears local cached bytes; it does
not track every in-flight manager operation. S3 close fences calls, awaits lazy
client creation and destroys owned clients once, without claiming a command drain
or terminating borrowed credential helpers. Local drivers retain no persistent
file handle; opened read iterators must be consumed or returned by their caller.
A local binary commit and its metadata sidecar update are separate filesystem
operations, not a global crash-atomic transaction. Local listing currently scans
and validates the bucket metadata before slicing its result page; it is not a
constant-memory remote listing replacement.
