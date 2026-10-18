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
