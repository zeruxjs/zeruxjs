import type { IncomingMessage, ServerResponse } from 'node:http';

export type LiveHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => unknown;

/** Create an inert request-handler switchboard without rebinding a server socket or disposing an old runtime automatically.
 * @param {LiveHttpHandler} initial - Explicit trusted initial host handler; response/resource lifetime remains with its application owner.
 * @returns {object} Stable handle plus swap/status; each request captures one handler, while the host owns generation draining and resource cleanup.
 */
export function createLiveRequestHandler(initial: LiveHttpHandler) {
  let current = initial;
  let generation = 1;
  return {
    /** Capture the current trusted handler once and observe synchronous/asynchronous errors without exposing their private text in an uncommitted response.
     * @param {IncomingMessage} req - Borrowed native incoming request.
     * @param {ServerResponse} res - Borrowed response whose terminal lifecycle remains with the host transport.
     * @returns {void} Schedules handler settlement observation; this legacy callback does not return an awaitable handler-drain promise.
     */
    handle(req: IncomingMessage, res: ServerResponse) {
      /** Trusted callback captured before invocation, so an in-flight request never switches to a later generation. */
      const handler = current;
      try {
        Promise.resolve(handler(req, res)).catch((error) => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error');
          } else {
            res.destroy(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        });
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } else {
          res.destroy(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    },
    /** Replace only the handler used by later requests, rejecting nonfunction replacements without changing the current generation.
     * @param {LiveHttpHandler} next - Explicit trusted host callback, never source supplied in request data.
     * @returns {number} New local generation counter; not an authorization capability or persistent sequence.
     */
    swap(next: LiveHttpHandler) {
      if (typeof next !== 'function') {
        throw new TypeError('HTTP handler must be a function');
      }
      current = next;
      return ++generation;
    },
    /** Copy the current local generation counter without exposing handler functions.
     * @returns {{generation: number}} Detached status value; mutating the returned object does not swap the handler.
     */
    status() {
      return { generation };
    },
  };
}
