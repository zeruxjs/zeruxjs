---
{
  "title": "TypeScript tooling",
  "description": "Separate transpilation, typechecking, loaders and bundling.",
  "section": "Packages",
  "order": 33,
  "sources": [
    "packages/@zeruxjs/typescript/README.md",
    "packages/@zeruxjs/typescript/package.json",
    "packages/@zeruxjs/typescript/src/presets.ts",
    "packages/@zeruxjs/typescript/src/transform.ts",
    "packages/@zeruxjs/typescript/src/build.ts",
    "packages/@zeruxjs/typescript/src/tsconfig.ts"
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

buildTypescript supports esbuild bundling with explicit entry points/outdir. createTsConfig creates a config only when none exists. Use the typed `/presets` and `/tsconfig` public subpaths for environment-specific generation (see below). Review generated options against the application's module/runtime requirements rather than replacing an established tsconfig blindly.

## Loading modes

registerTypescript installs CommonJS require hooks and returns a disposer. It does not enable ESM loading. The separate @zeruxjs/typescript/loader entrypoint integrates with Node's custom ESM loader mechanism. Zerux's application CLI registers its own framework loader for virtual imports and source handling.

## Install and select the integration

```sh
npm install @zeruxjs/typescript@0.0.4
```

There is no automatic `typescript` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Choose transform, build, typecheck or loader registration deliberately. Transforms/bundles remove syntax and may optimize output; only a separate typecheck reports semantic type errors. Browser bundles must use platform browser and a browser target; default platform remains Node. Avoid pulling filesystem/secret-bearing modules into browser entry points.

## TypeScript: inputs, results and ownership

```ts
import { buildTypescript } from '@zeruxjs/typescript';

type Inputs = Parameters<typeof buildTypescript>;
type Result = Awaited<ReturnType<typeof buildTypescript>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof buildTypescript>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

| Field         | Accepted type/value                | Optional |
| ------------- | ---------------------------------- | -------- |
| `entryPoints` | `string[]`                         | No       |
| `outdir`      | `string`                           | No       |
| `cwd`         | `string`                           | Yes      |
| `format`      | `"esm" \| "cjs" \| "iife"`         | Yes      |
| `platform`    | `"node" \| "browser" \| "neutral"` | Yes      |
| `target`      | `string`                           | Yes      |
| `bundle`      | `boolean`                          | Yes      |
| `minify`      | `boolean`                          | Yes      |
| `sourcemap`   | `boolean`                          | Yes      |
| `external`    | `string[]`                         | Yes      |
| `signal`      | `AbortSignal`                      | Yes      |

### TransformOptions

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `filename`  | `string`            | Yes      |
| `format`    | `ScriptFormat`      | Yes      |
| `sourceMap` | `boolean`           | Yes      |
| `target`    | `ts.ScriptTarget`   | Yes      |

### TsConfigOptions

| Field             | Accepted type/value       | Optional |
| ----------------- | ------------------------- | -------- |
| `preset`          | `TypeScriptPresetName`    | Yes      |
| `overwrite`       | `boolean`                 | Yes      |
| `compilerOptions` | `Record<string, unknown>` | Yes      |
| `include`         | `string[]`                | Yes      |
| `exclude`         | `string[]`                | Yes      |

### TypecheckOptions

| Field               | Accepted type/value    | Optional |
| ------------------- | ---------------------- | -------- |
| `files`             | `string[]`             | No       |
| `cwd`               | `string`               | Yes      |
| `configFile`        | `string`               | Yes      |
| `checkDependencies` | `boolean`              | Yes      |
| `signal`            | `AbortSignal`          | Yes      |
| `cancellationToken` | `ts.CancellationToken` | Yes      |

## Environment presets and declaration ownership

```ts
import { createTsConfig } from '@zeruxjs/typescript/tsconfig';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
import { checkTypes } from '@zeruxjs/typescript';

const preset = createTypeScriptPreset('node-server');
createTsConfig(process.cwd(), { compilerOptions: preset.compilerOptions, include: preset.include });
const result = checkTypes({ files: [], checkDependencies: true });
if (!result.ok) {
  console.error(result.status, result.diagnostics);
  process.exitCode = 1;
}
```

The factory returns fresh typed JSON; configuration generation is explicit and
leaves existing files untouched unless overwrite is requested. Compiler option
overrides are validated before writing. Presets enable strict checks,
`skipLibCheck:false`, `noUncheckedSideEffectImports:true`, declaration emission, `noEmitOnError`, local `src`/`dist`
paths and export-map-aware resolution. Run `tsc -p tsconfig.json` in the owning
package to emit declarations. Neither checkTypes nor esbuild emits declarations.
The tooling package does not collect or reexport other packages' public types.

| Preset            | Modules/resolution | Globals and conditions                                                        |
| ----------------- | ------------------ | ----------------------------------------------------------------------------- |
| `node-server`     | NodeNext/NodeNext  | ES2022, explicit Node types; implicit node/types/import-or-require conditions |
| `browser-library` | ESNext/Bundler     | ES2022 + DOM/DOM.Iterable, `types:[]`, additional browser condition           |
| `mixed-exports`   | NodeNext/NodeNext  | Portable ES2022 only, `types:[]`; implicit NodeNext conditions                |

Install the Node typings in the server owner. Mixed packages should separately
check server/browser trees and maintain their own conditional exports and matching
declarations; the portable preset is not a dual-format build generator. NodeNext's
node condition cannot be removed by adding browser. The browser preset uses
Bundler resolution to avoid it; browser dependencies therefore require bundling.
`types:[]` blocks ambient Node globals but cannot block explicit Node-typed imports.
Check the browser bundle separately to reject Node built-ins. Presets alone do not
prove native-browser runtime resolution.

## Actionable failures and cancellation

Results retain `ok` and raw TypeScript `diagnostics`, plus
`status:'passed'|'failed'|'cancelled'`. Compiler diagnostics cover invalid subpaths,
missing declarations and config/semantic failures. Opt-in `checkDependencies:true`
adds 95001 diagnostics for undeclared literal bare imports and 95002 for invalid
owning manifests. Each local source uses its nearest manifest; dependency, dev,
peer and optional declarations are accepted. Built-ins, relative paths,
`#imports` and self-imports remain compiler-resolved. This is not a production
dependency classification or computed-import audit. Do not use source `paths`
aliases as evidence of a working installed package; check its packed exports.

A supplied AbortSignal returns cancelled/false with its reason for checks.
Typechecking is synchronous, so cancellation only works at cooperative checkpoints;
a TypeScript cancellationToken can also signal synchronously. Unexpected errors
propagate. Build signals reject with AbortError and preserve cause details;
ordinary esbuild errors retain errors/warnings. Every owned build context and
abort listener is disposed. Builds are not atomic and may leave output after
failure/cancellation; stage and promote when required. Browser's default target is
ES2022; Node/neutral remain node20. CommonJS disposers are idempotent and invalid
extension lists do not partially install hooks.

The package-local foundation tests install packed built exports offline, check a
declaration consumer without source aliases, compile representative environment
fixtures, and exercise invalid imports, undeclared dependencies, failed checks,
cancellation and cleanup. Installed dependencies and esbuild's native platform
binary are required; no application restart or live browser check is implied.
