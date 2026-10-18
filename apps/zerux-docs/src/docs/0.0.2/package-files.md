---
{
  "title": "Object and file storage",
  "description": "Use named local or S3-compatible stores with explicit access policy.",
  "section": "Packages",
  "order": 12,
  "sources": [
    "packages/@zeruxjs/files/README.md",
    "packages/@zeruxjs/files/package.json"
  ],
  "related": [
    "private-file-api",
    "package-media",
    "fetch-handlers"
  ],
  "package": "@zeruxjs/files"
}
---

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
npm install @zeruxjs/files@0.0.2
```

This package participates in the runtime's **files** integration. Start with [files configuration](configuration-files.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use storage/bucket/key addresses and named drivers. In runtime setup declare store type/root/options and let bootstrap create drivers; in standalone code pass real driver objects. Separate a metadata cache from object storage durability, and keep private local roots outside public directories. Set bucket/type/byte policy before adding upload routes.

## TypeScript: inputs, results and ownership

```ts
import { createFileManager } from '@zeruxjs/files';

type Inputs = Parameters<typeof createFileManager>;
type Result = Awaited<ReturnType<typeof createFileManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createFileManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
