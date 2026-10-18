# Configuration

Configure database, cache, services and application structure in zerux.config.js or zerux.config.ts.


## Runtime settings, not just site metadata

The config file owns database connections, cache, managed services, workers, host policy and application structure. The runtime server loads it and initializes configured services before application modules run. Importing the file alone does not initialize those services. The documentation site's static exporter consumes only its custom `documentation` namespace and does not start the server runtime.

## Typed configuration

Use ZeruxConfig for editor support. allowedDomains limits application hosts; configure real deployment hosts. Development domains and ports belong to your own environment.

```ts
import type { ZeruxConfig } from "zeruxjs";

export default {
  type: "fix",
  allowedDomains: ["example.com"],
  worker: { minThreads: 1, maxThreads: 4 },
} satisfies ZeruxConfig;
```

## Environment

The loader considers .env, .env.local and environment-specific variants. Keep secret values out of configuration committed to Git, logs and public responses. Read values through process.env or the runtime environment context.

## Services and structure

Configuration supports database/db, cache, files, email, analytics, tags, reports, queue, protocols, theme, websocket, multisite and structure. Each service has its own startup options; consult the installed TypeScript declarations before enabling it.

## JavaScript configuration

See [zerux.config.js](/zeruxjs/docs/0.0.3/zerux-config.md) for an ESM JavaScript example, file precedence, environment timing and the documentation app configuration.

## Select settings by consumer

Use the [configuration handbook](/zeruxjs/docs/0.0.3/configuration-reference.md) rather than guessing a top-level key from a package name. Managed services are database, cache, files, email, analytics, tags, reports and queue. Other packages are explicitly initialized in plugins, handlers, workers or browser components.

A type declaration can include compatibility/custom fields without a runtime consumer. In particular, an auth or security object does not automatically install login/CSRF/header middleware. The runtime service adapters map options into the owning package factories, and those factory shapes are not always identical to the config shapes.

## Check one feature at a time

Start with structure/server policy and one working route. Add an adapter, configure its environment values, enable the service and verify one real operation. Then test its outage and shutdown behavior before adding another service. This makes a missing credential distinguishable from an import/path/type error.

For TypeScript, validate nested options with NonNullable<ZeruxConfig['cache']> or the matching service field in addition to the root type. The root index signature permits custom keys, so a typo accepted at root is not evidence of correct setup. JavaScript projects can use JSDoc and checkJs for editor diagnostics.

## Configuration is not client state

Bootstrap strips raw private service settings from public runtime configuration. Keep the original module object server-side anyway; do not expose it through a debug route or serialize an environment object. An application-specific metadata namespace should contain only values intended for its actual consumer.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
