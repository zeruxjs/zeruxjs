import {
  createRequestHookScope,
  type ServerLifecycleHooks,
  type RequestHookContext,
  type AfterRequestHookContext,
} from '@zeruxjs/hooks';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestCorrelation } from '../observability.js';
import { normalizeApiError } from '../exceptions/api-error.js';

type Control = {
  /** Immutable request lifecycle projection associated with this native request. */
  context: RequestHookContext;
  /** Emit route resolution once while the request scope is active.
   * @param {string | null} pattern - Matched authored route pattern, or null when unmatched/unresolved.
   * @returns {void} Route phase dispatch completion.
   */
  route(pattern: string | null): void;
  /** Emit one bounded failure kind after ensuring route resolution has a terminal value.
   * @param {'handler' | 'disconnect' | 'hook'} kind - Fixed failure category, never an error payload.
   * @returns {void} Error phase dispatch completion.
   */
  error(kind: 'handler' | 'disconnect' | 'hook'): void;
};
/** Weak request-to-control lookup; response termination deletes each active association. */
const requests = new WeakMap<IncomingMessage, Control>();
/** Read the request-local lifecycle control without creating another scope.
 * @param {IncomingMessage} req - Borrowed native request.
 * @returns {Control | undefined} Existing lifecycle control, if this request was wrapped.
 */
export const getServerRequestLifecycle = (req: IncomingMessage) =>
  requests.get(req);
/** Bridge a borrowed host lifecycle bus into one runtime generation; native response termination owns request disposal.
 * @param {string} generationId - Opaque runtime generation identifier.
 * @param {ServerLifecycleHooks | undefined} hooks - Optional borrowed host lifecycle bus.
 * @param {(error: unknown) => void} report - Private host error reporter; observer failures never become public response details.
 * @returns {object} Generation bridge with close and request-handler wrapping.
 */
export function createServerLifecycleBridge(
  generationId: string,
  hooks: ServerLifecycleHooks | undefined,
  report: (error: unknown) => void
) {
  /** Generation-owned shutdown callbacks for requests whose native responses have not terminated. */
  const active = new Set<() => void>();
  let closed = false;
  return {
    /** Close this generation bridge and synchronously terminate all retained request scopes.
     * @returns {void} Shutdown dispatch completion; arbitrary handler promises are not force-cancelled.
     */
    close() {
      closed = true;
      for (const close of [...active]) {
        close();
      }
    },
    /** Wrap native handling with request scope, precommit controls and terminal cleanup.
     * @param {( req: IncomingMessage, res: ServerResponse ) => void | Promise<void>} handler - Borrowed asynchronous native request handler.
     * @returns {Function} Request handler bound to this generation bridge.
     */
    wrap(
      handler: (
        req: IncomingMessage,
        res: ServerResponse
      ) => void | Promise<void>
    ) {
      return async (req: IncomingMessage, res: ServerResponse) => {
        if (closed) {
          if (!res.headersSent) {
            res.statusCode = 503;
          }
          res.end();
          return;
        }
        /** Request-owned hook scope disposed exactly once after native response termination. */
        const scope = createRequestHookScope();
        /** Request lifecycle signal aborted on finish, disconnect or generation shutdown. */
        const controller = new AbortController();
        /** Bounded synchronous request disposers run in reverse registration order. */
        const callbacks: (() => unknown)[] = [];
        /** Immutable correlation/method projection; no request headers, URLs or bodies are copied. */
        const context: RequestHookContext = Object.freeze({
          generationId,
          requestId:
            getRequestCorrelation()?.requestId ??
            randomBytes(16).toString('hex'),
          method: /^[A-Z]{1,16}$/.test(req.method ?? '')
            ? req.method!
            : 'OTHER',
          signal: controller.signal,
        });
        let finished = false,
          routed = false,
          errored = false,
          committed = false;
        /** Per-request route/error phase fence preventing duplicate lifecycle emissions. */
        const control: Control = {
          context,
          /** Emit route resolution once while the request scope is active.
           * @param {string | null} pattern - Matched authored route pattern, or null when unmatched/unresolved.
           * @returns {void} Route phase dispatch completion.
           */
          route(pattern) {
            if (routed || finished) {
              return;
            }
            routed = true;
            hooks?.dispatch(
              'route:resolved',
              Object.freeze({ ...context, pattern })
            );
          },
          /** Emit one bounded failure kind after ensuring route resolution has a terminal value.
           * @param {'handler' | 'disconnect' | 'hook'} kind - Fixed failure category, never an error payload.
           * @returns {void} Error phase dispatch completion.
           */
          error(kind) {
            if (errored || finished) {
              return;
            }
            try {
              control.route(null);
            } catch (error) {
              report(error);
            }
            errored = true;
            try {
              hooks?.dispatch(
                'request:error',
                Object.freeze({ ...context, kind })
              );
            } catch (error) {
              report(error);
            }
          },
        };
        requests.set(req, control);
        /** Borrowed native method restored when request ownership ends. */
        const originalWriteHead = res.writeHead;
        res.writeHead = function (this: ServerResponse, ...args: any[]) {
          if (!committed && !finished) {
            committed = true;
            let mutable = true;
            /** Bounded case-insensitive hook overrides applied before the first native header commit. */
            const headers = new Map<string, string>();
            /** Reject response mutation after the synchronous precommit hook phase.
             * @returns {void} Mutation-phase validation completion.
             */
            const check = () => {
              if (!mutable || finished || res.headersSent) {
                throw new Error('Response hook mutation phase ended');
              }
            };
            try {
              scope.run(() => control.route(null));
              scope.run(() =>
                hooks?.dispatch(
                  'response:before',
                  Object.freeze({
                    ...context,
                    response: Object.freeze({
                      /** Set a validated response status only during the synchronous precommit phase.
                       * @param {number} status - Integer HTTP response status from 200 through 599.
                       * @returns {void} Pending native status update.
                       */
                      setStatus(status: number) {
                        check();
                        if (
                          !Number.isSafeInteger(status) ||
                          status < 200 ||
                          status > 599
                        ) {
                          throw new TypeError(
                            'Invalid lifecycle response status'
                          );
                        }
                        args[0] = status;
                        res.statusCode = status;
                      },
                      /** Stage a bounded end-to-end header override before native commitment.
                       * @param {string} name - Validated header name; transport framing fields reject.
                       * @param {string} value - Bounded header value excluding invalid control bytes.
                       * @returns {void} Staged override update.
                       */
                      setHeader(name: string, value: string) {
                        check();
                        if (
                          typeof name !== 'string' ||
                          !/^[a-zA-Z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name) ||
                          [
                            'connection',
                            'transfer-encoding',
                            'content-length',
                            'upgrade',
                            'trailer',
                          ].includes(name.toLowerCase()) ||
                          typeof value !== 'string' ||
                          value.length > 8192 ||
                          Buffer.byteLength(value) > 8192 ||
                          /[^\x20-\x7e\x80-\xff]/.test(value)
                        ) {
                          throw new TypeError(
                            'Invalid lifecycle response header'
                          );
                        }
                        headers.set(name.toLowerCase(), value);
                        if (headers.size > 32) {
                          throw new RangeError(
                            'Lifecycle response header limit'
                          );
                        }
                      },
                    }),
                  })
                )
              );
              /** Native writeHead header argument position, accounting for an optional status message. */
              const index = typeof args[1] === 'string' ? 2 : 1;
              if (args[index] && headers.size) {
                if (Array.isArray(args[index])) {
                  /** Borrowed native raw header pairs before hook override projection. */
                  const original = args[index] as string[];
                  /** Replacement native header collection preserving unrelated authored fields. */
                  const next: string[] = [];
                  // Native raw headers are name/value pairs; the bounded loop supplies each pair.
                  for (let i = 0; i < original.length; i += 2) {
                    if (!headers.has(original[i]!.toLowerCase())) {
                      next.push(original[i]!, original[i + 1]!);
                    }
                  }
                  for (const [name, value] of headers) {
                    next.push(name, value);
                  }
                  args[index] = next;
                } else {
                  /** Replacement native header collection preserving unrelated authored fields. */
                  const next = { ...args[index] };
                  for (const name of Object.keys(next)) {
                    if (headers.has(name.toLowerCase())) {
                      delete next[name];
                    }
                  }
                  for (const [name, value] of headers) {
                    next[name] = value;
                  }
                  args[index] = next;
                }
              } else {
                for (const [name, value] of headers) {
                  res.setHeader(name, value);
                }
              }
            } catch (error) {
              control.error('hook');
              throw error;
            } finally {
              mutable = false;
            }
          }
          return Reflect.apply(originalWriteHead, this, args);
        } as ServerResponse['writeHead'];
        /** Dispose request ownership once at native completion, disconnect or generation shutdown.
         * @returns {void} Synchronous phase dispatch/listener/disposer cleanup.
         */
        const finish = () => {
          if (finished) {
            return;
          }
          // Complete outstanding phases before invalidating the request context, exactly once.
          try {
            scope.run(() => {
              try {
                control.route(null);
              } catch (error) {
                report(error);
              }
              if (!res.writableFinished) {
                control.error('disconnect');
              }
              finished = true;
              controller.abort();
              /** Terminal lifecycle snapshot or returned cleanup settlement checked against the synchronous contract. */
              const result: AfterRequestHookContext = Object.freeze({
                ...context,
                status: res.writableFinished ? res.statusCode : 499,
                outcome: res.writableFinished ? 'completed' : 'disconnected',
              });
              for (const phase of [
                'response:after',
                'request:after',
              ] as const) {
                try {
                  hooks?.dispatch(phase, result);
                } catch (error) {
                  report(error);
                }
              }
            });
          } finally {
            finished = true;
            controller.abort();
            requests.delete(req);
            active.delete(shutdown);
            req.off('aborted', finish);
            res.off('finish', finish);
            res.off('close', finish);
            res.writeHead = originalWriteHead;
            try {
              scope.dispose();
            } catch (error) {
              report(error);
            }
            for (const cleanup of callbacks.reverse()) {
              try {
                /** Terminal lifecycle snapshot or returned cleanup settlement checked against the synchronous contract. */
                const result = cleanup();
                if (result && typeof (result as any).then === 'function') {
                  void Promise.resolve(result).catch(report);
                  report(new Error('Request cleanup must be synchronous'));
                }
              } catch (error) {
                report(error);
              }
            }
            callbacks.length = 0;
          }
        };
        /** Destroy an unfinished native response before releasing its request lifecycle scope.
         * @returns {void} Request shutdown and synchronous cleanup completion.
         */
        const shutdown = () => {
          if (!res.destroyed && !res.writableFinished) {
            res.destroy();
          }
          finish();
        };
        active.add(shutdown);
        req.once('aborted', finish);
        res.once('finish', finish);
        res.once('close', finish);
        try {
          await scope.run(async () => {
            hooks?.dispatch(
              'request:before',
              Object.freeze({
                ...context,
                /** Register bounded synchronous request cleanup before scope termination.
                 * @param {() => void} cleanup - Synchronous disposer; asynchronous work must use a different owned lifecycle.
                 * @returns {void} Disposer registration completion.
                 */
                onDispose(cleanup: () => void) {
                  if (
                    finished ||
                    typeof cleanup !== 'function' ||
                    callbacks.length >= 128 ||
                    cleanup.constructor.name === 'AsyncFunction'
                  ) {
                    throw new Error('Invalid request disposer');
                  }
                  callbacks.push(cleanup);
                },
              })
            );
            if (req.aborted || res.destroyed) {
              finish();
              return;
            }
            await handler(req, res);
          });
        } catch (error) {
          if (finished) {
            report(error);
            return;
          }
          scope.run(() => control.error('hook'));
          report(error);
          if (!res.destroyed && !res.writableEnded) {
            if (res.headersSent) {
              res.destroy();
            } else {
              /** Safe structured error projection used only before response headers are committed. */
              const normalized = normalizeApiError(error);
              res.statusCode = normalized.status;
              res.setHeader('content-type', 'application/json');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify(normalized.body));
            }
          }
          if (res.destroyed) {
            finish();
          }
        }
      };
    },
  };
}
