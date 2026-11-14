import type { IncomingMessage, ServerResponse } from 'node:http';

/** Keep a generation admitted through native response termination, including streams whose handlers already returned.
 * @param {(req: IncomingMessage, res: ServerResponse) => Promise<void> | void} handler - Borrowed request handler; the wrapper does not bind a server.
 * @param {{ drainTimeoutMs?: number }} options - Generation drain policy.
 * @param {number} [options.drainTimeoutMs] - Integer100–300000ms response-drain deadline.
 * @returns {object} Response observation/admission handle with an explicit drain operation.
 */
export function createRequestLifecycle(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  options: { drainTimeoutMs?: number } = {}
) {
  /** Validated drain deadline; deadline expiry destroys lingering native responses. */
  const timeoutMs = options.drainTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 300_000
  ) {
    throw new RangeError('Invalid request drain timeout');
  }
  let draining = false;
  let active = 0;
  let closePromise: Promise<void> | undefined;
  /** Owned response observations retaining generation admission until terminal finish/close. */
  const pending = new Set<ServerResponse>();
  /** Drain waiters notified only when the active-response count reaches zero. */
  const waiters = new Set<() => void>();
  /** Resolve retained drain waiters once every admitted response terminates.
   * @returns {void} Clears the waiter set when the generation has no active responses.
   */
  const ready = () => {
    if (active === 0) {
      for (const resolve of waiters) {
        resolve();
      }
      waiters.clear();
    }
  };
  return {
    get activeRequests() {
      return active;
    },
    get draining() {
      return draining;
    },
    /** Reject new work after draining starts and retain admitted response ownership until finish/close.
     * @param {IncomingMessage} req - Borrowed native request.
     * @param {ServerResponse} res - Borrowed native response.
     * @returns {Promise<void>} Handler settlement; stream completion is separately observed by drain.
     */
    handle(req: IncomingMessage, res: ServerResponse) {
      if (draining) {
        if (!res.headersSent) {
          res.statusCode = 503;
          res.setHeader('retry-after', '1');
        }
        res.end();
        return Promise.resolve();
      }
      active++;
      pending.add(res);
      let finished = false;
      /** Release this response admission exactly once and detach both terminal listeners.
       * @returns {void} Updates generation draining independently of handler promise completion.
       */
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        res.off('finish', finish);
        res.off('close', finish);
        pending.delete(res);
        active--;
        ready();
      };
      res.once('finish', finish);
      res.once('close', finish);
      let call: Promise<void>;
      try {
        call = Promise.resolve(handler(req, res));
      } catch (error) {
        call = Promise.reject(error);
      }
      // A streaming handler may resolve long before the response has finished.
      return call.catch((error) => {
        if (!res.destroyed && !res.writableEnded) {
          res.destroy(
            error instanceof Error ? error : new Error(String(error))
          );
        }
        throw error;
      });
    },
    /** Stop admission and await terminal responses until the declared deadline, then destroy lingering responses.
     * @returns {Promise<void>} Shared idempotent drain result; arbitrary handler promises are not force-cancelled.
     */
    drain() {
      if (closePromise) {
        return closePromise;
      }
      draining = true;
      closePromise = (async () => {
        if (!active) {
          return;
        }
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            new Promise<void>((resolve) => waiters.add(resolve)),
            new Promise<void>((resolve) => {
              deadline = setTimeout(() => {
                for (const response of pending) {
                  response.destroy(
                    new Error('Runtime generation drain timeout')
                  );
                }
                resolve();
              }, timeoutMs);
              deadline.unref?.();
            }),
          ]);
        } finally {
          if (deadline) {
            clearTimeout(deadline);
          }
        }
      })();
      return closePromise;
    },
  };
}
