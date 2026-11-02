# Structure

Choose a layout from the implemented discovery and module contracts.


## All structure types

`ZeruxConfig.type` accepts **`fix`**, **`dynamic`** and **`function`**. The resolver defaults to `fix`. These are accepted structure labels, not browser rendering modes, static-export flags, automatic serverless deployment adapters or separate authorization policies.

| Type | Verified behavior | Start here |
| --- | --- | --- |
| `fix` | Default structure mode, explicit discovery directories and entry module | [Fixed structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-fix.md) |
| `dynamic` | Accepted/resolved mode; shares current directory discovery and request runtime | [Dynamic structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-dynamic.md) |
| `function` | Accepted/resolved mode; resolver selects production environment fallback when NODE_ENV is absent | [Function structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-function.md) |

The current runtime does not branch its route/module discovery on `structure.mode`. Do not promise automatic function-per-route packaging or request-time module rescanning from these names. `dev`/branch/v0.0.4/`start` lifecycle mode, hosting configuration and explicit registrations are separate choices.

## Directory and registration styles

- [All directory roles](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-directories.md): app, middleware, controllers, composables, plugins, public, environment and output.
- [Project structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/project-structure.md): root versus src layouts with explicit overrides.
- [File conventions](/branch/v0.0.4/zeruxjs/docs/0.0.4/file-conventions.md): literal, dynamic and catch-all routes; reserved filenames.
- [Configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-structure.md): exact option types and environment order.
- [Explicit modules](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-modules.md): registered controllers/providers and plugin teardown.
- [Multisite mapping](/branch/v0.0.4/zeruxjs/docs/0.0.4/structure-multisite.md): separate host/path routing; never tenant authorization.

## Rendering and build modes are independent

ZyroJS/React/Vue selection belongs to renderer registration. General [static export](/branch/v0.0.4/zeruxjs/docs/0.0.4/deploy-static.md) is an explicit API, not `type:'fix'`. Node builds, the docs app's own exporter and standalone Zyro build templates are distinct owners. Private files never belong under a public asset root.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/runtime.ts)
