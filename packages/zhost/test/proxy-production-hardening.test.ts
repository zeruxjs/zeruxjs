import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyServer } from '../dist/portless/proxy.js';
import {
  filterProxyHeaders,
  validateProxyBindAddress,
} from '../dist/portless/proxy-headers.js';
import { validateSNIServername, ensureCerts } from '../dist/portless/certs.js';
import { buildBlock, removeBlock } from '../dist/portless/hosts.js';

/** Bind an owned synthetic listener on an ephemeral IPv4-loopback port.
 * @param {import("node:net").Server} server Owned fixture native server.
 * @returns {Promise<number>} Actual native port; no operator listener is reused. */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await actual native close of an owned fixture server.
 * @param {import("node:net").Server} server Owned native fixture listener.
 * @returns {Promise<void>} Native close completion. */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Read one bounded synthetic HTTP/TLS response with explicit fixture CA verification when secure.
 * @param {number} port Owned proxy listener port.
 * @param {string} host Fixed synthetic request/SNI host.
 * @param {object} headers Fixed protocol-header fixture overrides.
 * @param {boolean} secure Whether to use native HTTPS.
 * @param {Buffer | undefined} ca Owned synthetic CA bytes, never a global trust-store update.
 * @returns {Promise<{status: number, headers: object, body: string}>} Actual fixture response. */
const get = (port, host, headers = {}, secure = false, ca) =>
  new Promise((resolve, reject) => {
    /** Native HTTP or HTTPS client selected by the explicit fixture mode. */
    const module = secure ? https : http;
    /** Owned one-shot local HTTP request with observed native errors. */
    const req = module.get(
      {
        hostname: '127.0.0.1',
        port,
        ...(secure ? { ca, servername: host } : {}),
        headers: { host, ...headers },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body })
        );
      }
    );
    req.on('error', reject);
  });

test('hop-by-hop request/response filtering removes dynamic connection fields', () => {
  assert.deepEqual(
    filterProxyHeaders({
      host: 'api.localhost',
      connection: 'keep-alive, X-Secret',
      'x-secret': 'leak',
      'x-ok': 'yes',
      'transfer-encoding': 'chunked',
      ':authority': 'api.localhost',
    }),
    {
      host: 'api.localhost',
      'x-ok': 'yes',
    }
  );
  assert.equal(
    filterProxyHeaders(
      {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': 'abc',
      },
      { preserveUpgrade: true }
    ).connection,
    'Upgrade'
  );
  assert.equal(validateProxyBindAddress('localhost'), '127.0.0.1');
  assert.equal(validateProxyBindAddress('::1'), '::1');
  assert.throws(() => validateProxyBindAddress('example.com'), /IP literal/);
});

test('HTTP proxy strips connection-scoped fields in both directions', async () => {
  /** Owned synthetic native upstream closed in fixture finally. */
  const upstream = http.createServer((req, res) => {
    res.setHeader('connection', 'keep-alive, x-upstream-only');
    res.setHeader('x-upstream-only', 'private');
    res.setHeader('x-normal', 'safe');
    res.end(JSON.stringify({ headers: req.headers }));
  });
  /** Actual owned upstream listener port. */
  const upstreamPort = await listen(upstream);
  /** Owned ephemeral proxy stopped/drained before removing fixture state. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'api.localhost', port: upstreamPort }],
    proxyPort: 0,
    onError: () => {},
  });
  try {
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    /** Actual synthetic response receipt checked against known protocol/identity expectations. */
    const result = await get(port, 'api.localhost', {
      connection: 'keep-alive, x-secret',
      'x-secret': 'bad',
      'x-trace': 'ok',
    });
    assert.equal(result.status, 200);
    /** Decoded synthetic upstream-observed request fields. */
    const received = JSON.parse(result.body).headers;
    assert.equal(received['x-secret'], undefined);
    assert.equal(received['x-trace'], 'ok');
    assert.equal(result.headers['x-upstream-only'], undefined);
    assert.equal(result.headers['x-normal'], 'safe');
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('HTTPS proxy rejects plaintext by default and allows TLS forwarding', async () => {
  /** Owned private temporary CA/state namespace, removed in finally. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-cert-test-'));
  /** Owned synthetic native upstream closed in fixture finally. */
  const upstream = http.createServer((req, res) => res.end('secure'));
  try {
    /** Paths to owned fixture certificate/key material; never system trust-store files. */
    const { certPath, keyPath } = ensureCerts(dir, 'custom.localhost');
    /** Owned temporary public fixture certificate bytes. */
    const cert = fs.readFileSync(certPath);
    /** Owned private fixture TLS key bytes, never logged or committed. */
    const key = fs.readFileSync(keyPath);
    assert.ok(
      new (await import('node:crypto')).X509Certificate(cert).checkHost(
        'custom.localhost'
      )
    );
    /** Actual owned upstream listener port. */
    const upstreamPort = await listen(upstream);
    /** Owned ephemeral proxy stopped/drained before removing fixture state. */
    const proxy = createProxyServer({
      getRoutes: () => [{ hostname: 'custom.localhost', port: upstreamPort }],
      proxyPort: 0,
      tls: { cert, key },
      onError: () => {},
    });
    try {
      /** Actual ephemeral proxy listener port. */
      const port = await listen(proxy);
      assert.equal((await get(port, 'custom.localhost')).status, 426);
      assert.equal(
        (
          await get(
            port,
            'custom.localhost',
            {},
            true,
            fs.readFileSync(path.join(dir, 'ca.pem'))
          )
        ).body,
        'secure'
      );
    } finally {
      await proxy.connectionTracker.drain({ timeoutMs: 1000 });
    }
  } finally {
    await close(upstream).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('certificate issuance refuses unrelated hosts and malformed names', () => {
  assert.equal(
    validateSNIServername('One.localhost', 'localhost'),
    'one.localhost'
  );
  for (const host of [
    'example.com',
    'localhost.attacker.com',
    'bad..localhost',
    '../localhost',
    'evil.localhost\nCN=other',
  ]) {
    assert.throws(() => validateSNIServername(host, 'localhost'));
  }
});

test('hosts-file blocks refuse injection and unbalanced/duplicate markers', () => {
  assert.match(buildBlock(['app.localhost']), /127.0.0.1 app.localhost/);
  for (const name of [
    'bad hostname',
    'foo\n127.0.0.1 evil',
    'a..localhost',
    'EXAMPLE.localhost',
  ]) {
    assert.throws(() => buildBlock([name]));
  }
  assert.throws(
    () => buildBlock(['app.localhost', 'app.localhost']),
    /Duplicate/
  );
  assert.throws(
    () => removeBlock('# portless-start\n127.0.0.1 x.localhost\n'),
    /Malformed/
  );
});

test('TLS liveness probes verify the configured CA instead of accepting any local certificate', async () => {
  /** Owned private temporary CA/state namespace, removed in finally. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-probe-'));
  /** Second owned temporary CA namespace used to prove trust mismatch rejection. */
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-probe-other-'));
  /** Original process-local test environment override restored in finally. */
  const previous = process.env.PORTLESS_STATE_DIR;
  let server;
  try {
    /** Owned temporary CA/server issuance receipt for only the loopback fixture. */
    const certificates = ensureCerts(dir, 'localhost');
    server = https.createServer(
      {
        key: fs.readFileSync(certificates.keyPath),
        cert: fs.readFileSync(certificates.certPath),
      },
      (_req, res) => {
        res.setHeader('X-Portless', '1');
        res.end();
      }
    );
    /** Actual ephemeral proxy listener port. */
    const port = await listen(server);
    process.env.PORTLESS_STATE_DIR = dir;
    /** Lazy built liveness probe imported only after fixture-specific state selection. */
    const { isProxyRunning } = await import('../dist/portless/cli-utils.js');
    assert.equal(await isProxyRunning(port, true), true);
    ensureCerts(other, 'localhost');
    fs.copyFileSync(path.join(other, 'ca.pem'), path.join(dir, 'ca.pem'));
    assert.equal(await isProxyRunning(port, true), false);
    fs.unlinkSync(path.join(dir, 'ca.pem'));
    assert.equal(await isProxyRunning(port, true), false);
  } finally {
    if (previous === undefined) {
      delete process.env.PORTLESS_STATE_DIR;
    } else {
      process.env.PORTLESS_STATE_DIR = previous;
    }
    if (server) {
      await close(server);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});
