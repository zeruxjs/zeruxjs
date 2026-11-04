---
{
  "title": "Fix structure",
  "description": "The precise current meaning of fix and its shared directory contract.",
  "navigation": "structure",
  "section": "Fundamentals",
  "order": 1,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts"
  ],
  "related": [
    "structure",
    "structure-directories",
    "configuration-structure"
  ]
}
---

## Accepted mode

This is the default when `type` is omitted. It does not freeze content or convert routes into static HTML.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  type: 'fix',
  entryPoint: 'src/index',
  outDir: '.zerux',
  structure: { app: 'src/app', middleware: ['src/middleware'],
    controllers: ['src/controllers'], composables: ['src/composables'],
    plugins: ['src/plugins'], public: ['public'] },
} satisfies ZeruxConfig;
```

## Shared discovery

All three modes resolve these paths from the project root. `entryPoint` is a module basename/path, not a URL mount. File routes and explicit plugin registrations use the same request lifecycle. A config type annotation neither starts services nor authorizes requests.

## Choose a real hosting owner

Build with `zerux build`, inspect its server/asset manifests, then use the supported Node runtime. Select a separate qualified deployment adapter when needed. Public-only static output requires `zeruxjs/static-export`; changing this label cannot remove runtime dependencies. Verify dev and production separately after moving source directories.
