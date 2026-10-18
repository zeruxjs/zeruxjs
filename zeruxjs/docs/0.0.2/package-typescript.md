# TypeScript tooling

Separate transpilation, typechecking, loaders and bundling.


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


## Public entry points

Manifest reference for `@zeruxjs/typescript@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./loader": {
      "types": "./dist/loader.d.ts",
      "import": "./dist/loader.js"
    },
    "./build": {
      "types": "./dist/build.d.ts",
      "import": "./dist/build.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@types/node": "^25.4.0",
    "@types/ws": "^8.18.1",
    "esbuild": "^0.28.2",
    "typescript": "^5.9.3"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/typescript

TypeScript transpilation, typechecking, tsconfig generation, CommonJS compatibility and optional esbuild bundling.

```ts
import { transformTypescript, checkTypes, buildTypescript, createTsConfig } from '@zeruxjs/typescript';
const { code } = transformTypescript('const answer: number = 42;');
const { ok, diagnostics } = checkTypes({ files: ['src/index.ts'] });
await buildTypescript({ entryPoints: ['src/index.ts'], outdir: 'dist', bundle: true });
createTsConfig(process.cwd()); // leaves an existing config untouched
```

`registerTypescript()` installs and returns a disposer for **CommonJS require** hooks only. ESM TypeScript loading uses `@zeruxjs/typescript/loader` with Node's custom ESM loader mechanism. Transpilation does *not* typecheck; call `checkTypes` separately. `buildTypescript` requires esbuild, which is an explicit package dependency.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.

## Browser production assets

`buildTypescript({entryPoints, outdir, cwd, platform:'browser', format:'esm', target:'es2022', bundle:true, minify:true, sourcemap:false})` bundles browser JavaScript or CSS entry points. The platform defaults to `node` for backward compatibility. Use browser output with a module script, keep browser-only APIs out of server startup code, and run a separate typecheck. The documentation site uses this API for its production CSS/JavaScript.


## Implementation sources

- [packages/@zeruxjs/typescript/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/typescript/README.md)
- [packages/@zeruxjs/typescript/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/typescript/package.json)
