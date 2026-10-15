import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyServer } from '../dist/portless/proxy.js';
import { filterProxyHeaders, validateProxyBindAddress } from '../dist/portless/proxy-headers.js';
import { validateSNIServername, ensureCerts } from '../dist/portless/certs.js';
import { buildBlock, removeBlock } from '../dist/portless/hosts.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => server.close(resolve));
const get = (port, host, headers = {}, secure = false) => new Promise((resolve, reject) => {
  const module = secure ? https : http;
  const req = module.get({ hostname: '127.0.0.1', port, rejectUnauthorized: false, headers: { host, ...headers } }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
});

test('hop-by-hop request/response filtering removes dynamic connection fields', () => {
  assert.deepEqual(filterProxyHeaders({ host: 'api.localhost', connection: 'keep-alive, X-Secret', 'x-secret': 'leak', 'x-ok': 'yes', 'transfer-encoding': 'chunked', ':authority': 'api.localhost' }), {
    host: 'api.localhost', 'x-ok': 'yes',
  });
  assert.equal(filterProxyHeaders({ connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'abc' }, { preserveUpgrade: true }).connection, 'Upgrade');
  assert.equal(validateProxyBindAddress('localhost'), '127.0.0.1');
  assert.equal(validateProxyBindAddress('::1'), '::1');
  assert.throws(() => validateProxyBindAddress('example.com'), /IP literal/);
});

test('HTTP proxy strips connection-scoped fields in both directions', async () => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('connection', 'keep-alive, x-upstream-only');
    res.setHeader('x-upstream-only', 'private');
    res.setHeader('x-normal', 'safe');
    res.end(JSON.stringify({ headers: req.headers }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createProxyServer({ getRoutes: () => [{ hostname: 'api.localhost', port: upstreamPort }], proxyPort: 0, onError: () => {} });
  try {
    const port = await listen(proxy);
    const result = await get(port, 'api.localhost', { connection: 'keep-alive, x-secret', 'x-secret': 'bad', 'x-trace': 'ok' });
    assert.equal(result.status, 200);
    const received = JSON.parse(result.body).headers;
    assert.equal(received['x-secret'], undefined);
    assert.equal(received['x-trace'], 'ok');
    assert.equal(result.headers['x-upstream-only'], undefined);
    assert.equal(result.headers['x-normal'], 'safe');
  } finally { await close(proxy); await close(upstream); }
});

test('HTTPS proxy rejects plaintext by default and allows TLS forwarding', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-cert-test-'));
  const upstream = http.createServer((req, res) => res.end('secure'));
  try {
    const { certPath, keyPath } = ensureCerts(dir, 'custom.localhost');
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    assert.ok(new (await import('node:crypto')).X509Certificate(cert).checkHost('custom.localhost'));
    const upstreamPort = await listen(upstream);
    const proxy = createProxyServer({ getRoutes: () => [{ hostname: 'custom.localhost', port: upstreamPort }], proxyPort: 0, tls: { cert, key }, onError: () => {} });
    try {
      const port = await listen(proxy);
      assert.equal((await get(port, 'custom.localhost')).status, 426);
      assert.equal((await get(port, 'custom.localhost', {}, true)).body, 'secure');
    } finally { await proxy.connectionTracker.drain({ timeoutMs: 1000 }); }
  } finally { await close(upstream).catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('certificate issuance refuses unrelated hosts and malformed names', () => {
  assert.equal(validateSNIServername('One.localhost', 'localhost'), 'one.localhost');
  for (const host of ['example.com', 'localhost.attacker.com', 'bad..localhost', '../localhost', 'evil.localhost\nCN=other']) {
    assert.throws(() => validateSNIServername(host, 'localhost'));
  }
});

test('hosts-file blocks refuse injection and unbalanced/duplicate markers', () => {
  assert.match(buildBlock(['app.localhost']), /127.0.0.1 app.localhost/);
  for (const name of ['bad hostname', 'foo\n127.0.0.1 evil', 'a..localhost', 'EXAMPLE.localhost']) {
    assert.throws(() => buildBlock([name]));
  }
  assert.throws(() => buildBlock(['app.localhost', 'app.localhost']), /Duplicate/);
  assert.throws(() => removeBlock('# portless-start\n127.0.0.1 x.localhost\n'), /Malformed/);
});
