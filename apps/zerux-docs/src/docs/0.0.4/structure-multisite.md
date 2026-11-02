---
{
  "title": "Multisite structure",
  "description": "Host/path mapping is separate from tenant identity and database scope.",
  "navigation": "structure",
  "section": "Fundamentals",
  "order": 7,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts"
  ],
  "related": [
    "structure",
    "routing",
    "tenant-data"
  ]
}
---

## Opt-in mapping

`multisite:true` allows request middleware to call the existing `context.multisiteRegister(url, folderName)` mapping API. Folder names are validated single root-app segments. The runtime matches reviewed host/path registrations and maps into those app subtrees.

This is not another value for `type`; fix/dynamic/function remain independent structure labels. It is not a tenant resolver, identity provider or automatic database isolation system. Bind tenant/site identity from the host's verified authentication policy and enforce it in all storage and service calls.

## Proxy and assets

Do not trust arbitrary Host/forwarded headers as identity. Configure hosting origin/proxy policy explicitly, test unmatched hosts and check public asset exposure separately. Public directories are not private just because a route maps to a tenant folder.
