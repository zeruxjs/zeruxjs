# Dynamic structure

The precise current meaning of dynamic and its shared directory contract.


## Accepted mode

This label is accepted and retained by the resolver. The current runtime shares the same route/module discovery; it does not rescan source on every request or isolate each request in a new process.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  type: 'dynamic',
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


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/runtime.ts)
