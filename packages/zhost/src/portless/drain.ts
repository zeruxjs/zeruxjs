import type * as net from 'node:net';

export interface DrainOptions {
  /** Maximum time to wait for open connections. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export interface ConnectionTracker {
  /** Number of live incoming TCP connections. */
  readonly activeConnections: number;
  /** Stop admissions, close idle HTTP keepalives when supported and destroy remaining sockets at the bounded deadline.
   * @param {DrainOptions} options - Trusted timeout policy in milliseconds, default ten seconds.
   * @returns {Promise<void>} Shared completion of native server close; invalid timeouts reject before closing.
   */
  drain(options?: DrainOptions): Promise<void>;
}

/** Attach TCP lifecycle tracking to a host-owned server, including upgraded/TLS/HTTP2 sockets; drain closes that server and its retained sockets.
 * @param {net.Server} server - Borrowed listening server whose host explicitly authorizes this shutdown owner.
 * @returns {ConnectionTracker} Tracker with an idempotent actual-server-close drain promise.
 */
export function trackConnections(server: net.Server): ConnectionTracker {
  /** Accepted native sockets retained only until their close event. */
  const sockets = new Set<net.Socket>();
  let draining: Promise<void> | undefined;
  server.on('connection', (socket) => {
    if (draining) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return {
    get activeConnections() {
      return [...sockets].filter((socket) => !socket.destroyed).length;
    },
    /** Stop admissions, close idle HTTP keepalives when supported and destroy remaining sockets at the bounded deadline.
     * @param {DrainOptions} options - Trusted timeout policy in milliseconds, default ten seconds.
     * @returns {Promise<void>} Shared completion of native server close; invalid timeouts reject before closing.
     */
    drain(options = {}) {
      if (draining) {
        return draining;
      }
      /** Validated integer native socket-drain deadline, zero through 300000 milliseconds. */
      const timeout = options.timeoutMs ?? 10_000;
      if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 300_000) {
        return Promise.reject(
          new RangeError('timeoutMs must be an integer from 0 to 300000')
        );
      }
      draining = new Promise<void>((resolve, reject) => {
        let settled = false;
        // eslint-disable-next-line prefer-const -- Callbacks observe this lifetime handle before its deferred initialization.
        let timer: ReturnType<typeof setTimeout> | undefined;
        /** Settle native server-close completion once and release its deadline timer.
         * @param {Error | undefined} error Optional native server close failure.
         * @returns {void} Resolves or rejects the shared drain promise once. */
        const finish = (error?: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        // server.close() stops accepting clients but waits for established TCP
        // sockets; the deadline is needed for idle HTTP keep-alive and tunnels.
        try {
          server.close((error?: Error) => finish(error));
          // Node HTTP servers can close idle keep-alive sockets without
          // interrupting responses currently in progress.
          if ('closeIdleConnections' in server) {
            (
              server as net.Server & { closeIdleConnections(): void }
            ).closeIdleConnections();
          }
        } catch (error) {
          finish(error as Error);
          return;
        }
        timer = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
        }, timeout);
        timer.unref?.();
      });
      return draining;
    },
  };
}
