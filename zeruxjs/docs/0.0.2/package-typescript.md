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

## Install and select the integration

```sh
npm install @zeruxjs/typescript@0.0.2
```

There is no automatic `typescript` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/zeruxjs/docs/0.0.2/configuration-reference.md) and [TypeScript](/zeruxjs/docs/0.0.2/typescript.md).

## A practical integration workflow

Choose transform, build, typecheck or loader registration deliberately. Transforms/bundles remove syntax and may optimize output; only a separate typecheck reports semantic type errors. Browser bundles must use platform browser and a browser target; default platform remains Node. Avoid pulling filesystem/secret-bearing modules into browser entry points.

## TypeScript: inputs, results and ownership

```ts
import { buildTypescript } from '@zeruxjs/typescript';

type Inputs = Parameters<typeof buildTypescript>;
type Result = Awaited<ReturnType<typeof buildTypescript>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof buildTypescript>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

CommonJS registration returns a disposer and does not register an ESM loader. Use the supported ESM loader mechanism for ESM TypeScript files. Output paths must not equal the source project root. Verify source maps, external packages and generated ESM/CJS format against the actual runtime. A successful transpilation does not prove package exports, types or integration behavior.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### TypeScriptBuildOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `entryPoints` | `string[]` | No |
| `outdir` | `string` | No |
| `cwd` | `string` | Yes |
| `format` | `"esm" \| "cjs"` | Yes |
| `platform` | `"node" \| "browser" \| "neutral"` | Yes |
| `target` | `string` | Yes |
| `bundle` | `boolean` | Yes |
| `minify` | `boolean` | Yes |
| `sourcemap` | `boolean` | Yes |
| `external` | `string[]` | Yes |

### TransformOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `filename` | `string` | Yes |
| `format` | `ScriptFormat` | Yes |
| `sourceMap` | `boolean` | Yes |
| `target` | `ts.ScriptTarget` | Yes |

### TsConfigOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `overwrite` | `boolean` | Yes |
| `compilerOptions` | `Record<string, unknown>` | Yes |
| `include` | `string[]` | Yes |
| `exclude` | `string[]` | Yes |

### TypecheckOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `files` | `string[]` | No |
| `cwd` | `string` | Yes |
| `configFile` | `string` | Yes |


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
