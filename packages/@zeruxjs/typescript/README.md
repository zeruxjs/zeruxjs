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
