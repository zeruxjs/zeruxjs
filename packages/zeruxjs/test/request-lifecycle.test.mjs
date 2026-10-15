import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequestLifecycle } from '../dist/bootstrap/request-lifecycle.js';

function response() {
  const res = new EventEmitter();
  Object.assign(res, {
    headersSent: false, writableEnded: false, destroyed: false,
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end() { this.writableEnded = true; this.emit('finish'); },
    destroy() { this.destroyed = true; this.emit('close'); }
  });
  return res;
}

test('streams continue after a handler completes; drain waits for response completion', async () => {
  const generation = createRequestLifecycle(async () => {});
  const req = {}, res = response();
  await generation.handle(req, res);
  assert.equal(generation.activeRequests, 1);
  const pending = generation.drain(); let drained = false;
  pending.then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(drained, false);
  res.end();
  await pending;
  assert.equal(generation.activeRequests, 0);
  assert.equal(drained, true);
});

test('draining generation rejects new work with 503 while existing work finishes', async () => {
  const generation = createRequestLifecycle(() => {});
  const first = response(); await generation.handle({}, first);
  const stopped = generation.drain();
  const later = response(); await generation.handle({}, later);
  assert.equal(later.statusCode, 503);
  assert.equal(later.headers['retry-after'], '1');
  first.end(); await stopped;
});

test('request completion and connection close settle active counters only once', async () => {
  const generation = createRequestLifecycle(() => {});
  const res = response(); await generation.handle({}, res);
  res.emit('finish'); res.emit('close');
  assert.equal(generation.activeRequests, 0);
  await generation.drain(); await generation.drain();
});

test('handler exceptions destroy the stream and do not strand draining', async () => {
  const generation = createRequestLifecycle(() => { throw new Error('handler failure'); });
  const res = response(); await assert.rejects(generation.handle({}, res), /handler failure/);
  assert.equal(res.destroyed, true);
  await generation.drain();
});
