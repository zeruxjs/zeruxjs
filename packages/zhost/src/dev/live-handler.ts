import type { IncomingMessage, ServerResponse } from 'node:http';

export type LiveHttpHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

/**
 * Upgrade a running dev server without rebinding its listening socket. The
 * current handler is captured for each request so in-flight responses keep the
 * previous runtime even if a later request uses the new one.
 */
export function createLiveRequestHandler(initial: LiveHttpHandler) {
  let current = initial;
  let generation = 1;
  return {
    handle(req: IncomingMessage, res: ServerResponse) {
      const handler = current;
      try { Promise.resolve(handler(req, res)).catch(error => {
        if (!res.headersSent) { res.statusCode = 500; res.end('Internal Server Error'); }
        else res.destroy(error instanceof Error ? error : new Error(String(error)));
      }); } catch (error) {
        if (!res.headersSent) { res.statusCode = 500; res.end('Internal Server Error'); }
        else res.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    },
    swap(next: LiveHttpHandler) {
      if (typeof next !== 'function') throw new TypeError('HTTP handler must be a function');
      current = next;
      return ++generation;
    },
    status() { return { generation }; }
  };
}
