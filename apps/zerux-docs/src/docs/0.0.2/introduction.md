---
{
  "title": "Introduction",
  "description": "A shared server runtime for the ZeruxJS ecosystem.",
  "section": "Getting started",
  "order": 0,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "installation",
    "routing",
    "plugins"
  ]
}
---

## One application runtime

ZeruxJS connects file routes, middleware, controllers, plugins and background workers. Applications return HTML, JSON, redirects or streams. The server lifecycle initializes shared services and coordinates development reloads.

## Release status

The repository is at 0.0.2 and remains early development. The create-zerux-js scaffolder currently provides help and version output only. React, Vue and Zyro integration packages exist, but package presence does not imply a complete rendering adapter. These docs distinguish implemented runtime APIs from future plans.

## Choose your path

Begin with Installation and Routing, then add middleware and plugins. Use Workers for background services, Services for shared managers, and Deployment for production builds. The package directory records every public package and its actual export paths.
