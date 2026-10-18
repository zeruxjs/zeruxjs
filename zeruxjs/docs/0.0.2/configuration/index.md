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

See [zerux.config.js](/zeruxjs/docs/0.0.2/zerux-config.md) for an ESM JavaScript example, file precedence, environment timing and the documentation app configuration.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
