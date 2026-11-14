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

## Match ownership to the kind of work

A lifecycle worker starts with a runtime generation and returns cleanup. A thread worker executes CPU-oriented tasks with explicit pool limits. A queue worker consumes durable Redis jobs with retry/idempotency semantics. Do not use a module-level interval as an undocumented substitute for any of these owners.

Configure worker.minThreads/maxThreads for thread defaults; configure queue.workers separately for BullMQ processors. Each replica multiplies the configured concurrency. A process-local memory map or semaphore cannot enforce a deployment-wide rate limit.

## TypeScript and startup failures

Use defineWorker/defineThreadWorker and exported context types. Keep task inputs serializable and validate unknown request fields before starting work. A task result type does not make a multi-operation database action atomic. Preserve cancellation and distinguish an intentional abort from a retryable infrastructure failure.

Test worker startup failure before activation, cleanup after a later resource fails, shutdown with in-flight work and replacement generation startup. The old active runtime should not be discarded merely because preparing a replacement failed. Ensure all owned timers/subscriptions release even when one cleanup rejects.

## Production operating policy

Observe queue lag, thread memory and downstream capacity rather than maximizing counts blindly. CPU work can block event-loop progress and prevent queue lock renewal; move it to the correct worker strategy. For external effects such as mail/payment, persist idempotency and ambiguous outcomes so a retried task does not repeat an irreversible action.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
