import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { RouteStore } from '../dist/portless/routes.js';
import { createProxyServer } from '../dist/portless/proxy.js';
import { launchInstanceFleet } from '../dist/portless/instance-fleet.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => server.close(resolve));
async function availablePorts(n) {
  const servers = Array.from({ length: n }, () => net.createServer());
  try { return await Promise.all(servers.map(listen)); }
  finally { await Promise.all(servers.map(close)); }
}
const appCode = String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const port = Number(process.env.PORT);
const failFile = path.join(process.env.TEST_STATE_DIR, 'fail-' + port);
if (process.env.STARTUP_FAIL_PORT === String(port)) process.exit(17);
const server = http.createServer((req,res) => {
  if (req.url === '/health') { res.statusCode = fs.existsSync(failFile) ? 503 : 200; res.end('health'); return; }
  if (req.url === '/slow') { setTimeout(()=>res.end('slow:' + port), 350); return; }
  res.end('port:' + port);
});
const start = () => server.listen(port, '127.0.0.1');
if (process.env.SLOW_START_PORT === String(port)) setTimeout(start, 500);
else start();
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
const argv = [process.execPath, '-e', appCode];
const get = (port, host, pathname = '/') => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port, path: pathname, headers: { Host: host, Connection: 'close' } }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', part => body += part);
    response.once('end', () => resolve({ status: response.statusCode, body }));
  });
  request.once('error', reject);
});
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-fleet-'));
  const store = new RouteStore(dir);
  const proxy = createProxyServer({ getRoutes: () => store.loadRoutes(), proxyPort: 0, onError: () => {} });
  const proxyPort = await listen(proxy);
  const ports = await availablePorts(4);
  let fleet;
  const launch = async extra => {
    fleet = await launchInstanceFleet(argv, {
      store, hostname: 'fleet.localhost', ports, replicas: 2,
      connections: proxy.backendConnections, health: { path: '/health', timeoutMs: 250 },
      readyTimeoutMs: 2000, shutdownTimeoutMs: 1000, healthIntervalMs: 30_000,
      replacementDelayMs: 0, drainTimeoutMs: 1000, stdio: 'ignore',
      env: { TEST_STATE_DIR: dir }, ...extra,
    });
    return fleet;
  };
  try { return await fn({ dir, store, proxy, proxyPort, ports, launch, get fleet() { return fleet; } }); }
  finally {
    if (fleet) await fleet.stop().catch(() => {});
    await close(proxy);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('fleet validates replicas, spare ports, health and restart budgets before publishing', () => fixture(async ({ store, proxy, ports }) => {
  const base = { store, hostname: 'fleet.localhost', ports, connections: proxy.backendConnections, replicas: 2 };
  await assert.rejects(launchInstanceFleet(argv, { ...base, replicas: 1 }), /replicas/);
  await assert.rejects(launchInstanceFleet(argv, { ...base, ports: ports.slice(0, 2) }), /spare/);
  await assert.rejects(launchInstanceFleet(argv, { ...base, maxReplacements: -1 }), /maxReplacements/);
  await assert.rejects(launchInstanceFleet(argv, { ...base, healthIntervalMs: 0 }), /healthIntervalMs/);
  assert.deepEqual(store.loadRoutes(), []);
}));

test('fleet publishes only ready replicas, distributes traffic and stops idempotently', () => fixture(async ({ store, proxyPort, ports, launch }) => {
  const fleet = await launch();
  assert.equal(fleet.status.phase, 'running');
  assert.equal(fleet.status.members.length, 2);
  assert.ok(Object.isFrozen(fleet.status.members));
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), ports.slice(0, 2));
  const replies = new Set();
  for (let i = 0; i < 8; i++) replies.add((await get(proxyPort, 'fleet.localhost')).body);
  assert.deepEqual(replies, new Set(ports.slice(0, 2).map(p => 'port:' + p)));
  const first = fleet.stop();
  assert.equal(fleet.stop(), first);
  await first;
  assert.deepEqual(store.loadRoutes(), []);
  assert.equal(fleet.status.phase, 'stopped');
  await assert.rejects(fleet.reconcile(), /stopping/);
}));

test('unhealthy replica is isolated immediately and replaced by a verified spare', () => fixture(async ({ dir, store, proxyPort, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1 });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const result = await fleet.reconcile();
  assert.deepEqual(result.replaced.map(r => [r.fromPort, r.toPort]), [[ports[0], ports[2]]]);
  assert.equal(fleet.status.phase, 'running');
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1], ports[2]]);
  for (let i = 0; i < 12; i++) assert.notEqual((await get(proxyPort, 'fleet.localhost')).body, 'port:' + ports[0]);
  assert.equal(fleet.status.replacementAttempts, 1);
}));

test('unexpected process exit is automatically reconciled without a polling tick', () => fixture(async ({ store, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1 });
  process.kill(fleet.status.members[0].pid, 'SIGTERM');
  for (let i = 0; i < 100 && !store.loadRoutes()[0]?.backends?.some(b => b.port === ports[2]); i++) await wait(25);
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1], ports[2]]);
}));

test('replacement startup failure consumes budget and preserves healthy traffic', () => fixture(async ({ dir, store, proxyPort, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1, maxReplacements: 1, env: { TEST_STATE_DIR: dir, STARTUP_FAIL_PORT: String(ports[2]) } });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const attempt = await fleet.reconcile();
  assert.equal(attempt.failures.length, 1);
  assert.equal(fleet.status.phase, 'degraded');
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1]]);
  assert.equal((await get(proxyPort, 'fleet.localhost')).body, 'port:' + ports[1]);
  const second = await fleet.reconcile();
  assert.match(second.failures[0].error, /budget exhausted/);
  assert.equal(fleet.status.replacementAttempts, 1);
  assert.equal(fleet.status.budgetUsed, 1);
}));

test('recovered isolated replica rejoins the route without burning retry budget', () => fixture(async ({ dir, store, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1, maxReplacements: 0 });
  const file = path.join(dir, 'fail-' + ports[0]);
  fs.writeFileSync(file, '1');
  await fleet.reconcile();
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1]]);
  fs.unlinkSync(file);
  await fleet.reconcile();
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1], ports[0]]);
  assert.equal(fleet.status.phase, 'running');
}));

test('fleet honors the drain deadline during replacement', () => fixture(async ({ dir, ports, launch, proxy }) => {
  const fleet = await launch({ unhealthyThreshold: 1, drainTimeoutMs: 25 });
  const finishConnection = proxy.backendConnections.track('fleet.localhost', ports[0]);
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const result = await fleet.reconcile();
  finishConnection();
  assert.equal(result.replaced[0].drained, false);
}));

test('a superseded lease never overwrites a newer owner', () => fixture(async ({ dir, store, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1 });
  const newer = store.registerRoute('fleet.localhost', ports[3], process.pid, true);
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const result = await fleet.reconcile();
  assert.match(result.failures[0].error, /superseded/);
  assert.equal(store.loadRoutes()[0].leaseId, newer.leaseId);
  await fleet.stop();
  assert.equal(store.loadRoutes()[0].leaseId, newer.leaseId);
  newer.release();
}));

test('failed partial fleet launch never publishes or leaves the first replica running', () => fixture(async ({ dir, store, ports, proxy }) => {
  const first = ports[0];
  await assert.rejects(launchInstanceFleet(argv, {
    store, hostname: 'fleet.localhost', ports, replicas: 2,
    connections: proxy.backendConnections, env: { TEST_STATE_DIR: dir, STARTUP_FAIL_PORT: String(ports[1]) },
    health: { path: '/health' }, readyTimeoutMs: 1000, shutdownTimeoutMs: 500, stdio: 'ignore',
  }));
  assert.deepEqual(store.loadRoutes(), []);
  await wait(50);
  const open = net.connect({ host: '127.0.0.1', port: first });
  const connected = await new Promise(resolve => { open.on('connect', () => resolve(true)); open.on('error', () => resolve(false)); });
  open.destroy();
  assert.equal(connected, false);
}));

test('concurrent reconciles share work without spawning duplicate replacements', () => fixture(async ({ dir, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1 });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const first = fleet.reconcile();
  assert.equal(fleet.reconcile(), first);
  const result = await first;
  assert.equal(result.replaced.length, 1);
  assert.equal(fleet.status.replacementAttempts, 1);
}));

test('stop cancels pending replacement without publishing stale traffic', () => fixture(async ({ dir, store, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1, env: { TEST_STATE_DIR: dir, SLOW_START_PORT: String(ports[2]) } });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const checking = fleet.reconcile();
  await wait(50);
  await fleet.stop();
  await checking;
  assert.deepEqual(store.loadRoutes(), []);
  assert.equal(fleet.status.phase, 'stopped');
}));

test('background health monitor replaces an unhealthy generation automatically', () => fixture(async ({ dir, store, ports, launch }) => {
  const fleet = await launch({ healthIntervalMs: 100, unhealthyThreshold: 1 });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  for (let i = 0; i < 80 && !store.loadRoutes()[0]?.backends?.some(b => b.port === ports[2]); i++) await wait(40);
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1], ports[2]]);
  assert.equal(fleet.status.phase, 'running');
}));

test('a drain observer error after cutover cannot tear down the published replacement', () => fixture(async ({ dir, store, proxy, ports, launch }) => {
  const badDrain = { waitForIdle: async (host, port, timeout) => {
    if (port === ports[0]) throw new Error('drain service unavailable');
    return proxy.backendConnections.waitForIdle(host, port, timeout);
  } };
  const fleet = await launch({ unhealthyThreshold: 1, connections: badDrain });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const result = await fleet.reconcile();
  assert.equal(result.replaced.length, 1);
  assert.match(result.failures[0].error, /drain service unavailable/);
  assert.deepEqual(store.loadRoutes()[0].backends.map(b => b.port), [ports[1], ports[2]]);
  assert.equal(fleet.status.phase, 'running');
  await fleet.stop();
  assert.deepEqual(store.loadRoutes(), []);
}));

test('restart budget automatically replenishes after its sliding window', () => fixture(async ({ dir, ports, launch }) => {
  const fleet = await launch({
    unhealthyThreshold: 1, maxReplacements: 1, restartWindowMs: 150,
    env: { TEST_STATE_DIR: dir, STARTUP_FAIL_PORT: String(ports[2]) },
  });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  await fleet.reconcile();
  assert.match((await fleet.reconcile()).failures[0].error, /budget exhausted/);
  await wait(170);
  await fleet.reconcile();
  assert.equal(fleet.status.replacementAttempts, 2);
}));

test('shutdown interrupts a long restart backoff instead of waiting for its timer', () => fixture(async ({ dir, ports, launch }) => {
  const fleet = await launch({ unhealthyThreshold: 1, replacementDelayMs: 20_000, maxReplacementDelayMs: 20_000 });
  fs.writeFileSync(path.join(dir, 'fail-' + ports[0]), '1');
  const working = fleet.reconcile();
  await wait(80);
  const began = Date.now();
  await fleet.stop();
  await working;
  assert.ok(Date.now() - began < 3000, 'cancellation should wake the pending backoff');
  assert.equal(fleet.status.phase, 'stopped');
}));
