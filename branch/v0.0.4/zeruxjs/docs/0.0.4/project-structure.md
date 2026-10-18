# Project structure

Keep routes, application logic and extensions separate.


## Default folders

app contains file routes. middleware contains global request middleware. controllers and composables hold reusable application logic. plugins extend the runtime. public contains directly served assets.

```text
app/
  page.ts
  api/health/route.ts
middleware/
controllers/
composables/
plugins/
public/
zerux.config.ts
```

## Override discovery

The structure option changes discovery directories. Plugin, middleware, controller, composable and public directories can be a string or an array. An entryPoint names an optional application registration module.

## Build artifacts

The application compiler stages output beneath .zerux/build. Keep generated artifacts out of source control. The documentation app has its own static export pipeline and writes dist instead.

## Organize by exposure and ownership

Routes define public entry points. Controllers/composables contain reusable server logic; plugins register runtime resources; private storage and migration files remain outside public assets. A public folder is not an appropriate place for configuration, signed tokens, database backups or user uploads that require authentication.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  entryPoint: 'index', outDir: '.zerux',
  structure: {
    app: 'src/app', middleware: ['src/middleware'],
    controllers: ['src/controllers'], composables: ['src/composables'],
    plugins: ['src/plugins'], public: ['public'],
  },
} satisfies ZeruxConfig;
```

These paths resolve from the application root. The entryPoint is a basename used for application registration, not a URL prefix. Keep module basenames unambiguous when the loader also registers shorthand names. A filesystem move can change route inference or a registry key even if TypeScript relative imports still compile.

## Build and editor alignment

Use a strict tsconfig whose include paths match the chosen source layout. The compiler and runtime discovery are different mechanisms: adding a folder to tsconfig does not make it a public route, and adding a file to public does not make it private TypeScript source. Use the [structure/environment reference](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-structure.md) for exact accepted values and startup order.

Build output should be generated, disjoint from sources and reproducible from the lockfile. Verify the built module/public layout before deployment rather than copying a development working directory with secrets and caches. The docs application's dist folder is its separate static pipeline and should not be confused with runtime outDir.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
