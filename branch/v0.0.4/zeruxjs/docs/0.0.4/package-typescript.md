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

buildTypescript supports esbuild bundling with explicit entry points/outdir. createTsConfig creates a config only when none exists. Use the typed `/presets` and `/tsconfig` public subpaths for environment-specific generation (see below). Review generated options against the application's module/runtime requirements rather than replacing an established tsconfig blindly.

## Loading modes

registerTypescript installs CommonJS require hooks and returns a disposer. It does not enable ESM loading. The separate @zeruxjs/typescript/loader entrypoint integrates with Node's custom ESM loader mechanism. Zerux's application CLI registers its own framework loader for virtual imports and source handling.

## Install and select the integration

```sh
npm install @zeruxjs/typescript@0.0.4
```

There is no automatic `typescript` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Choose transform, build, typecheck or loader registration deliberately. Transforms/bundles remove syntax and may optimize output; only a separate typecheck reports semantic type errors. Browser bundles must use platform browser and a browser target; default platform remains Node. Avoid pulling filesystem/secret-bearing modules into browser entry points.

## TypeScript: inputs, results and ownership

```ts
import { buildTypescript } from '@zeruxjs/typescript';

type Inputs = Parameters<typeof buildTypescript>;
type Result = Awaited<ReturnType<typeof buildTypescript>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof buildTypescript>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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
| `format` | `"esm" \| "cjs" \| "iife"` | Yes |
| `platform` | `"node" \| "browser" \| "neutral"` | Yes |
| `target` | `string` | Yes |
| `bundle` | `boolean` | Yes |
| `minify` | `boolean` | Yes |
| `sourcemap` | `boolean` | Yes |
| `external` | `string[]` | Yes |
| `signal` | `AbortSignal` | Yes |

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
| `preset` | `TypeScriptPresetName` | Yes |
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
| `checkDependencies` | `boolean` | Yes |
| `signal` | `AbortSignal` | Yes |
| `cancellationToken` | `ts.CancellationToken` | Yes |

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
`skipLibCheck:false`, `noUncheckedSideEffectImports:true`, declaration emission, `noEmitOnError`, local `src`/branch/v0.0.4/`dist`
paths and export-map-aware resolution. Run `tsc -p tsconfig.json` in the owning
package to emit declarations. Neither checkTypes nor esbuild emits declarations.
The tooling package does not collect or reexport other packages' public types.

| Preset | Modules/resolution | Globals and conditions |
| --- | --- | --- |
| `node-server` | NodeNext/NodeNext | ES2022, explicit Node types; implicit node/types/import-or-require conditions |
| `browser-library` | ESNext/Bundler | ES2022 + DOM/DOM.Iterable, `types:[]`, additional browser condition |
| `mixed-exports` | NodeNext/NodeNext | Portable ES2022 only, `types:[]`; implicit NodeNext conditions |

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


## Public entry points

Manifest reference for `@zeruxjs/typescript@0.0.4`.

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
    },
    "./presets": {
      "types": "./dist/presets.d.ts",
      "import": "./dist/presets.js"
    },
    "./tsconfig": {
      "types": "./dist/tsconfig.d.ts",
      "import": "./dist/tsconfig.js"
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

## Browser production assets

`buildTypescript({entryPoints, outdir, cwd, platform:'browser', format:'esm', target:'es2022', bundle:true, minify:true, sourcemap:false})` bundles browser JavaScript or CSS entry points. The platform defaults to `node` for backward compatibility. Use browser output with a module script, keep browser-only APIs out of server startup code, and run a separate typecheck. The documentation site uses this API for its production CSS/JavaScript.

## Typed configuration presets

Presets are reusable JSON configuration, available from the browser-safe
`@zeruxjs/typescript/presets` subpath. They contain tooling options only: each
package continues to own its public types, declaration files and `package.json`
export map. No service, hook or optional integration starts on import.

```ts
import { createTsConfig } from '@zeruxjs/typescript/tsconfig';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
import { checkTypes } from '@zeruxjs/typescript';

const preset = createTypeScriptPreset('node-server'); // fresh, typed JSON options
createTsConfig(process.cwd(), { compilerOptions: preset.compilerOptions });
const result = checkTypes({ files: [], checkDependencies: true });
if (!result.ok) {
  console.error(result.status, result.diagnostics);
  process.exitCode = 1;
}
```

For the preset's complete include/exclude patterns (including `.mts`/branch/v0.0.4/`.cts`), use
`createTsConfig(process.cwd(), {preset:'node-server'})`. Existing configs remain
untouched unless `overwrite:true` is explicit. Overrides in `compilerOptions`
win; invalid compiler options reject before writing. Configs are trusted local
build inputs. Run `tsc -p tsconfig.json` in the owning package to emit its own
JavaScript/declarations; `checkTypes` never emits and esbuild emits no declarations.

| Preset | Resolution and conditions | Environment |
| --- | --- | --- |
| `node-server` | `module`/branch/v0.0.4/`moduleResolution: NodeNext`; TypeScript selects `types`, `node`, and per-import `import`/branch/v0.0.4/`require` conditions | ES2022, explicit `types:['node']`; install `@types/node` in the owner |
| `browser-library` | `ESNext`/branch/v0.0.4/`Bundler`, extra `browser` condition; respects package exports | ES2022 + DOM/DOM.Iterable, `types:[]` |
| `mixed-exports` | NodeNext as above, no extra conditions | ES2022 only, `types:[]`; portable shared code |

All presets enable strict checking, declaration emission, `noEmitOnError`,
`skipLibCheck:false`, `noUncheckedSideEffectImports:true`, `rootDir:'src'` and `outDir:'dist'`. They never rewrite a
package's exports or generate a dual ESM/CommonJS build automatically. For mixed
packages, compile/check server and browser entry trees separately with the
corresponding presets and package-local include/output overrides, then maintain
conditional exports and declarations in that package. The portable mixed preset
alone cannot certify environment-specific entries.

[TypeScript custom conditions](https://www.typescriptlang.org/tsconfig/customConditions.html)
are additive: NodeNext always retains its `node` condition. The browser preset
therefore uses Bundler resolution; it requires a bundler for browser dependencies
and does not prove native browser URL resolution. Explicit
[`types:[]`](https://www.typescriptlang.org/tsconfig/types.html) prevents ambient
Node globals leaking in from visible `@types` packages, but is not an import
sandbox: explicitly importing Node-typed modules can bring their declarations in.
Use a separate browser bundle check to reject Node built-ins.

## Diagnostics and cancellation

`checkTypes` retains `{ok,diagnostics}` and adds
`status:'passed'|'failed'|'cancelled'`. Failed checks include raw TypeScript
syntax, semantic, config and resolution diagnostics (including invalid/nonexported
subpaths and missing declaration files). Set `checkDependencies:true` to also
check literal bare imports/reexports, dynamic imports and require calls against
each local source's nearest `package.json`. Diagnostic `95001` means an imported
package is undeclared; `95002` means its owner manifest is missing/invalid.
Built-ins, relative paths, `#imports` and package self-imports are excluded from
this manifest check; TypeScript still checks their resolution. Side-effect imports are also checked when dependency checking is enabled. Missing/malformed
configuration never becomes a passing result.

The declaration check accepts dependencies, devDependencies, peerDependencies and
optionalDependencies as explicit declarations. It does not certify production
versus development dependency placement, evaluate computed imports, prove an
optional dependency is safely guarded, or audit other packages' source. A
workspace `paths` alias may resolve source while hiding a broken published export;
verify packed/installed declaration consumers separately without those aliases.

`checkTypes({files:[],signal})` returns cancelled with `ok:false` and preserves
`signal.reason`. The checker is synchronous: cancellation is cooperative at
checkpoints, with an optional TypeScript `cancellationToken` for synchronous
compiler callbacks; it cannot process a same-thread timer during compilation.
Unexpected compiler/IO exceptions propagate instead of becoming success.

`buildTypescript({...options,signal})` rejects with `name:'AbortError'` on
cancellation and preserves reason/compiler details in `cause`. Its owned esbuild
context is cancelled, listeners removed, and context disposed before settling;
ordinary esbuild failures retain `errors`/branch/v0.0.4/`warnings`. Build output is not atomic:
failed/cancelled builds may leave files, so callers needing promotion guarantees
must use a staging directory. The default target is `node20` for Node/neutral and
`es2022` for browser; `format:'iife'` is also supported. CommonJS registration
validates every extension before changing hooks and returns an idempotent disposer.

## Focused verification

From this package, run `npm run build` then `node --test test/*.test.mjs`.
The foundation check packs the built package and required installed dependencies,
installs them offline into a disposable npm prefix, and checks declarations via
public exports with no source aliases. It also compiles representative server,
browser and portable packages, checks denied Node globals/nonexported subpaths,
undeclared dependencies and cleanup. This requires installed dependencies,
including esbuild's platform binary; all temporary files/cache are removed.
It does not start applications or exercise a live browser. Archive fixtures skip
prepack because the package-local build has already run; this is not a release
publication check.


## Implementation sources

- [packages/@zeruxjs/typescript/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/README.md)
- [packages/@zeruxjs/typescript/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/package.json)
- [packages/@zeruxjs/typescript/src/presets.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/src/presets.ts)
- [packages/@zeruxjs/typescript/src/transform.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/src/transform.ts)
- [packages/@zeruxjs/typescript/src/build.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/src/build.ts)
- [packages/@zeruxjs/typescript/src/tsconfig.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/typescript/src/tsconfig.ts)
