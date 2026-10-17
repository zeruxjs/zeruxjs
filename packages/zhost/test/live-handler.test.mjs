import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLiveRequestHandler } from '../dist/dev/live-handler.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const request = (port, url = '/') => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port, path: url }, res => {
    let body = ''; res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({ body, status: res.statusCode }));
  }).on('error', reject);
});

test('dev handler hot swap preserves listening port and in-flight handler', async () => {
  let release;
  let started;
  const requestStarted = new Promise(resolve => started = resolve);
  const pending = new Promise(resolve => release = resolve);
  const live = createLiveRequestHandler(async (_req, res) => {
    started(); await pending; res.end('old');
  });
  const server = http.createServer(live.handle);
  await listen(server);
  try {
    const port = server.address().port;
    const original = request(port);
    await requestStarted;
    assert.equal(live.swap((_req, res) => res.end('new')), 2);
    assert.deepEqual(await request(port), { body: 'new', status: 200 });
    release();
    assert.deepEqual(await original, { body: 'old', status: 200 });
    assert.equal(server.address().port, port);
  } finally { release(); await close(server); }
});

test('bad handler is rejected; exceptions produce a bounded 500 response', async () => {
  const live = createLiveRequestHandler((_req, res) => res.end('healthy'));
  assert.throws(() => live.swap(null), /function/);
  const server = http.createServer(live.handle); await listen(server);
  try {
    assert.equal((await request(server.address().port)).body, 'healthy');
    live.swap(async () => { throw new Error('secret'); });
    const failure = await request(server.address().port);
    assert.equal(failure.status, 500);
    assert.equal(failure.body, 'Internal Server Error');
  } finally { await close(server); }
});
