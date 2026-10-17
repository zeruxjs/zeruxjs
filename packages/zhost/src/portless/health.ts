/** Loopback-only health probes. Never follows redirects or fetches external URLs. */
import * as http from 'node:http';
import * as net from 'node:net';

function validatePort(port: number): void {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid application port');
}

function tcpProbe(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        let settled = false;
        const done = (okay: boolean) => {
            if (settled) return;
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
    maxStatus?: number;
}

export function validateHealthCheck(options: HealthCheckOptions = {}): Required<Omit<HealthCheckOptions, 'path'>> & Pick<HealthCheckOptions, 'path'> {
    const timeoutMs = options.timeoutMs ?? 1_000;
    const minStatus = options.minStatus ?? 200;
    const maxStatus = options.maxStatus ?? 299;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new RangeError('Health timeout must be 1–30000ms');
    if (!Number.isSafeInteger(minStatus) || !Number.isSafeInteger(maxStatus) || minStatus < 100 || maxStatus > 599 || minStatus > maxStatus) {
        throw new RangeError('Invalid healthy HTTP status range');
    }
    if (options.path !== undefined && (!options.path.startsWith('/') || options.path.startsWith('//') || /[^\x21-\x7E]|#/.test(options.path) || options.path.length > 2048)) {
        throw new TypeError('Health path must be a local absolute path beginning with /');
    }
    return { path: options.path, timeoutMs, minStatus, maxStatus };
}

/** Returns false on timeouts, refused connections, unexpected status, or socket errors. */
export async function probeApplicationHealth(port: number, options: HealthCheckOptions = {}): Promise<boolean> {
    validatePort(port);
    const config = validateHealthCheck(options);
    if (config.path === undefined) return tcpProbe(port, config.timeoutMs);
    return new Promise(resolve => {
        let finished = false;
        const settle = (healthy: boolean) => {
            if (finished) return;
            finished = true;
            resolve(healthy);
        };
        const request = http.request({
            host: '127.0.0.1', port, path: config.path, method: 'GET',
            agent: false, headers: { Host: 'localhost', Connection: 'close' },
        }, response => {
            const status = response.statusCode ?? 0;
            // Do not follow redirects and do not accumulate the response body.
            const healthy = status >= config.minStatus && status <= config.maxStatus;
            response.resume();
            response.once('end', () => settle(healthy));
            response.once('error', () => settle(false));
            // Health checks only depend on response headers; don't let an
            // unlimited response body block readiness or retain a socket.
            settle(healthy);
            response.destroy();
        });
        request.setTimeout(config.timeoutMs, () => { request.destroy(); settle(false); });
        request.once('error', () => settle(false));
        request.end();
    });
}
