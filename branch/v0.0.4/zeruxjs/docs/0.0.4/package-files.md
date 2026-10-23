# Object and file storage

Use named local or S3-compatible stores with explicit access policy.


## Manager and addresses

An object address is `{ storage, bucket, key }`. The manager selects a named driver and enforces configured bucket/type/size rules. Store private files outside public web roots.

```ts
import { createFileManager, createLocalStorage } from '@zeruxjs/files';
const files = createFileManager({
  defaultStorage: 'local', stores: [{ name: 'local',
    driver: createLocalStorage({ root: './private/files' }),
    allowedBuckets: ['uploads'] }]
});
const address = { storage: 'local', bucket: 'uploads', key: 'example.txt' };
await files.put(address, new TextEncoder().encode('hello'), {
  contentType: 'text/plain', visibility: 'private'
});
await files.close();
```

## Read, copy and serve

Use stat/read for trusted server access. `createFileResponse` integrates Fetch streaming, conditional requests and supported ranges. Private responses require authorization; uploads need explicit write permission and a byte limit. The publicUrl formatter does not grant access or configure a bucket ACL.

## S3-compatible providers

createS3Storage supports AWS and compatible endpoints with region, endpoint and path-style options. Choose one credential mode: default chain, profile, explicit credentials, assume-role or web identity. Provider capabilities differ for multipart, KMS, ACLs and signing; verify the real provider rather than assuming universal parity.

## Integrity and limits

Manager copies enforce destination type and maximum bytes, including native storage copies. Encrypted local objects verify authentication before plaintext output and do not support byte ranges. A signed upload URL is a capability, not proof that its recipient is authorized for another tenant's key.

## Lifecycle

Framework configuration can own the manager; otherwise call close during shutdown. Use filesystem/provider permissions, lifecycle/retention policies and a malware/content policy appropriate to uploads. Local S3-lite is an object-addressing interface, not a complete S3 HTTP server.

## Install and select the integration

```sh
npm install @zeruxjs/files@0.0.3
```

This package participates in the runtime's **files** integration. Start with [files configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-files.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use storage/bucket/key addresses and named drivers. In runtime setup declare store type/root/options and let bootstrap create drivers; in standalone code pass real driver objects. Separate a metadata cache from object storage durability, and keep private local roots outside public directories. Set bucket/type/byte policy before adding upload routes.

## TypeScript: inputs, results and ownership

```ts
import { createFileManager } from '@zeruxjs/files';

type Inputs = Parameters<typeof createFileManager>;
type Result = Awaited<ReturnType<typeof createFileManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createFileManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Authorize per-object reads, metadata and writes. Public URLs and signed upload/download capabilities are not proof of tenant ownership. Be explicit about cancellation, ranges and complete integrity verification. Test local filesystem permissions and S3 provider capabilities independently; a compatible endpoint is not guaranteed to implement every AWS feature.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### StorageManagerOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `stores` | `StorageDefinition[]` | No |
| `defaultStorage` | `string` | Yes |
| `cache` | `{ maxEntries?: number; maxBytes?: number; ttlMs?: number }` | Yes |

### StorageDefinition

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | No |
| `driver` | `StorageDriver` | No |
| `readonly` | `boolean` | Yes |
| `allowedTypes` | `string[]` | Yes |
| `allowedBuckets` | `string[]` | Yes |
| `keyPrefix` | `string` | Yes |
| `maxBytes` | `number` | Yes |

### LocalStorageOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `root` | `string` | No |
| `encryptionKey` | `Uint8Array \| string` | Yes |

### S3StorageOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `region` | `string` | Yes |
| `endpoint` | `string` | Yes |
| `forcePathStyle` | `boolean` | Yes |
| `allowInsecureHttp` | `boolean` | Yes |
| `useArnRegion` | `boolean` | Yes |
| `maxAttempts` | `number` | Yes |
| `encryption` | `S3Encryption` | Yes |
| `publicBaseUrl` | `string` | Yes |
| `cloudFrontSigning` | `{ keyPairId: string; privateKey: string }` | Yes |
| `publicPathStyle` | `'bucket-key'\|'key-only'` | Yes |
| `client` | `{ send(command: any): Promise<any>; destroy?(): void }` | Yes |
| `ownClient` | `boolean` | Yes |
| `multipart` | `{ partSize?: number; queueSize?: number }` | Yes |

### PutFileOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `contentType` | `string` | Yes |
| `contentDisposition` | `string` | Yes |
| `visibility` | `FileVisibility` | Yes |
| `cacheControl` | `string` | Yes |
| `metadata` | `Record<string,string>` | Yes |
| `maxBytes` | `number` | Yes |
| `ifNoneMatch` | `boolean` | Yes |
| `expiresAt` | `string` | Yes |
| `signal` | `AbortSignal` | Yes |

### FileHttpOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `authorize` | `(request:Request,address:FileAddress,operation:'read'\|'write'\|'delete',info?:FileInfo) => boolean\|Promise<boolean>` | Yes |
| `storage` | `string` | Yes |
| `bucket` | `string` | No |
| `prefix` | `string` | Yes |
| `maxUploadBytes` | `number` | Yes |
| `cacheControl` | `string` | Yes |
| `allowDelete` | `boolean` | Yes |

### ReadFileOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `start` | `number` | Yes |
| `end` | `number` | Yes |
| `signal` | `AbortSignal` | Yes |

### ListFileOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `prefix` | `string` | Yes |
| `limit` | `number` | Yes |
| `cursor` | `string` | Yes |

### AssumeRoleOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `roleArn` | `string` | No |
| `sessionName` | `string` | Yes |
| `externalId` | `string` | Yes |
| `durationSeconds` | `number` | Yes |
| `mfa` | `{ serial: string; tokenCode: string }` | Yes |
| `sourceCredentials` | `AwsKeyCredentials \| AwsCredentialProvider` | Yes |
| `sourceProfile` | `string` | Yes |
| `stsRegion` | `string` | Yes |

### WebIdentityOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `roleArn` | `string` | No |
| `tokenFile` | `string` | No |
| `sessionName` | `string` | Yes |
| `stsRegion` | `string` | Yes |

### AwsCredentialOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `credentials` | `AwsKeyCredentials \| AwsCredentialProvider` | Yes |
| `profile` | `string` | Yes |
| `assumeRole` | `AssumeRoleOptions` | Yes |
| `webIdentity` | `WebIdentityOptions` | Yes |

### StorageTokenAuthOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `scopePrefix` | `string` | Yes |
| `publicRead` | `boolean` | Yes |
| `allow` | `(subject: string, address: FileAddress, action: 'read'\|'write'\|'delete', info?: FileInfo) => boolean \| Promise<boolean>` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/files@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client.d.ts",
      "default": "./dist/client.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@aws-sdk/client-s3": "^3.900.0",
    "@aws-sdk/cloudfront-signer": "^3.900.0",
    "@aws-sdk/credential-providers": "^3.900.0",
    "@aws-sdk/lib-storage": "^3.900.0",
    "@aws-sdk/s3-request-presigner": "^3.900.0"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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
      encryption:{mode:'AES256'}
    }),allowedBuckets:['uploads']}
  ]
});

const addr={storage:'local',bucket:'uploads',key:'images/photo.webp'};
await files.put(addr,new Uint8Array([1,2,3]),{contentType:'image/webp',visibility:'private'});
await files.stat(addr);
for await(const bytes of await files.read(addr)) {/* consume with backpressure */}
await files.copy(addr,{storage:'object',bucket:'uploads',key:'images/photo.webp'});
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

Local S3-lite is S3-**style** object addressing; it is *not* an HTTP server implementing the entire AWS S3 wire API. If you need third-party S3 SDK clients connecting over HTTP, use MinIO/RustFS or another actual S3 server.

Install official AWS SDK modules including `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/credential-providers`, `@aws-sdk/s3-request-presigner`, and `@aws-sdk/cloudfront-signer`. The runtime imports them lazily. SDK integration tests use an injected client, not live cloud infrastructure.

### Streamed request/copy safety

Fetch uploads validate a declared `Content-Length` **inside the stream** and reject missing/excess bytes before storage commits; they do not delete already-committed keys as cleanup. All manager copies, including storage-native copies, enforce destination `allowedTypes` and `maxBytes`. Do not use a signed PUT or raw driver call as a substitute for tenant authorization. Native S3 multipart create-only behavior needs real-provider concurrency tests.


## Implementation sources

- [packages/@zeruxjs/files/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/files/README.md)
- [packages/@zeruxjs/files/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/files/package.json)
