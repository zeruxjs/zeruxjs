import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequestLifecycle } from '../dist/bootstrap/request-lifecycle.js';

/** Create an injected response emitter with explicit terminal events.
 * @returns {EventEmitter} Mutable response fixture; end and destroy emit their respective terminal event.
 */
function response() {
  /** Synthetic response emitter whose finish/close events own request settlement. */
  const res = new EventEmitter();
  Object.assign(res, {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    statusCode: 200,
    headers: {},
    /** Record the lifecycle response header on the synthetic response.
     * @param {string} name - Header name assigned by the lifecycle.
     * @param {string} value - Authored header value.
     * @returns {void} Updates the fixture header map.
     */
    setHeader(name, value) {
      this.headers[name] = value;
    },
    /** Mark the synthetic response finished and emit its completion event.
     * @returns {void} Signals finish without a native socket.
     */
    end() {
      this.writableEnded = true;
      this.emit('finish');
    },
    /** Mark the synthetic response destroyed and emit disconnect.
     * @returns {void} Signals close without a native socket.
     */
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
  });
  return res;
}

test('streams continue after a handler completes; drain waits for response completion', async () => {
  /** Request lifecycle owner drained only after all accepted responses settle. */
  const generation = createRequestLifecycle(async () => {});
  /** Minimal accepted request; this fixture exercises lifecycle ownership rather than HTTP parsing. */
  const req = {};
  /** Synthetic response emitter whose finish/close events own request settlement. */
  const res = response();
  await generation.handle(req, res);
  assert.equal(generation.activeRequests, 1);
  /** Drain promise held until the accepted synthetic response finishes. */
  const pending = generation.drain();
  let drained = false;
  pending.then(() => {
    drained = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(drained, false);
  res.end();
  await pending;
  assert.equal(generation.activeRequests, 0);
  assert.equal(drained, true);
});

test('draining generation rejects new work with 503 while existing work finishes', async () => {
  /** Request lifecycle owner drained only after all accepted responses settle. */
  const generation = createRequestLifecycle(() => {});
  /** Previously accepted response allowed to finish after draining starts. */
  const first = response();
  await generation.handle({}, first);
  /** Drain promise proving shutdown waits for already accepted response work. */
  const stopped = generation.drain();
  /** New response rejected while its generation is draining. */
  const later = response();
  await generation.handle({}, later);
  assert.equal(later.statusCode, 503);
  assert.equal(later.headers['retry-after'], '1');
  first.end();
  await stopped;
});

test('request completion and connection close settle active counters only once', async () => {
  /** Request lifecycle owner drained only after all accepted responses settle. */
  const generation = createRequestLifecycle(() => {});
  /** Synthetic response emitter whose finish/close events own request settlement. */
  const res = response();
  await generation.handle({}, res);
  res.emit('finish');
  res.emit('close');
  assert.equal(generation.activeRequests, 0);
  await generation.drain();
  await generation.drain();
});

test('handler exceptions destroy the stream and do not strand draining', async () => {
  /** Request lifecycle owner drained only after all accepted responses settle. */
  const generation = createRequestLifecycle(() => {
    throw new Error('handler failure');
  });
  /** Synthetic response emitter whose finish/close events own request settlement. */
  const res = response();
  await assert.rejects(generation.handle({}, res), /handler failure/);
  assert.equal(res.destroyed, true);
  await generation.drain();
});
