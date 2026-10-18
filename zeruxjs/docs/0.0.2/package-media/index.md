# Private media

Stream bounded uploads and private downloads without treating the store as a public file server.


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


## Public entry points

Manifest reference for `@zeruxjs/media@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/files": "0.0.2"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/media

Private, disk-backed binary media storage. Random UUID filenames, bounded uploads, SHA-256 metadata, expiration, signed access tokens and streaming are maintained by the store. This package is **not** a public static-file server; authentication and access-policy checks belong to the application.

```ts
import { createMediaStore, uploadMediaRequest, createMediaResponse } from '@zeruxjs/media';

const media = createMediaStore('/srv/private/media', 20 * 1024 * 1024);
// Authenticate and authorize this upload BEFORE passing its request to the store.
const record = await uploadMediaRequest(media, request, {name:'report.pdf',maxBytes: 8 * 1024 * 1024});
// Verify this user has permission to read record.id before creating the response.
const response = await createMediaResponse(media, record.id, {request});
```

`upload()`, `uploadStream()`, `download()` (SHA-256 integrity verified), `stream()` / `streamRange()`, `info()`, `exists()`, `remove()`, `list({limit,offset,includeExpired})`, and `cleanupExpired()` remain available.

`createMediaResponse()` supports GET and HEAD, conditional `If-None-Match` (304), byte-range and suffix-range downloads (206 or 416), `If-Range`, `ETag`, `Last-Modified`, `Accept-Ranges`, safe attachment filenames, and default `private, no-store`. Set `inline:true` **only** for application-trusted content. Streaming uses bounded reads from a file descriptor opened without following symlinks, and handles response cancellation. Partial/streamed downloads check size, but **do not compute the SHA-256 digest**; use `download()` if complete integrity verification is required before exposing bytes. A mutated media file can still change during streaming.

`uploadMediaRequest()` streams raw request bytes directly to the store with maximum-size and reported-length validation; it does not parse `multipart/form-data`. Reject compressed request bodies; decompress separately under a bounded policy if needed. Callers control MIME validation, malware scanning and user quotas.

`createSignedMediaToken()` / `verifySignedMediaToken()` create short-lived capabilities using an application-owned signing key (at least 16 bytes). These are not authentication. Store media outside web roots, keep access-control checks on download routes, protect the signing secret and schedule expired-file cleanup. A local directory is not shared storage for multiple hosts.

### Section 80 HTTP safety

For the files-backed media service, use `statAuthorized(id, request)` and `listAuthorized(request, {limit,cursor})` when returning metadata to clients. Both call `authorize` per object, suppressing a backend continuation cursor when unauthorized objects were encountered. For complete paginated tenant listings, partition by bucket/key prefix; the older `stat`/`list` methods are server-trusted only. The request upload helper validates declared length during streaming; legacy media inline responses allow only inert MIME types and force potentially executable content to download.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/media/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/media/README.md)
- [packages/@zeruxjs/media/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/media/package.json)
