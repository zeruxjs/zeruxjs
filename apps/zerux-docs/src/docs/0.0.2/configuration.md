---
{
  "title": "Configuration",
  "description": "Configure the runtime in zerux.config.ts.",
  "section": "Fundamentals",
  "order": 30,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

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

See [zerux.config.js](zerux-config.md) for an ESM JavaScript example, file precedence, environment timing and the documentation app configuration.
