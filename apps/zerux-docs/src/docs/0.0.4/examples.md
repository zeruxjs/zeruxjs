---
{
  "title": "Examples",
  "description": "Public-import recipes with explicit dependencies and honest verification.",
  "navigation": "examples",
  "section": "Fundamentals",
  "order": -10,
  "sources": [
    "packages/create/create-zyro-app/src/templates.ts",
    "packages/create/create-zerux-app/src/templates.ts",
    "packages/create/create-zenix-app/src/templates.ts"
  ],
  "related": [
    "tutorial",
    "example-renderer-data-queue",
    "reference-create-zyro-app",
    "reference-create-zenix-js"
  ]
}
---

## Choose an application

| Recipe | Implemented output | Required host work |
| --- | --- | --- |
| [First notes API](tutorial.md) | File routes and a bounded process-local teaching store | Real storage/tenant auth before private use |
| [ZyroJS + SQLite + BullMQ](example-renderer-data-queue.md) | Public SSR page, synthetic data and explicit snapshot job | Isolated Redis and reviewed local database |
| [Zyro generator](reference-create-zyro-app.md) | JS/TS client, static, SSR or V1 whole-root hydration | Mode-specific build/hosting prerequisites |
| [Zerux generator](reference-create-zerux-js.md) | JS/TS SSR using explicitly selected renderer | Node/runtime deployment |
| [Zenix generator](reference-create-zenix-js.md) | SQLite CMS integration scaffold | Host persistent auth, CSRF, setup secret and explicit migration |
| [Private file API](private-file-api.md) | Explicitly authorized file access | Verified host principals/storage |

## Copy contracts, not private source

Use public export paths. A callback such as `authorize` or `resolvePrincipal` must be implemented by the host; its name is not a bundled service. Examples never provision accounts, install remote infrastructure or certify arbitrary deployments. Queue jobs carry references, not private record bodies.
