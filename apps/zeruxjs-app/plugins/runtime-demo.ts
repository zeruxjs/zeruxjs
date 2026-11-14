import { defineThreadWorker, defineWorker, type ZeruxPluginApi } from 'zeruxjs';

/** Register trusted runtime examples through the actual generation-owned plugin API.
 * @param {ZeruxPluginApi} api - Borrowed route/middleware/composable/worker registration owner.
 * @returns {void} Declares owned workers; the framework starts/stops them at lifecycle boundaries.
 */
export default (api: ZeruxPluginApi) => {
  api.addThreadWorker(
    'math-thread',
    defineThreadWorker('math-thread', 'workers/math-thread.ts')
  );

  api.addWorker(
    'sample-heartbeat',
    defineWorker('sample-heartbeat', ({ logger, state }) => {
      state.set('sample-heartbeat', {
        startedAt: new Date().toISOString(),
        ticks: 0,
      });

      /** Worker-owned heartbeat timer; the returned worker cleanup clears it on generation shutdown. */
      const timer = setInterval(() => {
        /** Current worker-local state, never a remote identity or cross-process durable record. */
        const current = state.get('sample-heartbeat') as
          | { startedAt: string; ticks: number }
          | undefined;
        state.set('sample-heartbeat', {
          startedAt: current?.startedAt ?? new Date().toISOString(),
          ticks: (current?.ticks ?? 0) + 1,
          lastTickAt: new Date().toISOString(),
        });
      }, 5000);

      logger.info(
        'Sample heartbeat worker registered before HTTP server startup'
      );

      return () => {
        clearInterval(timer);
        logger.info('Sample heartbeat worker cleanup complete');
      };
    })
  );

  api.addMiddleware(
    'plugin-tag',
    async (context: any, next: () => Promise<void>) => {
      context.state.middleware = [
        ...(context.state.middleware ?? []),
        'plugin-tag',
      ];
      await next();
    }
  );

  api.setComposable('pluginSummary', (runtime: any) => ({
    routes: runtime.routes.length,
    publicFiles: runtime.publicFiles.size,
  }));

  api.addRoute({
    pattern: '/plugin/runtime',
    method: 'GET',
    middleware: ['request-context', 'plugin-tag'],
    /** Render the fixed plugin inventory example from host-owned projections.
     * @param {object} context - Borrowed framework context; arbitrary stored content must not enter this raw authored template.
     * @returns {string} Teaching HTML from known runtime fields, not a private administration surface.
     */
    handler(context: any) {
      /** Explicit trusted composable projection; never serialize private service handles into this teaching HTML. */
      const summary = context.services.composables.pluginSummary
        ? context.services.composables.pluginSummary(context.runtime)
        : {};

      return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Plugin Runtime Route</title>
          <style>
            body { margin: 0; font-family: "Segoe UI", sans-serif; background: #10171f; color: #e7eefc; padding: 28px; }
            .panel { max-width: 840px; margin: 0 auto; border: 1px solid rgba(120,183,255,.16); border-radius: 18px; padding: 24px; background: rgba(12,20,34,.88); }
            h1 { margin: 0 0 14px; }
            p { color: #9fb2d1; line-height: 1.7; }
            pre { overflow: auto; padding: 16px; border-radius: 12px; background: rgba(2,6,23,.72); }
          </style>
        </head>
        <body>
          <section class="panel">
            <h1>Plugin-Added Route</h1>
            <p>This page was registered from <code>plugins/runtime-demo.ts</code>.</p>
            <pre>${JSON.stringify(
              {
                requestId: context.state.requestId,
                middleware: context.state.middleware,
                summary,
              },
              null,
              2
            )}</pre>
          </section>
        </body>
      </html>`;
    },
  });

  api.addRoute({
    pattern: '/plugin/workers',
    method: 'GET',
    middleware: ['request-context', 'plugin-tag'],
    /** Invoke only the fixed authored calculation on the registered worker pool.
     * @param {object} context - Borrowed current framework generation context.
     * @returns {Promise<object>} Actual worker metadata/heartbeat/calculation output, never a simulated process.
     */
    async handler(context: any) {
      /** Actual framework-registered worker-thread handle, not a command chosen from request input. */
      const mathThread = context.runtime
        .asPluginApi()
        .getThreadWorker('math-thread');
      /** Actual fixed calculation result, or null when the optional worker handle is absent. */
      const mathResult = mathThread
        ? await mathThread.run({ value: 12 })
        : null;

      return {
        workers: context.runtime
          .asPluginApi()
          .getWorkers()
          .map((worker: any) => worker.name),
        threadWorkers: context.runtime
          .asPluginApi()
          .getThreadWorkers()
          .map((worker: any) => ({
            name: worker.name,
            size: worker.size,
            minThreads: worker.minThreads,
            maxThreads: worker.maxThreads,
          })),
        heartbeat: context.runtime.workerState.get('sample-heartbeat'),
        mathResult,
        middleware: context.state.middleware,
      };
    },
  });
};
