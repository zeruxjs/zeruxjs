---
{
  "title": "Private media",
  "description": "Stream bounded uploads and private downloads without treating the store as a public file server.",
  "section": "Packages",
  "order": 13,
  "sources": [
    "packages/@zeruxjs/media/README.md",
    "packages/@zeruxjs/media/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/media"
}
---

## Storage choices

The legacy local media store uses random IDs, disk files and metadata. For multi-host storage use the files-backed integration and a shared authorized backend. Neither option supplies application login or tenant permission automatically.

```ts
import { createMediaStore, uploadMediaRequest, createMediaResponse } from '@zeruxjs/media';
const media = createMediaStore('/srv/private/media', 20 * 1024 * 1024);
// Authenticate and authorize the caller before these operations.
const record = await uploadMediaRequest(media, request, {
  name: 'report.pdf', maxBytes: 8 * 1024 * 1024
});
const response = await createMediaResponse(media, record.id, { request });
```

## Upload contract

The helper streams raw request bytes; it does not parse multipart/form-data. It checks maximum bytes and declared length. The application owns MIME validation, compression policy, malware scanning, quotas and permission to create the destination object.

## Downloads and integrity

HTTP helpers support HEAD, ETags, conditional requests and single/suffix ranges, with private no-store defaults. Full download verifies SHA-256; streamed partial reads verify size but do not compute a complete digest before emitting data. Restrict inline rendering to trusted inert types.

## Capabilities and listing

Signed media tokens are short-lived capabilities with an application signing key, not user authentication. For client-facing files-backed metadata use statAuthorized/listAuthorized. Partition tenant listings by bucket/key prefix when complete authorized pagination matters. Schedule expiration cleanup and keep storage outside public directories.

## Install and select the integration

```sh
npm install @zeruxjs/media@0.0.2
```

There is no automatic `media` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Choose the legacy private disk store or the files-backed service deliberately. The disk store uses random IDs, bounded raw uploads and integrity metadata; a files-backed service integrates named object storage and authorization. Authenticate before handling raw request bytes. The upload helper is not a multipart parser.

## TypeScript: inputs, results and ownership

```ts
import { createMediaStore } from '@zeruxjs/media';

type Inputs = Parameters<typeof createMediaStore>;
type Result = Awaited<ReturnType<typeof createMediaStore>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createMediaStore>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Default responses are private/no-store. Do not force arbitrary HTML or executable content inline. A signed token is a capability with its own lifetime, not a login. Expired-file cleanup needs an owned schedule, and local directories do not provide shared storage across hosts. Use authorized metadata/list APIs for client responses; older trusted server methods do not perform caller authorization.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### MediaRequestUploadOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | Yes |
| `maxBytes` | `number` | Yes |
| `expiresInMs` | `number` | Yes |

### MediaResponseOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `request` | `Request` | Yes |
| `downloadName` | `string` | Yes |
| `inline` | `boolean` | Yes |
| `cacheControl` | `string` | Yes |

### MediaFilesOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `storage` | `string` | Yes |
| `bucket` | `string` | No |
| `prefix` | `string` | Yes |
| `maxUploadBytes` | `number` | Yes |
| `visibility` | `'private'\|'public'` | Yes |
| `authorize` | `(request: Request, address: FileAddress, action: 'read'\|'write'\|'delete', info?: FileInfo) => boolean\|Promise<boolean>` | Yes |

### UploadOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | No |
| `contentType` | `string` | No |
| `expiresInMs` | `number` | Yes |
| `maxBytes` | `number` | Yes |

### ListOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `includeExpired` | `boolean` | Yes |
| `limit` | `number` | Yes |
| `offset` | `number` | Yes |
