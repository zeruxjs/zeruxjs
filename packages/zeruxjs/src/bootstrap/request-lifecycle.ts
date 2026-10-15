import type { IncomingMessage, ServerResponse } from 'node:http';

/** Keeps a runtime generation alive while response streams from that generation are in flight. */
export function createRequestLifecycle(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  options: { drainTimeoutMs?: number } = {}
) {
  const timeoutMs = options.drainTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new RangeError('Invalid request drain timeout');
  let draining = false;
  let active = 0;
  let closePromise: Promise<void> | undefined;
  const pending = new Set<ServerResponse>();
  const waiters = new Set<() => void>();
  const ready = () => { if (active === 0) { for (const resolve of waiters) resolve(); waiters.clear(); } };
  return {
    get activeRequests() { return active; },
    get draining() { return draining; },
    handle(req: IncomingMessage, res: ServerResponse) {
      if (draining) {
        if (!res.headersSent) { res.statusCode = 503; res.setHeader('retry-after', '1'); }
        res.end(); return Promise.resolve();
      }
      active++;
      pending.add(res);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        res.off('finish', finish); res.off('close', finish);
        pending.delete(res); active--; ready();
      };
      res.once('finish', finish);
      res.once('close', finish);
      let call: Promise<void>;
      try { call = Promise.resolve(handler(req, res)); }
      catch (error) { call = Promise.reject(error); }
      // A streaming handler may resolve long before the response has finished.
      return call.catch(error => {
        if (!res.destroyed && !res.writableEnded) res.destroy(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
    },
    /** Wait for completion; end lingering responses at the bounded deadline. */
    drain() {
      if (closePromise) return closePromise;
      draining = true;
      closePromise = (async () => {
        if (!active) return;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            new Promise<void>(resolve => waiters.add(resolve)),
            new Promise<void>(resolve => { deadline = setTimeout(() => {
              for (const response of pending) response.destroy(new Error('Runtime generation drain timeout'));
              resolve();
            }, timeoutMs); deadline.unref?.(); })
          ]);
        } finally { if (deadline) clearTimeout(deadline); }
      })();
      return closePromise;
    }
  };
}
