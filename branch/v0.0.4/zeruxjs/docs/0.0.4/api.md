# Framework API overview

Navigate the public contracts by responsibility, then inspect exact import paths.

## Start with a contract

- [Configuration reference](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md): project structure, hosts, service startup and runtime settings.
- [Request context](/branch/v0.0.4/zeruxjs/docs/0.0.4/context-reference.md): params, query, state, services and response access.
- [Plugin API](/branch/v0.0.4/zeruxjs/docs/0.0.4/plugin-reference.md): registrations and generation ownership.
- [Response API](/branch/v0.0.4/zeruxjs/docs/0.0.4/response-reference.md): cache policies, streams, redirects and deliberate errors.
- [Workers](/branch/v0.0.4/zeruxjs/docs/0.0.4/workers.md): startup cleanup and thread-pool tasks.
- [Fetch bridge](/branch/v0.0.4/zeruxjs/docs/0.0.4/fetch-handlers.md): interoperable Web Request/Response handlers.
- [Template variables](/branch/v0.0.4/zeruxjs/docs/0.0.4/template-variables.md): bounded interpolation and escaping.

## Import paths

Use public export-map entries. Private source paths and generated dist internals are not stable application imports.

## Public entry points

Manifest reference for `zeruxjs@0.0.4`.

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
    },
    "./modules": {
      "types": "./dist/modules.d.ts",
      "import": "./dist/modules.js"
    },
    "./service-endpoints": {
      "types": "./dist/service-endpoints.d.ts",
      "import": "./dist/service-endpoints.js"
    },
    "./graphql": {
      "types": "./dist/graphql.d.ts",
      "import": "./dist/graphql.js"
    },
    "./renderers": {
      "types": "./dist/renderers.d.ts",
      "import": "./dist/renderers.js"
    },
    "./browser-navigation": {
      "types": "./dist/browser-navigation.d.ts",
      "import": "./dist/browser-navigation.js"
    },
    "./navigation-manifest": {
      "types": "./dist/navigation-manifest.d.ts",
      "import": "./dist/navigation-manifest.js"
    },
    "./actions": {
      "types": "./dist/actions.d.ts",
      "import": "./dist/actions.js"
    },
    "./action-stores": {
      "types": "./dist/action-stores.d.ts",
      "import": "./dist/action-stores.js"
    },
    "./action-form": {
      "types": "./dist/action-form.d.ts",
      "import": "./dist/action-form.js"
    },
    "./action-stores/sqlite": {
      "types": "./dist/action-sqlite-store.d.ts",
      "import": "./dist/action-sqlite-store.js"
    },
    "./static-export": {
      "types": "./dist/static-export.d.ts",
      "import": "./dist/static-export.js"
    },
    "./route-data-cache": {
      "types": "./dist/route-data-cache.d.ts",
      "import": "./dist/route-data-cache.js"
    },
    "./privacy": {
      "types": "./dist/privacy.d.ts",
      "browser": null,
      "import": "./dist/privacy.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/cache": "0.0.4",
    "@zeruxjs/db": "0.0.4",
    "@zeruxjs/hooks": "0.0.4",
    "@zeruxjs/lint": "0.0.4",
    "zclivo": "0.0.4",
    "zforge": "0.0.4",
    "zhost": "0.0.4",
    "zlook": "0.0.4"
  },
  "peerDependencies": {
    "@zeruxjs/db-sqlite": "0.0.4",
    "@zeruxjs/queue": "0.0.4",
    "@zeruxjs/security": "0.0.4",
    "@zeruxjs/validator": "0.0.4",
    "parse5": "7.3.0"
  },
  "bin": {
    "zerux": "./dist/bin/zerux.js"
  }
}
```


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
