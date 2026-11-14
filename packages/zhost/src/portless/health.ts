/** Loopback-only health probes. Never follows redirects or fetches external URLs. */
import * as http from 'node:http';
import * as net from 'node:net';

/** Reject invalid loopback destination ports before opening a socket.
 * @param {number} port - Application TCP port in the inclusive range 1–65535.
 * @returns {void} Throws when the port is not a safe integer in range.
 */
function validatePort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('Invalid application port');
  }
}

/** Own a single loopback TCP socket until success, failure or timeout, then destroy it.
 * @param {number} port - Previously validated local destination port.
 * @param {number} timeoutMs - Per-socket timeout in milliseconds.
 * @returns {Promise<boolean>} True on connection; false on timeout, close or socket error.
 */
function tcpProbe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    /** Owned loopback socket, destroyed by the first terminal callback. */
    const socket = net.connect({ port, host: '127.0.0.1' });
    let settled = false;
    /** Settle once and release the TCP socket.
     * @param {boolean} okay - Whether connection readiness succeeded.
     * @returns {void} Ignores subsequent socket events.
     */
    const done = (okay: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(okay);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('close', () => done(false));
  });
}

export interface HealthCheckOptions {
  /** A relative, origin-form HTTP path; omit for a TCP connection probe. */
  path?: string;
  /** Per-probe timeout in milliseconds. */
  timeoutMs?: number;
  /** HTTP status range considered healthy, inclusive. Defaults to 200–299. */
  minStatus?: number;
  /** Inclusive maximum healthy HTTP status; defaults to 299. */
  maxStatus?: number;
}

/** Validate local health policy and materialize bounded timeout/status defaults.
 * @param {HealthCheckOptions} options - Optional relative HTTP path and per-probe limits; no remote origin is accepted.
 * @returns {Required<Omit<HealthCheckOptions, 'path'>> & Pick<HealthCheckOptions, 'path'>} Detached validated policy; does not create a request.
 */
export function validateHealthCheck(
  options: HealthCheckOptions = {}
): Required<Omit<HealthCheckOptions, 'path'>> &
  Pick<HealthCheckOptions, 'path'> {
  /** Bounded per-probe timeout, defaulting to one second. */
  const timeoutMs = options.timeoutMs ?? 1_000;
  /** Inclusive lower HTTP status bound. */
  const minStatus = options.minStatus ?? 200;
  /** Inclusive upper HTTP status bound. */
  const maxStatus = options.maxStatus ?? 299;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError('Health timeout must be 1–30000ms');
  }
  if (
    !Number.isSafeInteger(minStatus) ||
    !Number.isSafeInteger(maxStatus) ||
    minStatus < 100 ||
    maxStatus > 599 ||
    minStatus > maxStatus
  ) {
    throw new RangeError('Invalid healthy HTTP status range');
  }
  if (
    options.path !== undefined &&
    (!options.path.startsWith('/') ||
      options.path.startsWith('//') ||
      /[^\x21-\x7E]|#/.test(options.path) ||
      options.path.length > 2048)
  ) {
    throw new TypeError(
      'Health path must be a local absolute path beginning with /'
    );
  }
  return { path: options.path, timeoutMs, minStatus, maxStatus };
}

/** Probe only IPv4 loopback using TCP or HTTP headers; never follow redirects or buffer a response body.
 * @param {number} port - Validated local application TCP port.
 * @param {HealthCheckOptions} options - Optional local HTTP path, timeout and inclusive healthy status range.
 * @returns {Promise<boolean>} True for a healthy connection/status; false for transport failures. Invalid policy rejects.
 */
export async function probeApplicationHealth(
  port: number,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  validatePort(port);
  /** Validated request policy captured before any network work. */
  const config = validateHealthCheck(options);
  if (config.path === undefined) {
    return tcpProbe(port, config.timeoutMs);
  }
  return new Promise((resolve) => {
    let finished = false;
    /** Settle the health result once despite overlapping response and request events.
     * @param {boolean} healthy - Header-derived health or transport failure.
     * @returns {void} Resolves only the first result.
     */
    const settle = (healthy: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(healthy);
    };
    /** Owned nonpooled loopback HTTP request, destroyed on timeout or after response headers. */
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: config.path,
        method: 'GET',
        agent: false,
        headers: { Host: 'localhost', Connection: 'close' },
      },
      (response) => {
        /** Observed HTTP status, with missing status treated as unhealthy. */
        const status = response.statusCode ?? 0;
        // Do not follow redirects and do not accumulate the response body.
        /** Header-only health decision; the body is neither trusted nor accumulated. */
        const healthy =
          status >= config.minStatus && status <= config.maxStatus;
        response.resume();
        response.once('end', () => settle(healthy));
        response.once('error', () => settle(false));
        // Health checks only depend on response headers; don't let an
        // unlimited response body block readiness or retain a socket.
        settle(healthy);
        response.destroy();
      }
    );
    request.setTimeout(config.timeoutMs, () => {
      request.destroy();
      settle(false);
    });
    request.once('error', () => settle(false));
    request.end();
  });
}
