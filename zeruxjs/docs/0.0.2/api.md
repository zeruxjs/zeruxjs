# Framework API overview

Navigate the public contracts by responsibility, then inspect exact import paths.

## Start with a contract

- [Configuration reference](/zeruxjs/docs/0.0.2/configuration-reference.md): project structure, hosts, service startup and runtime settings.
- [Request context](/zeruxjs/docs/0.0.2/context-reference.md): params, query, state, services and response access.
- [Plugin API](/zeruxjs/docs/0.0.2/plugin-reference.md): registrations and generation ownership.
- [Response API](/zeruxjs/docs/0.0.2/response-reference.md): cache policies, streams, redirects and deliberate errors.
- [Workers](/zeruxjs/docs/0.0.2/workers.md): startup cleanup and thread-pool tasks.
- [Fetch bridge](/zeruxjs/docs/0.0.2/fetch-handlers.md): interoperable Web Request/Response handlers.
- [Template variables](/zeruxjs/docs/0.0.2/template-variables.md): bounded interpolation and escaping.

## Import paths

Use public export-map entries. Private source paths and generated dist internals are not stable application imports.

## Public entry points

Manifest reference for `zeruxjs@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./navigation": "./dist/navigation.js",
    "./accessibility": {
      "types": "./dist/accessibility.d.ts",
      "import": "./dist/accessibility.js"
    },
    "./cache": "./dist/cache-api.js",
    "./loader": "./dist/loader/register-loader.js",
    "./database": "./dist/bootstrap/database.js",
    "./cache-runtime": "./dist/bootstrap/cache.js",
    "./schema/schema.config.json": "./assets/json/schema.config.json",
    "./theme": "./dist/theme.js",
    "./protocols": "./dist/protocols.js",
    "./response": "./dist/response.js",
    "./fetch-route": "./dist/fetch-route.js",
    "./services": {
      "types": "./dist/bootstrap/services.d.ts",
      "import": "./dist/bootstrap/services.js"
    },
    "./build": {
      "types": "./dist/commands/project-builder.d.ts",
      "import": "./dist/commands/project-builder.js"
    },
    "./variables": {
      "types": "./dist/variables.d.ts",
      "import": "./dist/variables.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/cache": "0.0.2",
    "@zeruxjs/db": "0.0.2",
    "@zeruxjs/lint": "0.0.2",
    "zforge": "0.0.2",
    "@zeruxjs/hooks": "0.0.2",
    "zlook": "0.0.2",
    "zhost": "0.0.2",
    "zclivo": "0.0.2"
  },
  "peerDependencies": {
    "@zeruxjs/queue": "0.0.2"
  },
  "bin": {
    "zerux": "./dist/bin/zerux.js"
  }
}
```


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
