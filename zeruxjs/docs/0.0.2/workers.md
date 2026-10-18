# Workers and threads

Separate startup services from CPU-intensive tasks.


## Startup workers

Startup workers run after bootstrap and before HTTP requests are accepted. A handler receives runtime, mode, config, structure, logger, env and state. Return cleanup for intervals, queues and sockets.

```ts
import { defineWorker, type ZeruxPluginApi } from "zeruxjs";

/** Register a managed service. @param api Runtime API. @returns Nothing. */
export default function register(api: ZeruxPluginApi) {
  api.addWorker("heartbeat", defineWorker("heartbeat", ({ logger }) => {
    const timer = setInterval(() => logger.info("alive"), 30000);
    return () => clearInterval(timer);
  }));
}
```

## Thread pools

defineThreadWorker(name, script, options) describes a Node worker_threads pool. Register it with api.addThreadWorker, retrieve it with api.getThreadWorker and await pool.run(payload). The worker module exports a function. Configure sensible minThreads and maxThreads for the deployment CPU budget.

## Shutdown

Reload and shutdown stop pools and run worker cleanup. Keep tasks bounded and account for rejection when a pool shuts down. Do not use CPU worker pools as a substitute for a durable job queue.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
