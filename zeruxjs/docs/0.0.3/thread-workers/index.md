# Thread workers in practice

Register CPU work, bound concurrency and deploy the actual worker module.


## Which worker model?

| Model | Use |
| --- | --- |
| Startup worker | Start/stop background resources with the runtime |
| Thread pool | CPU-bound work isolated in worker_threads |
| Redis job queue | Durable scheduling/retries across processes and restarts |

A thread pool has no durable job journal. A startup interval has no cross-replica election. Select the model by the delivery and ownership contract, not only by whether a task runs in the background.

## Register a pool

```ts title="plugins/math.ts"
import { defineThreadWorker, type ZeruxPluginApi } from 'zeruxjs';

/** Register a CPU pool. @param api Runtime registration API. @returns Nothing. Resolves a deployed worker module path. */
export default function register(api: ZeruxPluginApi) {
  api.addThreadWorker('math', defineThreadWorker('math', 'workers/math.js', {
    minThreads: 1, maxThreads: 2
  }));
}
```

The script path resolves relative to the application root unless absolute or a file URL. The module exports default, handler, process or run. Define a pure task where possible:

```js title="workers/math.js"
/** Compute a square. @param {{value:number}} payload Serializable task input. @returns {{squared:number}} Serializable result. No globals. */
export default function math(payload) {
  if (!Number.isFinite(payload.value)) throw new Error('A finite value is required');
  return { squared: payload.value * payload.value };
}
```

## Run a task

Retrieve the pool through the plugin API or runtime plugin adapter and await run(payload). Handle missing registration and rejection. Payload/result values cross Node's structured-clone boundary; do not send sockets, service managers or request contexts.

## Deploy the worker file

The generic compiler source roots do not automatically include an arbitrary workers directory. Ship or compile the referenced worker module explicitly, and verify the path in the production artifact. A successful route build does not prove an external worker script exists. A JavaScript worker can be deployed directly; TypeScript workers depend on the appropriate loader/source availability.

## Capacity and shutdown

Set thread limits for the container's CPU and memory budget. More threads can increase contention, not throughput. Pools stop during generation cleanup and pending/running tasks can reject on shutdown. Use durable queue work when a process crash must not lose the task.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/worker.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/worker.ts)
- [packages/zeruxjs/src/bootstrap/thread-entry.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/thread-entry.ts)
- [packages/zeruxjs/src/commands/project-builder.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/commands/project-builder.ts)
