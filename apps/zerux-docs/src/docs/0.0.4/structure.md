---
{
  "title": "Structure",
  "description": "Choose a layout from the implemented discovery and module contracts.",
  "navigation": "structure",
  "section": "Fundamentals",
  "order": 0,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts"
  ],
  "related": [
    "structure-fix",
    "structure-dynamic",
    "structure-function",
    "structure-directories",
    "file-conventions"
  ]
}
---

## All structure types

`ZeruxConfig.type` accepts **`fix`**, **`dynamic`** and **`function`**. The resolver defaults to `fix`. These are accepted structure labels, not browser rendering modes, static-export flags, automatic serverless deployment adapters or separate authorization policies.

| Type | Verified behavior | Start here |
| --- | --- | --- |
| `fix` | Default structure mode, explicit discovery directories and entry module | [Fixed structure](structure-fix.md) |
| `dynamic` | Accepted/resolved mode; shares current directory discovery and request runtime | [Dynamic structure](structure-dynamic.md) |
| `function` | Accepted/resolved mode; resolver selects production environment fallback when NODE_ENV is absent | [Function structure](structure-function.md) |

The current runtime does not branch its route/module discovery on `structure.mode`. Do not promise automatic function-per-route packaging or request-time module rescanning from these names. `dev`/`start` lifecycle mode, hosting configuration and explicit registrations are separate choices.

## Directory and registration styles

- [All directory roles](structure-directories.md): app, middleware, controllers, composables, plugins, public, environment and output.
- [Project structure](project-structure.md): root versus src layouts with explicit overrides.
- [File conventions](file-conventions.md): literal, dynamic and catch-all routes; reserved filenames.
- [Configuration](configuration-structure.md): exact option types and environment order.
- [Explicit modules](structure-modules.md): registered controllers/providers and plugin teardown.
- [Multisite mapping](structure-multisite.md): separate host/path routing; never tenant authorization.

## Rendering and build modes are independent

ZyroJS/React/Vue selection belongs to renderer registration. General [static export](deploy-static.md) is an explicit API, not `type:'fix'`. Node builds, the docs app's own exporter and standalone Zyro build templates are distinct owners. Private files never belong under a public asset root.
