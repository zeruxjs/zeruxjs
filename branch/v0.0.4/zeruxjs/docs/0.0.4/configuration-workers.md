# Worker configuration

Set thread defaults and distinguish lifecycle workers, queue workers and thread jobs.


## Choose the correct worker model

There are three different lifetimes: lifecycle workers belong to one runtime generation, thread workers run registered CPU tasks, and queue workers consume durable Redis jobs. `worker.minThreads` and `worker.maxThreads` configure thread defaults; they do not make arbitrary asynchronous functions durable or create BullMQ queues.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  worker: { minThreads: 1, maxThreads: 4 },
} satisfies ZeruxConfig;
```

The implementation normalizes positive integer thread counts. Minimum defaults to one, and maximum defaults to at least the minimum. These are defaults used by worker registration; inspect a specific pool's options before assuming a config-level number overrides every pool. Tune against memory per worker and the cost of loading the application, not only CPU core count.

## Register work explicitly

Use the framework's worker definitions and plugin registration APIs. Keep an application task's input serializable, validate it before sending to a thread, and decide what happens when the caller aborts. A thread result is not a database transaction. Avoid passing open database clients, raw request objects or secrets into a worker merely because TypeScript permits an unknown-shaped payload.

Lifecycle workers should return cleanup for timers, subscriptions and owned handles. Runtime generations can overlap while old requests drain: a global singleton timer can therefore run twice unless its ownership is explicit. Queue processors need idempotency and durable state because delivery may be repeated after a crash or timeout.

## TypeScript

Use the exported worker/context types and `defineWorker` / `defineThreadWorker` APIs rather than writing a catch-all function signature. A contextual type describes the host interface but does not guarantee the configured service is available. Check optional services and distinguish an application cancellation from a task failure.

## Verification and operations

Test success, validation failure, timeout/cancellation, worker failure and application shutdown. Measure throughput and memory at the expected concurrency. When scaling replicas, multiply the per-process thread/queue counts to obtain deployment-wide concurrency. A cache prefix or thread count does not coordinate a cluster. See the dedicated guides for real task examples and shutdown contracts.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### ZeruxWorkerConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `minThreads` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxThreads` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
