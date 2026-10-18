# TypeScript application development

Use strict typed configuration, request contexts and inferred package option types without confusing compilation with validation.


## Choose JavaScript or TypeScript deliberately

ZeruxJS accepts JavaScript configuration and TypeScript configuration. JavaScript projects can use JSDoc with `checkJs`; TypeScript projects can use `satisfies ZeruxConfig`. Do not keep competing config files and expect them to merge. The loader's precedence is TypeScript, JavaScript, MJS, then CJS, so an old `zerux.config.ts` can hide a newly edited JavaScript file.

## Install development tools

```sh
npm install zeruxjs @zeruxjs/typescript
npm install --save-dev typescript @types/node
```

The compiler package wraps transpilation and an optional fast bundler. Transpilation removes type syntax; it is not a full typecheck. Run a separate compiler check in development and before release. In this repository, workspace packages come from the current checkout; an external application uses the version actually installed from npm.

## A strict Node project

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["app/**/*.ts", "plugins/**/*.ts", "server/**/*.ts", "zerux.config.ts"]
}
```

`DOM` provides Fetch/Headers/Response types used by browser-neutral adapters; it does not make `window` or `document` exist on the server. Keep browser entry points separate from server configuration and secrets. Use ESM-compatible imports: a `.js` relative import in TypeScript can describe the JavaScript path produced by a build. NodeNext resolution follows the installed package's export map.

## Type an application config

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
const cache = {
  connector: 'memory', options: { maxEntries: 1000 },
  defaultTtlSeconds: 60, prefix: 'application:v1',
} satisfies NonNullable<ZeruxConfig['cache']>;
export default { type: 'fix', cache } satisfies ZeruxConfig;
```

For JavaScript use `/** @type {import('zeruxjs').ZeruxConfig} */` before the default object, and enable `allowJs`/`checkJs` in a separate checker configuration if needed. The root config permits custom keys, so checking a nested known service type is more effective at finding misspelled service options than relying on the open root type alone.

## Type package options and results

```ts
import { createCacheManager } from '@zeruxjs/cache';
type CacheOptions = Parameters<typeof createCacheManager>[0];
type Cache = Awaited<ReturnType<typeof createCacheManager>>;
const options: CacheOptions = { helper: 'memory', prefix: 'demo', defaultTtlSeconds: 30 };
async function withCache(): Promise<void> {
  const cache: Cache = await createCacheManager(options);
  try { await cache.set('ready', true); }
  finally { await cache.close(); }
}
```

This approach stays aligned with installed declarations without importing internal source files or inventing an exported `Options` name. Overloaded and generic factories may require more specific public types; package guides list the relevant contracts. Keep `unknown` at untrusted JSON boundaries and validate it before narrowing. An `as` cast only changes the compiler's belief.

## Request contexts and plugins

Use the framework's exported `ZeruxRequestContext` and `ZeruxPluginApi` for application integration. Service lookup should use the concrete service type from its owning factory. TypeScript does not prove that an optional service was enabled; check the lookup result and the relevant ready/degraded state before use. Do not use a non-null assertion merely to avoid handling a missing backend.

Virtual specifiers such as `db:reporting` are loader-owned. A plain TypeScript/Node execution does not automatically resolve them; use a real manager import in standalone scripts. Keep any custom declaration mappings local to the application's generated virtual module contract rather than hiding unresolved imports with a catch-all `declare module '*'`.

## Runtime data still needs validation

Environment values are strings or undefined. Parse numeric ports/timeouts, reject missing required credentials at startup, and validate uploaded JSON, query parameters and persisted snapshots. Schema types can infer validated output, but a TypeScript interface alone cannot reject an HTTP payload. See [validation](/zeruxjs/docs/0.0.3/package-validator.md) for bounded Fetch adapters.

## Build, check and troubleshoot

Run `npx tsc --noEmit` against the checker project separately from `zerux build`. Test the compiled production output too: development loader behavior can differ from ordinary Node execution. If an API seems missing, inspect the installed version and export map, then verify the `.d.ts` file resolves from that version. Avoid importing `src/` or unexported `dist/` paths to work around a version mismatch.

If `process` is missing, install Node types and include them. If browser globals are missing, select the appropriate DOM libraries only for files that actually use browser APIs. If an ESM import fails, check `package.json` type, extension and export conditions before adding a custom loader. A passing typecheck does not connect databases, send email, test Redis or certify a browser hydration flow.


## Implementation sources

- [packages/@zeruxjs/typescript/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/typescript/README.md)
- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
