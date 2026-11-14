import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createProxyServer, ProxyAdmission } from 'zhost';
/** Bind an owned synthetic listener on an ephemeral IPv4-loopback port.
 * @param {import("node:net").Server} server Owned fixture native server.
 * @returns {Promise<number>} Actual native port; no operator listener is reused. */
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
/** Await actual native close of an owned fixture server.
 * @param {import("node:net").Server} server Owned native fixture listener.
 * @returns {Promise<void>} Native close completion. */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Read one small synthetic GET status from the owned loopback proxy.
 * @param {number} port Owned fixture port.
 * @param {string} path Fixed synthetic path, default root.
 * @returns {Promise<number>} Native fixture response status after body drain. */
const request = (port, path = '/') =>
  new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: '127.0.0.1',
          port,
          path,
          headers: { host: 'load.localhost' },
          agent: false,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      )
      .on('error', reject);
  });

test('per-peer/stream budgets preserve headroom with bounded redacted counters', () => {
  /** Process-local admission fixture with explicit total/stream/per-peer limits. */
  const a = new ProxyAdmission({
    maxActiveRequests: 3,
    maxActiveStreams: 1,
    maxActivePerClient: 1,
  });
  /** Owned stream reservation released twice to verify idempotence. */
  const x = a.acquire('peer-a', 'stream');
  assert.equal(a.acquire('peer-b', 'stream').status, 503);
  assert.equal(a.acquire('peer-a').status, 503);
  /** Owned second-peer request reservation released after capacity checks. */
  const y = a.acquire('peer-b');
  assert.equal(y.allowed, true);
  assert.equal(a.stats().activeStreams, 1);
  x.release();
  x.release();
  y.release();
  assert.deepEqual(a.stats(), {
    activeRequests: 0,
    activeStreams: 0,
    trackedClients: 0,
    accepted: 2,
    deniedRate: 0,
    deniedCapacity: 2,
  });
  assert.throws(() => new ProxyAdmission({ maxConnections: 0 }), RangeError);
  assert.throws(
    () => new ProxyAdmission({ maxActivePerClient: 1.5 }),
    RangeError
  );
  /** Separate process-local admission fixture proving retained peer-cardinality limits. */
  const bounded = new ProxyAdmission({
    maxActivePerClient: 1,
  });
  /** Bounded synthetic accepted receipts, all released before final count assertions. */
  const permits = Array.from({ length: 4096 }, (_, i) =>
    bounded.acquire(String(i))
  );
  assert.equal(bounded.acquire('overflow').status, 503);
  for (const p of permits) {
    p.release();
  }
  assert.equal(bounded.stats().trackedClients, 0);
});

test(
  'bounded workload: 24 concurrent delayed requests, overload and zero leaked counts',
  { timeout: 5000 },
  async (t) => {
    let peak = 0,
      active = 0;
    /** Owned synthetic delay/stream/upload native upstream, closed in finally. */
    const backend = http.createServer((_req, res) => {
      peak = Math.max(peak, ++active);
      setTimeout(() => {
        active--;
        res.end('ok');
      }, 40);
    });
    /** Actual owned synthetic backend port. */
    const backendPort = await listen(backend);
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'load.localhost', port: backendPort }],
      limits: {
        maxActiveRequests: 4,
        maxActivePerClient: 4,
        maxConnections: 32,
      },
      onError: () => {},
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    /** Local performance timestamp for one explicitly described synthetic workload. */
    const start = performance.now();
    try {
      /** Actual responses from the bounded 24-request fixture workload. */
      const statuses = await Promise.all(
        Array.from({ length: 24 }, () => request(port))
      );
      /** Count of actual successful synthetic responses, not a throughput estimate. */
      const accepted = statuses.filter((s) => s === 200).length;
      /** Count of actual capacity-denied synthetic responses. */
      const rejected = statuses.filter((s) => s === 503).length;
      assert.equal(accepted + rejected, 24);
      assert.ok(accepted > 0 && rejected > 0);
      assert.ok(peak <= 4);
      assert.equal(proxy.getAdmissionStatus().activeRequests, 0);
      assert.equal(
        proxy.backendConnections.active('load.localhost', backendPort),
        0
      );
      t.diagnostic(
        JSON.stringify({
          workload:
            '24 loopback HTTP GETs, concurrency 24, backend delay 40ms, admission 4, identity responses',
          node: process.version,
          elapsedMs: Math.round(performance.now() - start),
          accepted,
          rejected,
          peakBackendRequests: peak,
        })
      );
    } finally {
      await proxy.connectionTracker.drain({ timeoutMs: 500 });
      await close(backend);
    }
    assert.equal(proxy.connectionTracker.activeConnections, 0);
  }
);

test(
  'partially delivered POST is never rerouted to a replacement backend',
  { timeout: 5000 },
  async () => {
    let replacementCalls = 0,
      selected,
      delivered;
    /** Actual first-upstream partial-body receipt, awaited before checking no replay. */
    const received = new Promise((resolve) => (delivered = resolve));
    /** Owned synthetic replacement backend that must never receive a partially committed POST. */
    const replacement = http.createServer((_req, res) => {
      replacementCalls++;
      res.end('unexpected');
    });
    /** Actual owned candidate replacement backend port. */
    const replacementPort = await listen(replacement);
    /** Owned initial upstream or client socket; only fixture handles are terminated. */
    const first = http.createServer((req) => {
      req.once('data', () => {
        selected = replacementPort;
        delivered();
        req.socket.destroy();
      });
    });
    /** Actual initial owned backend port. */
    const firstPort = await listen(first);
    selected = firstPort;
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'load.localhost', port: selected }],
      onError: () => {},
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    try {
      /** Actual partial-POST response receipt observed without replay. */
      const response = new Promise((resolve, reject) => {
        /** Owned one-shot local HTTP request with observed native errors. */
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            method: 'POST',
            headers: { host: 'load.localhost', 'content-length': 1000 },
          },
          (res) => {
            res.resume();
            res.on('end', () => {
              req.destroy();
              resolve(res.statusCode);
            });
          }
        );
        req.on('error', reject);
        req.write('partial');
      });
      await received;
      assert.equal(await response, 502);
      assert.equal(replacementCalls, 0);
      assert.equal(
        proxy.backendConnections.active('load.localhost', firstPort),
        0
      );
    } finally {
      await proxy.connectionTracker.drain({ timeoutMs: 100 });
      await close(first);
      await close(replacement);
    }
  }
);

test(
  'unhealthy upstream is isolated and idle sockets drain at bounded deadline',
  { timeout: 5000 },
  async () => {
    /** Owned temporary native listener closed to produce a known refused-upstream candidate. */
    const unused = http.createServer();
    /** Observed closed fixture port used only to trigger native refusal/isolation. */
    const unavailable = await listen(unused);
    await close(unused);
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'load.localhost', port: unavailable }],
      limits: { maxConnections: 2 },
      onError: () => {},
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    try {
      assert.equal(await request(port), 502);
      assert.equal(await request(port), 503);
      assert.equal(proxy.getAdmissionStatus().activeRequests, 0);
      assert.equal(
        proxy.backendConnections.active('load.localhost', unavailable),
        0
      );
      await assert.rejects(
        proxy.connectionTracker.drain({ timeoutMs: 300001 }),
        RangeError
      );
      /** Owned raw idle TCP fixture, destroyed by the explicit drain deadline. */
      const socket = net.connect(port, '127.0.0.1');
      socket.on('error', () => {});
      await once(socket, 'connect');
      /** Native fixture socket-close receipt, awaited before final handle-count checks. */
      const ended = once(socket, 'close');
      await proxy.connectionTracker.drain({ timeoutMs: 25 });
      await ended;
      assert.equal(proxy.connectionTracker.activeConnections, 0);
    } finally {
      if (proxy.listening) {
        await proxy.connectionTracker.drain({ timeoutMs: 0 });
      }
    }
  }
);

test(
  'slow downstream disconnect cancels an uncompressed streaming source',
  { timeout: 5000 },
  async () => {
    let ended;
    /** Actual upstream close receipt proving downstream cancellation reached its source. */
    const stopped = new Promise((resolve) => (ended = resolve));
    /** Owned synthetic delay/stream/upload native upstream, closed in finally. */
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      /** Owned finite fixture stream ticker, cleared on the actual upstream response close. */
      const timer = setInterval(() => res.write('data: tick\n\n'), 5);
      res.once('close', () => {
        clearInterval(timer);
        ended();
      });
    });
    /** Actual owned synthetic backend port. */
    const backendPort = await listen(backend);
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'load.localhost', port: backendPort }],
      compression: { enabled: false },
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    try {
      await new Promise((resolve, reject) => {
        /** Owned one-shot local HTTP request with observed native errors. */
        const req = http.get(
          { hostname: '127.0.0.1', port, headers: { host: 'load.localhost' } },
          (res) => {
            res.once('data', () => {
              res.pause();
              setTimeout(() => {
                req.destroy();
                resolve();
              }, 25);
            });
          }
        );
        req.on('error', reject);
      });
      await stopped;
    } finally {
      await proxy.connectionTracker.drain({ timeoutMs: 100 });
      await close(backend);
    }
    assert.equal(proxy.getAdmissionStatus().activeRequests, 0);
    assert.equal(
      proxy.backendConnections.active('load.localhost', backendPort),
      0
    );
  }
);

test(
  'slow upload disconnect closes the partially written upstream request',
  { timeout: 5000 },
  async () => {
    let started, ended;
    /** Actual upstream body receipt proving a partial upload began before client cancellation. */
    const began = new Promise((resolve) => (started = resolve));
    /** Actual upstream close receipt proving downstream cancellation reached its source. */
    const stopped = new Promise((resolve) => (ended = resolve));
    /** Owned synthetic delay/stream/upload native upstream, closed in finally. */
    const backend = http.createServer((req) => {
      req.on('data', () => started());
      req.once('close', ended);
    });
    /** Actual owned synthetic backend port. */
    const backendPort = await listen(backend);
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'load.localhost', port: backendPort }],
      onError: () => {},
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    try {
      /** Owned one-shot local HTTP request with observed native errors. */
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        headers: { host: 'load.localhost', 'content-length': 100000 },
      });
      req.on('error', () => {});
      req.write(Buffer.alloc(512));
      await began;
      await new Promise((resolve) => setTimeout(resolve, 20));
      req.destroy();
      await stopped;
    } finally {
      await proxy.connectionTracker.drain({ timeoutMs: 100 });
      await close(backend);
    }
    assert.equal(proxy.getAdmissionStatus().activeRequests, 0);
    assert.equal(
      proxy.backendConnections.active('load.localhost', backendPort),
      0
    );
  }
);

test(
  'incoming TCP ceiling drops excess idle sockets and releases tracked handles',
  { timeout: 5000 },
  async () => {
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [],
      limits: { maxConnections: 1 },
    });
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    /** Owned raw clients retained solely for unconditional fixture cleanup. */
    const sockets = [];
    try {
      /** Count of actual successful synthetic responses, not a throughput estimate. */
      const accepted = once(proxy, 'connection');
      /** Owned initial upstream or client socket; only fixture handles are terminated. */
      const first = net.connect(port, '127.0.0.1');
      sockets.push(first);
      first.on('error', () => {});
      await accepted;
      /** Native proxy drop receipt proving the declared TCP ceiling is enforced. */
      const dropped = once(proxy, 'drop');
      /** Second owned raw client expected to be dropped at the declared ceiling. */
      const second = net.connect(port, '127.0.0.1');
      sockets.push(second);
      second.on('error', () => {});
      /** Native dropped-client close receipt, awaited before count assertions. */
      const closed = once(second, 'close');
      await dropped;
      await closed;
      assert.equal(proxy.connectionTracker.activeConnections, 1);
    } finally {
      for (const s of sockets) {
        s.destroy();
      }
      await proxy.connectionTracker.drain({ timeoutMs: 100 });
    }
    assert.equal(proxy.connectionTracker.activeConnections, 0);
  }
);
