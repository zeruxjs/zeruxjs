import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createWebhookHttpsTransport,
  isWebhookAddressAllowed,
  webhookURL,
} from '@zeruxjs/queue/webhooks';
/** Create isolated synthetic durable/native state; caller or callback owns teardown.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function fixture() {
  /** Injected HTTPS requests retained for TLS/lookup/teardown assertions. */
  const requests = [];
  let status = 204,
    chunk = '',
    hold = false;
  /** Injected native request helper; no real external TLS connection.
   * @param {URL} url - Fixed registered synthetic destination.
   * @param {object} options - Explicit injected native request configuration.
   * @param {function} callback - Synthetic response callback; fixture owns request close.
   * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
   */
  const request = (url, options, callback) => {
    /** Owned simulated native request; its close event controls slot release. */
    const req = new EventEmitter();
    req.closed = false;
    req.destroy = () => {
      if (req.closed) {
        return;
      }
      req.closed = true;
      options.signal.removeEventListener('abort', abort);
      queueMicrotask(() => req.emit('close'));
    };
    /** Forward fixture cancellation and close only the owned simulated request.
     * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
     */
    const abort = () => {
      req.emit('error', Error('private abort'));
      req.destroy();
    };
    options.signal.addEventListener('abort', abort, { once: true });
    req.end = (body) => {
      requests.push({ url, options, body, req });
      queueMicrotask(() => {
        if (req.closed) {
          return;
        }
        options.lookup(url.hostname, { family: 4 }, (error, address) => {
          if (req.closed) {
            return;
          }
          if (error) {
            req.emit('error', error);
            req.destroy();
            return;
          }
          /** Synthetic TLS event source distinguishing pre/post-connect uncertainty. */
          const socket = new EventEmitter();
          req.emit('socket', socket);
          socket.emit('secureConnect');
          if (hold) {
            return;
          }
          /** Synthetic complete/aborted response stream with bounded bytes. */
          const response = new EventEmitter();
          response.statusCode = status;
          response.headers = {};
          response.destroy = () => req.destroy();
          callback(response);
          queueMicrotask(() => {
            if (chunk) {
              response.emit('data', Buffer.from(chunk));
            }
            response.emit('end');
            req.destroy();
          });
        });
      });
      return req;
    };
    return req;
  };
  return {
    request,
    requests,
    set status(v) {
      status = v;
    },
    set chunk(v) {
      chunk = v;
    },
    set hold(v) {
      hold = v;
    },
  };
}
/** Explicit synthetic webhook/HTTPS packet with test-only signing data.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const input = () => ({
  url: 'https://hooks.example/events',
  body: '{}',
  headers: {},
  signal: new AbortController().signal,
  timeoutMs: 20,
});
/** Explicit finite synthetic retry/origin/egress policy. */
const policy = {
  allowedOrigins: ['https://hooks.example'],
  approveAddress: () => true,
};
test('public origin/address rules deny private/encoded/mapped endpoints before delivery', () => {
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
  ]) {
    assert.equal(isWebhookAddressAllowed(address), false, address);
  }
  assert.equal(isWebhookAddressAllowed('8.8.8.8'), true);
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const url of [
    'http://hooks.example/events',
    'https://user:secret@hooks.example/events',
    'https://hooks.example/events?token=secret',
    'https://other.example/events',
    'https://2130706433/',
    'https://[::1]/',
  ]) {
    assert.throws(
      () => webhookURL(url, policy.allowedOrigins),
      (e) => e.code === 'DESTINATION_DENIED'
    );
  }
});
test('lookup is revalidated at connection time, mixed private answers/egress denial fail closed and no redirects are followed', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  let lookups = 0,
    addresses = ['8.8.8.8'];
  /** Owned injected HTTPS scope; await close through actual resolver settlement. */
  const transport = createWebhookHttpsTransport({
    ...policy,
    request: f.request,
    resolve: async () => {
      lookups++;
      return addresses;
    },
  });
  try {
    assert.equal((await transport.send(input())).status, 204);
    assert.equal(f.requests[0].options.agent, false);
    assert.equal(f.requests[0].options.rejectUnauthorized, true);
    addresses = ['8.8.8.8', '127.0.0.1'];
    await assert.rejects(
      transport.send(input()),
      (e) => e.code === 'ADDRESS_DENIED'
    );
    addresses = ['8.8.8.8'];
    f.status = 302;
    assert.equal((await transport.send(input())).status, 302);
    assert.equal(f.requests.length, 3);
    assert.equal(lookups, 3);
    assert.ok(f.requests.every((item) => item.req.closed));
  } finally {
    await transport.close();
  }
  assert.equal(transport.status().pending, 0);
  /** Deliberately unauthorized synthetic workflow/transport. */
  const denied = createWebhookHttpsTransport({
    ...policy,
    approveAddress: () => false,
    request: f.request,
    resolve: async () => ['8.8.8.8'],
  });
  await assert.rejects(
    denied.send(input()),
    (e) => e.code === 'ADDRESS_DENIED'
  );
  await denied.close();
});
test('response byte ceiling and post-connect timeout are uncertain; DNS outage is not-sent', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  f.chunk = 'PRIVATE response';
  /** Owned injected HTTPS scope; await close through actual resolver settlement. */
  const transport = createWebhookHttpsTransport({
    ...policy,
    request: f.request,
    resolve: async () => ['8.8.8.8'],
    maxResponseBytes: 2,
  });
  await assert.rejects(
    transport.send(input()),
    (e) => e.code === 'OUTCOME_UNKNOWN' && !e.message.includes('PRIVATE')
  );
  f.chunk = '';
  f.hold = true;
  await assert.rejects(
    transport.send(input()),
    (e) => e.code === 'OUTCOME_UNKNOWN'
  );
  await transport.close();
  assert.equal(transport.status().pending, 0);
  /** Owned deliberately failing resolver transport fixture; errors stay private. */
  const dns = createWebhookHttpsTransport({
    ...policy,
    request: f.request,
    resolve: async () => {
      throw Error('private resolver detail');
    },
  });
  await assert.rejects(
    dns.send(input()),
    (e) => e.code === 'NOT_SENT' && !e.message.includes('private')
  );
  await dns.close();
});
test('cancelled DNS remains bounded/owned until actual lookup settlement and late callbacks cannot connect', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  let finish;
  /** Owned injected HTTPS scope; await close through actual resolver settlement. */
  const transport = createWebhookHttpsTransport({
    ...policy,
    request: f.request,
    resolve: () => new Promise((resolve) => (finish = resolve)),
    maxPending: 1,
  });
  /** Owned request cancellation controller, distinct from durable-session state. */
  const controller = new AbortController();
  /** Actually pending injected send/lookup; release and observe before teardown. */
  const sending = transport.send({ ...input(), signal: controller.signal });
  try {
    while (!finish) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort();
    await assert.rejects(
      transport.send(input()),
      (e) => e.code === 'TRANSPORT_OVERLOAD'
    );
    assert.equal(transport.status().pending, 1);
    finish(['8.8.8.8']);
    await assert.rejects(sending, (e) => e.code === 'NOT_SENT');
    await transport.close();
    assert.ok(f.requests.every((item) => item.req.closed));
    assert.equal(transport.status().pending, 0);
  } finally {
    controller.abort();
    finish?.([]);
    await Promise.allSettled([sending]);
    await transport.close();
  }
});
