---
{
  "title": "ZyroJS, SQLite and a queue",
  "description": "One explicit public SSR page and reference-only BullMQ job.",
  "navigation": "examples",
  "section": "Fundamentals",
  "order": 0,
  "sources": [
    "apps/zerux-docs/examples/renderer-data-queue.mjs",
    "packages/zeruxjs/src/renderers.ts",
    "packages/@zeruxjs/db-sqllite/src/index.ts",
    "packages/@zeruxjs/queue-bullmq/src/index.ts"
  ],
  "related": [
    "examples",
    "rendering",
    "package-db-sqlite",
    "package-queue-bullmq"
  ]
}
---

## What this example implements

ZyroJS renders a public synthetic SQLite row through the ZeruxJS renderer registry. A BullMQ worker reads the same bounded data using an opaque known reference. No private subject data, cookie identity, hidden migration, browser hydration or mutation/outbox atomicity is implied.

The complete [public-import source](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/examples/renderer-data-queue.mjs) exports `initializeTutorialDatabase` and `registerTutorial`. Importing it creates no database, queue or listener. Copy that authored file into `src/tutorial.mjs` in a local application; no import from package `src`/`dist` internals is needed.

## Prerequisites

Use Node >=24.15.0 with native SQLite and the compatible workspace contracts (ecosystem packages 0.0.4). Install `zeruxjs`, `zyrojs`, `@zeruxjs/db-sqlite` and `@zeruxjs/queue-bullmq` explicitly. Registry versions may precede these source changes. A real isolated Redis endpoint is needed for native BullMQ execution; this docs build never starts one. Protect the endpoint and private absolute database location through host configuration.

```js title="zerux.config.mjs"
export default {
  type: 'fix', entryPoint: 'src/index',
  structure: { app: 'app', public: ['public'] },
  server: { port: 3000, devPort: 3000 },
};
```

## Prepare data explicitly

From the project root, using a NEW disposable database path with a private existing parent directory:

```js title="scripts/init.mjs"
import { initializeTutorialDatabase } from '../src/tutorial.mjs';
if (!process.env.TUTORIAL_DB) throw Error('Set TUTORIAL_DB to a new disposable file');
await initializeTutorialDatabase(process.env.TUTORIAL_DB);
```

Run this script once, explicitly. It creates the table and one synthetic note in a synchronous transaction; an existing table rejects instead of truncating it. Production schemas require reviewed migrations and backups. No identity is inferred from the tutorial data.

## Register and enqueue

```js title="src/index.mjs"
import { registerTutorial } from './tutorial.mjs';
export default async function register(api) {
  const {TUTORIAL_DB, TUTORIAL_REDIS_URL} = process.env;
  const tutorial = await registerTutorial(api, {
    filename: TUTORIAL_DB, redisUrl: TUTORIAL_REDIS_URL,
  });
  await tutorial.enqueueSnapshot(); // explicit repeatable read job, not an HTTP mutation
}
```

Run `zerux build`, inspect its output, then `zerux start` with those private environment values. GET `/` returns complete HTML with “Public notes” and “A public synthetic note”; JavaScript is unnecessary. The worker returns `{count:1}` after processing the reference. This example starts a worker in this one local process: real deployments should register workers only in designated processes. Startup enqueue can run on each generation; it demonstrates an idempotent read, not durable business event deduplication.

## Failure and cleanup

Missing schema or Redis startup failure rejects registration and closes the database. Shutdown closes the queue before its database dependency. Neither synchronous SQLite transactions nor queue jobs make database and broker commits atomic. Side effects need their own durable idempotency/outbox policy. Never automatically replay an ambiguous mutation or expose `enqueueSnapshot` as an unauthenticated HTTP endpoint.

Focused documentation fixtures execute the real SQLite/renderer code with an injected queue and test denial, queue startup failure and cleanup. They do not exercise live Redis, worker crash recovery, TLS or a browser. Native broker acceptance is an explicitly separate operation on disposable infrastructure.
