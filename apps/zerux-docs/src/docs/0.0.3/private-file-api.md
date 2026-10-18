---
{
  "title": "Build a private file API",
  "description": "Connect storage, Fetch handlers and application authorization without exposing a public bucket.",
  "section": "Data and services",
  "order": 40,
  "sources": [
    "packages/@zeruxjs/files/README.md",
    "packages/zeruxjs/src/fetch-route.ts"
  ],
  "related": [
    "package-files",
    "package-media",
    "fetch-handlers"
  ]
}
---

## Define the boundary first

A private file API needs three decisions before its storage driver: how the request is authenticated, how a principal is authorized for an object, and how the object address is selected. Do not translate an arbitrary submitted storage/bucket/key into a trusted address. Resolve it from a server-owned record and tenant membership.

The files manager is the byte-storage layer. The Fetch adapter preserves HTTP semantics. Your application supplies identity and policy. The example below names these host-owned functions explicitly rather than implying the framework provides an identity database.

## Create or obtain the manager

For a standalone service, createFileManager owns configured stores and must be closed during shutdown. For a Zerux application, files startup configuration can construct the generation-owned manager; obtain it through api.service or context.services.get. Keep its storage credentials server-side.

## Register a download endpoint

```ts
import { registerFetchRoutes } from 'zeruxjs/fetch-route';
import { createFileResponse } from '@zeruxjs/files';

registerFetchRoutes(api, [{
  pattern: '/api/documents/:id',
  handler: async (request, context) => {
    const principal = await authenticate(request);
    const address = await resolveOwnedDocument(principal, context.params.id);
    return createFileResponse(files, address, request, {
      authorize: async (_request, object, action) => canAccess(principal, object, action),
      inline: false
    });
  }
}]);
```

`api` and `files` are initialized runtime resources. authenticate, resolveOwnedDocument and canAccess are application-provided implementations. Resolve ownership before handing the object to storage. Authenticate a HEAD request as carefully as a GET: metadata itself can be private.

## Upload under a bounded policy

For uploadFileRequest, choose an authorized address, set maxBytes and private visibility, and provide write authorization. The helper streams a raw body; do not label a multipart form as raw object bytes. Validate media type, quota and accepted content separately, and quarantine/scanner-check uploads when appropriate.

Do not accept the destination tenant prefix or public visibility solely from the client. A signed PUT is still a capability that must be issued only after permission checks. Decide how a successful object write becomes visible in the authoritative document record, and how failed/uncommitted objects are reclaimed.

## Preserve HTTP semantics

The file response can supply ETag, conditional requests and supported byte ranges. The Fetch bridge preserves these statuses and streams with cancellation. Encrypted local objects cannot offer ordinary byte ranges after authenticated decryption. Do not buffer a large file merely to convert it back into an ordinary JSON/string handler response.

## Verify the deployment

Test unauthorized IDs, cross-tenant IDs, HEAD, empty/oversized uploads, declared-length mismatch, suffix ranges, client disconnect and storage failure. For S3-compatible backends also verify actual provider encryption, multipart and signing behavior. Local or injected-client checks do not prove all cloud-provider semantics.
