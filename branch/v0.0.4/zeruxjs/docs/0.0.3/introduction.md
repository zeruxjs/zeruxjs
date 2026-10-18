# Introduction

A shared server runtime for the ZeruxJS ecosystem.


## One application runtime

ZeruxJS connects file routes, middleware, controllers, plugins and background workers. Applications return HTML, JSON, redirects or streams. The server lifecycle initializes shared services and coordinates development reloads.

## Release status

The repository is at 0.0.3 and remains early development. The create-zerux-js scaffolder currently provides help and version output only. React, Vue and Zyro integration packages exist, but package presence does not imply a complete rendering adapter. These docs distinguish implemented runtime APIs from future plans.

## Choose your path

Begin with Installation and Routing, then add middleware and plugins. Use Workers for background services, Services for shared managers, and Deployment for production builds. The package directory records every public package and its actual export paths.

## A practical learning path

Start with [installation](/branch/v0.0.4/zeruxjs/docs/0.0.3/installation.md), run the [notes tutorial](/branch/v0.0.4/zeruxjs/docs/0.0.3/tutorial.md), then read the [runtime mental model](/branch/v0.0.4/zeruxjs/docs/0.0.3/mental-model.md). Add one service at a time from the [configuration handbook](/branch/v0.0.4/zeruxjs/docs/0.0.3/configuration-reference.md). This ordering lets you distinguish route/module errors from an unavailable database or queue before several failures interact.

The framework coordinates application startup, file discovery, request dispatch, plugins and owned services. Focused packages also work outside that runtime, but a standalone factory does not inherit application configuration or shutdown automatically. The package directory shows the implementation contract for each installed release, including honest placeholder status for future CMS/generator packages.

## JavaScript and TypeScript

An ESM JavaScript application can export a JSDoc-typed `zerux.config.js`; a TypeScript application can use `zerux.config.ts` with `satisfies ZeruxConfig`. Both configure the same runtime. Neither a type annotation nor package installation automatically enables a database, authentication policy, React renderer or static-export pipeline.

Use the [TypeScript chapter](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md) for strict checks, public option inference, request contexts and browser/server boundaries. Treat request bodies and environment variables as untrusted runtime inputs even when the surrounding application is fully typed.

## Learn the boundaries before deploying

The current create packages are placeholders, so manual setup is the supported starting path. The docs site itself is a static exporter using workspace packages; its configuration's documentation namespace is not a built-in general-purpose static-site feature. Read [capabilities](/branch/v0.0.4/zeruxjs/docs/0.0.3/capabilities.md) and each guide's lifecycle/failure section before interpreting a roadmap or README headline as a completed integration.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
