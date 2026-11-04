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

For the preset's complete include/exclude patterns (including `.mts`/`.cts`), use
`createTsConfig(process.cwd(), {preset:'node-server'})`. Existing configs remain
untouched unless `overwrite:true` is explicit. Overrides in `compilerOptions`
win; invalid compiler options reject before writing. Configs are trusted local
build inputs. Run `tsc -p tsconfig.json` in the owning package to emit its own
JavaScript/declarations; `checkTypes` never emits and esbuild emits no declarations.

| Preset | Resolution and conditions | Environment |
| --- | --- | --- |
| `node-server` | `module`/`moduleResolution: NodeNext`; TypeScript selects `types`, `node`, and per-import `import`/`require` conditions | ES2022, explicit `types:['node']`; install `@types/node` in the owner |
| `browser-library` | `ESNext`/`Bundler`, extra `browser` condition; respects package exports | ES2022 + DOM/DOM.Iterable, `types:[]` |
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
ordinary esbuild failures retain `errors`/`warnings`. Build output is not atomic:
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
