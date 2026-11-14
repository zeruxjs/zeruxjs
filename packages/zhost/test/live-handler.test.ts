import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLiveRequestHandler } from '../dist/dev/live-handler.js';

/** Bind an owned fixture listener to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Owned fixture listener.
 * @returns {Promise<void>} Settles on the native listening callback.
 */
const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
/** Await an owned fixture listener’s close callback.
 * @param {import("node:http").Server} server - Owned active listener.
 * @returns {Promise<unknown>} Native close callback settlement.
 */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Consume a small fixed loopback fixture response.
 * @param {number} port - Ephemeral fixture port.
 * @param {string} url - Fixed fixture request path, default slash.
 * @returns {Promise<object>} Observed small body and status.
 */
const request = (port, url = '/') =>
  new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: url }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ body, status: res.statusCode }));
      })
      .on('error', reject);
  });

test('dev handler hot swap preserves listening port and in-flight handler', async () => {
  let release;
  let started;
  /** Fixture synchronization barrier proving the old generation accepted the held request before swapping. */
  const requestStarted = new Promise((resolve) => (started = resolve));
  /** Owned synthetic handler barrier released before fixture listener cleanup. */
  const pending = new Promise((resolve) => (release = resolve));
  /** Inert switchboard borrowing only fixed fixture handlers; it acquires no listener itself. */
  const live = createLiveRequestHandler(async (_req, res) => {
    started();
    await pending;
    res.end('old');
  });
  /** Owned fixture HTTP server, closed after releasing any held synthetic handler. */
  const server = http.createServer(live.handle);
  await listen(server);
  try {
    /** Ephemeral listener port whose identity must survive handler swap. */
    const port = server.address().port;
    /** Pending old-generation fixture response, consumed after explicitly releasing its barrier. */
    const original = request(port);
    await requestStarted;
    assert.equal(
      live.swap((_req, res) => res.end('new')),
      2
    );
    assert.deepEqual(await request(port), { body: 'new', status: 200 });
    release();
    assert.deepEqual(await original, { body: 'old', status: 200 });
    assert.equal(server.address().port, port);
  } finally {
    release();
    await close(server);
  }
});

test('bad handler is rejected; exceptions produce a bounded 500 response', async () => {
  /** Inert switchboard borrowing only fixed fixture handlers; it acquires no listener itself. */
  const live = createLiveRequestHandler((_req, res) => res.end('healthy'));
  assert.throws(() => live.swap(null), /function/);
  /** Owned fixture HTTP server, closed after releasing any held synthetic handler. */
  const server = http.createServer(live.handle);
  await listen(server);
  try {
    assert.equal((await request(server.address().port)).body, 'healthy');
    live.swap(async () => {
      throw new Error('secret');
    });
    /** Observed sanitized response to the deliberately failing trusted fixture handler. */
    const failure = await request(server.address().port);
    assert.equal(failure.status, 500);
    assert.equal(failure.body, 'Internal Server Error');
  } finally {
    await close(server);
  }
});
