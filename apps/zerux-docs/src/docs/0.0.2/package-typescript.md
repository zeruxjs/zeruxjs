---
{
  "title": "TypeScript tooling",
  "description": "Separate transpilation, typechecking, loaders and bundling.",
  "section": "Packages",
  "order": 33,
  "sources": [
    "packages/@zeruxjs/typescript/README.md",
    "packages/@zeruxjs/typescript/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/typescript"
}
---

## Transpile and check separately

```ts
import { transformTypescript, checkTypes } from '@zeruxjs/typescript';
const output = transformTypescript('const answer: number = 42;');
const result = checkTypes({ files: ['src/index.ts'] });
if (!result.ok) console.error(result.diagnostics);
```

A successful transpile only proves syntax can become JavaScript. It does not prove type correctness. Run a separate check in development/CI and before production builds.

## Build and configuration

buildTypescript supports esbuild bundling with explicit entry points/outdir. createTsConfig creates a config only when none exists. Review generated options against the application's module/runtime requirements rather than replacing an established tsconfig blindly.

## Loading modes

registerTypescript installs CommonJS require hooks and returns a disposer. It does not enable ESM loading. The separate @zeruxjs/typescript/loader entrypoint integrates with Node's custom ESM loader mechanism. Zerux's application CLI registers its own framework loader for virtual imports and source handling.
