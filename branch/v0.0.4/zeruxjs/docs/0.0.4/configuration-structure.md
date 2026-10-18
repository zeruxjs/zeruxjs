# Project structure and environment configuration

Choose discovery directories, output paths and environment loading without ambiguous config files.


## A complete structure example

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  type: 'fix', entryPoint: 'index', outDir: '.zerux',
  structure: {
    app: 'app', middleware: ['middleware'], controllers: ['controllers'],
    composables: ['composables'], plugins: ['plugins'], public: ['public'],
    env: ['.env.services'],
  },
} satisfies ZeruxConfig;
```

Paths resolve relative to the application root. Keep generated output disjoint from source, uploaded files and secrets. `outDir` selects runtime output; it does not configure this documentation site's static `dist/` exporter. The framework compiler enforces output safety rather than treating any supplied path as disposable.

## Defaults and accepted forms

Without overrides the runtime looks in `app`, `middleware`, `controllers`, `composables`, `plugins` and `public`; the entry module basename is `index`. Directory settings other than `app` accept a string or string array and are normalized/deduplicated. Use a named directory per concern instead of overloading public assets with application modules.

`type` is `fix`, `dynamic` or `function`, defaulting to `fix`. These are runtime structure modes, not React rendering modes or static-export switches. Only choose another mode after reviewing its application-discovery behavior. `multisite: true` separately enables host/path mapping registration; it does not isolate databases or authenticate tenants.

## Environment loading order

The server command loads `.env`, `.env.local`, the selected environment file and its local override before evaluating config. The selected environment uses `NODE_ENV` when provided, otherwise the startup mode's default. Additional `structure.env` files are resolved only after the config has been evaluated, so do not expect them to supply values already read at module top level.

Build and standalone scripts do not necessarily use the server startup loader. Provide required deployment environment variables in the process environment, and treat all values as potentially missing strings. Configuration files are executable modules; validate numbers, required credentials and adapter choices at the owning startup boundary. Never copy private environment files into `public` to make a build work.

## JavaScript equivalent

Use the same object as a default export in `zerux.config.js` for an ESM application. Add `/** @type {import('zeruxjs').ZeruxConfig} */` for editor help. Keep only one active config file; `.ts` takes precedence over `.js`, then `.mjs`, then `.cjs`. The files are not merged.

## Production structure

Development discovers sources with the framework loader. Production start resolves the built structure and generated metadata. Build first; do not infer that a working development route proves the compiled layout includes that file. Verify source maps, public assets, plugins and application modules in the production output, then start the compiled application from its intended root.

If a route disappears, check the relative app path, supported file conventions, ignored/build directories, filename casing and whether a stale higher-priority configuration file is loaded. A file under `public` is directly exposed; a file under controllers is reusable code, not automatically a public HTTP route.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### ZeruxStructureConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `app` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `middleware` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `controllers` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `composables` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `plugins` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `public` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `env` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
