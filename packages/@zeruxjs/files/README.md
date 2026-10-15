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

### Section 80 streamed request/copy safety

Fetch uploads validate a declared `Content-Length` **inside the stream** and reject missing/excess bytes before storage commits; they do not delete already-committed keys as cleanup. All manager copies, including storage-native copies, enforce destination `allowedTypes` and `maxBytes`. Do not use a signed PUT or raw driver call as a substitute for tenant authorization. Native S3 multipart create-only behavior needs real-provider concurrency tests.
