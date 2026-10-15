ZeruxJS sample app for local framework testing.

## Worker Demo

This app registers a sample startup worker and a Node.js thread worker from `plugins/runtime-demo.ts`. Default thread limits are configured in `zerux.config.ts`:

```ts
worker: {
  minThreads: 1,
  maxThreads: 4
}
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3010/plugin/workers
```

The route returns the registered worker names, thread pool details, heartbeat state, and a result from `workers/math-thread.ts`. The startup worker is registered with `api.addWorker(...)` and `defineWorker(...)`; the thread pool is registered with `api.addThreadWorker(...)` and `defineThreadWorker(...)`.
