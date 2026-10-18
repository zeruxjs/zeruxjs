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
