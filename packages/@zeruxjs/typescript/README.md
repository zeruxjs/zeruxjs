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
