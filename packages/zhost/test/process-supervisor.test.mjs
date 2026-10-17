import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { launchSupervisedCommand, canConnect, exitStatus } from '../dist/portless/process-supervisor.js';

const app = `const net=require('node:net');
const server=net.createServer(c=>c.end('OK'));server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());`;

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('awaits TCP readiness, preserves argv/env, then drains the child', async () => {
  const port = await availablePort();
  const seen = [];
  const beforeInt = process.listenerCount('SIGINT');
  const p = await launchSupervisedCommand([process.execPath, '-e', app], {
    port, env: { PORT: String(port) }, stdio: 'ignore',
    onExit: value => seen.push(value),
  });
  try {
    assert.equal(p.running, true);
    assert.equal(await canConnect(port), true);
    const result = await p.stop();
    assert.equal(result.code, 0);
    assert.equal(await canConnect(port), false);
    assert.equal(seen.length, 1);
    assert.strictEqual(await p.stop(), result);
  } finally { if (p.running) await p.stop(); }
  assert.equal(process.listenerCount('SIGINT'), beforeInt);
});

test('refuses to claim an occupied listener as readiness for a new child', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(launchSupervisedCommand([process.execPath, '-e', app], {
      port: server.address().port, stdio: 'ignore',
    }), /already accepting/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('failed spawn is rejected without leaking signal listeners', async () => {
  const baseline = process.listenerCount('SIGTERM');
  await assert.rejects(launchSupervisedCommand(['a-command-that-does-not-exist-' + process.pid], {
    stdio: 'ignore',
  }), error => error?.code === 'ENOENT');
  assert.equal(process.listenerCount('SIGTERM'), baseline);
});

test('early child exit and TCP timeout do not publish a ready process', async () => {
  const port = await availablePort();
  await assert.rejects(launchSupervisedCommand([process.execPath, '-e', 'process.exit(17)'], {
    port, stdio: 'ignore', readyTimeoutMs: 1200,
  }), /exited before listening/);
  await assert.rejects(launchSupervisedCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
    port, stdio: 'ignore', readyTimeoutMs: 120,
  }), /did not listen/);
  assert.equal(await canConnect(port), false);
});

test('invalid options rejected before any process is spawned', async () => {
  await assert.rejects(launchSupervisedCommand([process.execPath], { port: -1 }), /Application port/);
  await assert.rejects(launchSupervisedCommand([process.execPath], { readyTimeoutMs: NaN }), /readyTimeoutMs/);
  await assert.rejects(launchSupervisedCommand([], {}), /command/);
});

test('child exit status is retained and cleanup runs once', async () => {
  let count = 0;
  await assert.rejects(launchSupervisedCommand([process.execPath, '-e', 'process.exit(42)'], {
    port: await availablePort(), stdio: 'ignore', onExit: ({ code }) => { assert.equal(code,42); count++; },
  }), /42/);
  assert.equal(count, 1);
  assert.equal(exitStatus({ code: 42, signal: null }), 42);
});
