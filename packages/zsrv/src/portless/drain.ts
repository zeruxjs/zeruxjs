import type * as net from 'node:net';

export interface DrainOptions {
  /** Maximum time to wait for open connections. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export interface ConnectionTracker {
  /** Number of live incoming TCP connections. */
  readonly activeConnections: number;
  /** Stop accepting new connections, wait for active work, then force-close at deadline. */
  drain(options?: DrainOptions): Promise<void>;
}

/**
 * Track the TCP layer rather than individual requests: this also captures upgraded
 * WebSocket tunnels and TLS/HTTP2 connections handed to an internal server.
 */
export function trackConnections(server: net.Server): ConnectionTracker {
  const sockets = new Set<net.Socket>();
  let draining: Promise<void> | undefined;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return {
    get activeConnections() { return [...sockets].filter(socket => !socket.destroyed).length; },
    drain(options = {}) {
      if (draining) return draining;
      const timeout = options.timeoutMs ?? 10_000;
      if (!Number.isFinite(timeout) || timeout < 0) {
        return Promise.reject(new RangeError('timeoutMs must be a non-negative finite number'));
      }
      draining = new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        // server.close() stops accepting clients but waits for established TCP
        // sockets; the deadline is needed for idle HTTP keep-alive and tunnels.
        try {
          server.close((error?: Error) => finish(error));
          // Node HTTP servers can close idle keep-alive sockets without
          // interrupting responses currently in progress.
          if ('closeIdleConnections' in server) {
            (server as net.Server & { closeIdleConnections(): void }).closeIdleConnections();
          }
        } catch (error) {
          finish(error as Error);
          return;
        }
        timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, timeout);
        timer.unref?.();
      });
      return draining;
    },
  };
}
