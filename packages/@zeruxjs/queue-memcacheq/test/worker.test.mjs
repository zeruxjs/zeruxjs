import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMemcacheQ } from '@zeruxjs/queue-memcacheq';
import { createMemcacheQWorker } from '@zeruxjs/queue-memcacheq/worker';
import { selectQueueBackend } from '@zeruxjs/queue/neutral';
import { memcacheQBackend } from '@zeruxjs/queue/backends';
/** Poll a finite synthetic condition with a hard200-iteration limit; not a live-provider success claim.
 * @param {unknown} check - Explicit synthetic fixture callback/settings/value; no private live state.
 * @returns {Promise<unknown>} Synthetic fixture result or bounded assertion failure.
 */
async function until(check) {
  // Process only finite fixture cases/handles; no live broker acceptance is inferred.
  for (let i = 0; i < 200; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw Error('fixture condition not reached');
}
/** Own a temporary loopback FIFO text fixture and its sockets; teardown destroys handles before closing the server.
 * @param {unknown} t - Explicit synthetic fixture callback/settings/value; no private live state.
 * @returns {Promise<unknown>} Synthetic fixture result or bounded assertion failure.
 */
async function fixture(t) {
  /** Synthetic in-memory FIFO buffers; no real broker persistence is claimed. */
  const queues = new Map();
  /** Finite local fixture command log with no operator payloads. */
  const commands = [];
  /** Owned ephemeral fixture sockets destroyed during teardown. */
  const sockets = new Set();
  let hold = false;
  /** Owned ephemeral loopback framing fixture, not a real MemcacheQ server. */
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let data = Buffer.alloc(0),
      done = false;
    socket.on('data', (chunk) => {
      if (done) {
        return;
      }
      data = Buffer.concat([data, chunk]);
      /** First complete native protocol line boundary in the bounded fixture buffer. */
      const end = data.indexOf('\r\n');
      if (end < 0) {
        return;
      }
      /** Synthetic parsed text-protocol command fields, never a shell command. */
      const [op, key, , , size] = data.toString('ascii', 0, end).split(' ');
      if (op === 'set' && data.length < end + Number(size) + 4) {
        return;
      }
      done = true;
      commands.push({ op, key, at: Date.now() });
      if (op === 'set') {
        /** Copied synthetic finite set payload retained only in this fixture. */
        const body = Buffer.from(
          data.subarray(end + 2, end + 2 + Number(size))
        );
        /** Synthetic destination FIFO; tests deliberately model destructive get. */
        const list = queues.get(key) ?? [];
        list.push(body);
        queues.set(key, list);
        socket.write('STORED\r\n');
      } else if (op === 'get') {
        if (hold) {
          return;
        }
        /** One destructive fixture pop; malformed data is never automatically restored. */
        const value = queues.get(key)?.shift();
        socket.write(
          value
            ? Buffer.concat([
                Buffer.from(`VALUE ${key} 0 ${value.length}\r\n`),
                value,
                Buffer.from('\r\nEND\r\n'),
              ])
            : 'END\r\n'
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    connection: {
      host: '127.0.0.1',
      port: server.address().port,
      serverMaxBytes: 8192,
    },
    queues,
    commands,
    sockets,
    /** Toggle fixture reads held open to exercise cancellation and unknown outcomes.
     * @param {unknown} value - Explicit synthetic fixture callback/settings/value; no private live state.
     * @returns {void} Synthetic fixture result or bounded assertion failure.
     */
    set hold(value) {
      hold = value;
    },
  };
}
/** Build deterministic tiny fixture budgets without contacting a real broker.
 * @param {unknown} f - Explicit synthetic fixture callback/settings/value; no private live state.
 * @param {unknown} handler - Explicit synthetic fixture callback/settings/value; no private live state.
 * @param {unknown} extra - Explicit synthetic fixture callback/settings/value; no private live state.
 * @returns {unknown} Synthetic fixture result or bounded assertion failure.
 */
function settings(f, handler, extra = {}) {
  return {
    connection: f.connection,
    queues: [{ name: 'jobs', handler }],
    concurrency: 1,
    idle: { minMs: 2, maxMs: 8, factor: 2, jitter: 0.2 },
    random: () => 0.5,
    processingMs: 100,
    drainMs: 20,
    ...extra,
  };
}
/** Build inert synthetic V1 message bytes for a destructive FIFO test.
 * @param {string} name - Explicit synthetic fixture callback/settings/value; no private live state.
 * @returns {unknown} Synthetic fixture result or bounded assertion failure.
 */
function record(name = 'send') {
  return Buffer.from(
    JSON.stringify({ version: 1, name, data: { recordId: 'one' } })
  );
}
test('V1 producer/consumer preserves shape, legacy reads are explicit, unsafe/unsupported requests fail before sockets', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  /** Owned basic client closed and drained in finally. */
  const queue = createMemcacheQ(f.connection);
  try {
    await queue.add('jobs', 'send', { recordId: 'one' });
    assert.equal(JSON.parse(f.queues.get('zerux:jobs')[0]).version, 1);
    assert.deepEqual(await queue.take('jobs'), {
      name: 'send',
      data: { recordId: 'one' },
    });
    f.queues.set('zerux:jobs', [Buffer.from('{"name":"old","data":{}}')]);
    assert.deepEqual(await queue.take('jobs'), { name: 'old', data: {} });
    /** Pre-denial socket command count; invalid options must remain inert. */
    const calls = f.commands.length;
    /** Already-cancelled fixture signal proving pre-dispatch denial. */
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      queue.take('jobs', { signal: aborted.signal }),
      (e) => e.code === 'MEMCACHEQ_CANCELLED'
    );
    await assert.rejects(
      queue.take('jobs', { deadline: 0 }),
      (e) => e.code === 'MEMCACHEQ_DEADLINE'
    );
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const opt of [
      { delay: 0 },
      { priority: 1 },
      { ack: true },
      { retry: true },
    ]) {
      await assert.rejects(
        queue.add('jobs', 'send', {}, opt),
        /INVALID_OPTIONS/
      );
    }
    await assert.rejects(
      queue.add('jobs', 'send', { large: 'x'.repeat(9000) }),
      /PAYLOAD_LIMIT/
    );
    await assert.rejects(
      queue.add('jobs', 'send', JSON.parse('{"constructor":1}')),
      /INVALID_PAYLOAD/
    );
    assert.equal(f.commands.length, calls);
    f.queues.set('zerux:jobs', [
      Buffer.concat([
        Buffer.from('{"version":1,"name":"send","data":{"invalid":"'),
        Buffer.from([255]),
        Buffer.from('"}}'),
      ]),
    ]);
    await assert.rejects(
      queue.take('jobs'),
      (e) => e.code === 'MEMCACHEQ_INVALID_POPPED_MESSAGE'
    );
    /** Owned V1-only client; closes and drains even when malformed-envelope assertions fail. */
    const strict = createMemcacheQ({ ...f.connection, acceptLegacy: false });
    try {
      // Process only finite fixture cases/handles; no live broker acceptance is inferred.
      for (const envelope of [
        { version: 2, name: 'send', data: {} },
        { name: 'old', data: {} },
      ]) {
        f.queues.set('zerux:jobs', [Buffer.from(JSON.stringify(envelope))]);
        await assert.rejects(
          strict.take('jobs'),
          (e) =>
            e.code === 'MEMCACHEQ_INVALID_POPPED_MESSAGE' &&
            !e.message.includes('old')
        );
      }
    } finally {
      strict.close();
      await strict.whenClosed();
    }
    assert.throws(
      () => createMemcacheQ({ ...f.connection, maxBytes: 9000 }),
      /INVALID_OPTIONS/
    );
    assert.throws(
      () => createMemcacheQ({ ...f.connection, serverMaxBytes: 65536 }),
      /INVALID_OPTIONS/
    );
  } finally {
    queue.close();
    await queue.whenClosed();
  }
  assert.equal(queue.activeSocketCount, 0);
});
test('empty polling uses finite jittered backoff and close releases timers/sockets without more pops', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(settings(f, async () => {}));
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await until(() => worker.status().emptyPolls >= 4);
  assert.equal(worker.status().lastIdleMs, 8);
  /** Bounded close receipt observed separately from actual handler/socket settlement. */
  const closing = worker.close();
  await closing;
  await worker.closed;
  /** Post-close command baseline; no further destructive pops are allowed. */
  const count = f.commands.length;
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(f.commands.length, count);
  assert.equal(worker.status().pendingTimers, 0);
  assert.equal(worker.status().activeSockets, 0);
  assert.equal(worker.status().state, 'closed');
});
test('bounded concurrency holds actual slots through timeout, never reinserts failed or timed-out messages', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  f.queues.set(
    'zerux:jobs',
    Array.from({ length: 5 }, () => record())
  );
  /** Held handler settlement callbacks; release them even after an assertion failure. */
  const finish = [];
  /** Observed synthetic handler signals, not private application state. */
  const signals = [];
  /** Fixed redacted error metadata captured only for fixture assertions. */
  const notices = [];
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(
    settings(
      f,
      (job) => {
        signals.push(job.signal);
        return new Promise((resolve) => finish.push(resolve));
      },
      {
        concurrency: 2,
        processingMs: 5,
        onError: (notice) => notices.push(notice),
      }
    )
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    for (const resolve of finish) {
      resolve();
    }
    await worker.close();
    await worker.closed;
  });
  try {
    await until(() => worker.status().timeouts === 2);
    assert.equal(worker.status().activeHandlers, 2);
    assert.equal(f.commands.filter((c) => c.op === 'get').length, 2);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.ok(
      notices.every(
        (notice) =>
          notice.code === 'MEMCACHEQ_PROCESSING_TIMEOUT' &&
          !JSON.stringify(notice).includes('recordId')
      )
    );
    await worker.close();
    assert.equal(worker.status().state, 'incomplete');
    assert.equal(f.commands.filter((c) => c.op === 'set').length, 0);
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const resolve of finish) {
      resolve();
    }
    await worker.closed;
    assert.equal(worker.status().state, 'closed');
  } finally {
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const resolve of finish) {
      resolve();
    }
    await worker.close();
  }
});
test('close during socket read cancels native handles; graceful handler drain retains its signal until grace', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  f.hold = true;
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(settings(f, async () => {}));
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await until(() => f.sockets.size === 1);
  await worker.close();
  await worker.closed;
  assert.equal(worker.status().pendingReads, 0);
  assert.equal(worker.status().activeSockets, 0);
  assert.equal(worker.status().pollFailures, 0);
  f.hold = false;
  f.queues.set('zerux:jobs', [record()]);
  let finish, signal;
  /** Owned graceful-drain worker; release its synthetic handler before awaiting actual closure. */
  const handler = createMemcacheQWorker(
    settings(f, (job) => {
      signal = job.signal;
      return new Promise((resolve) => (finish = resolve));
    })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    finish?.();
    await handler.close();
    await handler.closed;
  });
  await until(() => finish);
  /** Bounded close receipt observed separately from actual handler/socket settlement. */
  const closing = handler.close();
  assert.equal(signal.aborted, false);
  finish();
  await closing;
  await handler.closed;
  assert.equal(handler.status().completed, 1);
  assert.equal(handler.status().state, 'closed');
});
test('malformed popped records, handler errors and callback exceptions remain redacted with no retry', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  f.queues.set('zerux:jobs', [
    Buffer.from('SECRET malformed body'),
    Buffer.from('{"version":9,"name":"send","data":{}}'),
    record(),
  ]);
  /** Fixed redacted error metadata captured only for fixture assertions. */
  const notices = [];
  let calls = 0;
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(
    settings(
      f,
      async () => {
        calls++;
        throw Error('SECRET handler');
      },
      {
        onError(notice) {
          notices.push(notice);
          throw Error('SECRET hook');
        },
      }
    )
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await until(() => worker.status().handlerFailures === 1);
  await worker.close();
  await worker.closed;
  assert.equal(calls, 1);
  assert.equal(worker.status().pollFailures, 2);
  assert.ok(worker.status().hookFailures >= 1);
  assert.doesNotMatch(JSON.stringify(notices), /SECRET|recordId/);
  assert.equal(f.commands.filter((c) => c.op === 'set').length, 0);
  assert.equal(f.queues.get('zerux:jobs').length, 0);
});
test('cancellation and configuration/capability denial are inert before polling; invalid jitter input stops safely', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  /** Already-aborted host signal; worker must remain inert before polling. */
  const controller = new AbortController();
  controller.abort();
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(
    settings(f, async () => {}, { signal: controller.signal })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await worker.close();
  await worker.closed;
  assert.equal(f.commands.length, 0);
  assert.throws(
    () => createMemcacheQWorker(settings(f, async () => {}, { delay: 100 })),
    /INVALID_OPTIONS/
  );
  assert.throws(
    () =>
      createMemcacheQWorker(
        settings(f, async () => {}, { connection: { host: 'localhost' } })
      ),
    /INVALID_OPTIONS/
  );
  assert.throws(
    () =>
      selectQueueBackend(
        memcacheQBackend(createMemcacheQ, ['jobs']),
        f.connection,
        { requireCapabilities: ['acknowledgement'] }
      ),
    (e) => e.code === 'UNSUPPORTED_CAPABILITY'
  );
  /** Worker with an intentionally invalid jitter source; it must fail and clean resources safely. */
  const invalid = createMemcacheQWorker(
    settings(f, async () => {}, { random: () => NaN })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await invalid.close();
    await invalid.closed;
  });
  await invalid.closed;
  assert.equal(invalid.status().state, 'failed');
  assert.equal(invalid.status().activeSockets, 0);
});
test('backend disconnection reports an unknown destructive outcome and remains cancellable', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  f.hold = true;
  /** Fixed redacted error metadata captured only for fixture assertions. */
  const notices = [];
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(
    settings(f, async () => {}, { onError: (notice) => notices.push(notice) })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await until(() => f.sockets.size === 1);
  // Process only finite fixture cases/handles; no live broker acceptance is inferred.
  for (const socket of f.sockets) {
    socket.destroy();
  }
  await until(() => worker.status().pollFailures === 1);
  await worker.close();
  await worker.closed;
  assert.equal(notices[0].code, 'MEMCACHEQ_POP_UNKNOWN');
  assert.equal(notices[0].mayHaveLostMessage, true);
  assert.equal(worker.status().activeSockets, 0);
});
test('idle jitter is bounded and asynchronous error hooks are isolated with one pending notification', async (t) => {
  /** Owned synthetic protocol fixture with its teardown registered on the test. */
  const f = await fixture(t);
  let random = 0,
    finish;
  /** Owned polling worker; close is bounded and closed observes actual work. */
  const worker = createMemcacheQWorker(
    settings(f, async () => {}, { random: () => random })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    await worker.close();
    await worker.closed;
  });
  await until(() => worker.status().emptyPolls >= 4);
  assert.equal(worker.status().lastIdleMs, 6);
  random = 1;
  await until(() => worker.status().emptyPolls >= 5);
  assert.equal(worker.status().lastIdleMs, 8);
  await worker.close();
  await worker.closed;
  f.queues.set('zerux:jobs', [Buffer.from('bad'), Buffer.from('bad')]);
  /** Worker with a deliberately held error callback; release it before awaiting actual closed. */
  const hook = createMemcacheQWorker(
    settings(f, async () => {}, {
      drainMs: 5,
      onError: () => new Promise((resolve) => (finish = resolve)),
    })
  );
  // Always release held synthetic work before observing the actual settlement barrier.
  t.after(async () => {
    finish?.();
    await hook.close();
    await hook.closed;
  });
  await until(() => hook.status().droppedNotices === 1);
  await hook.close();
  assert.equal(hook.status().state, 'incomplete');
  assert.equal(hook.status().pendingErrorHooks, 1);
  finish();
  await hook.closed;
  assert.equal(hook.status().pendingTimers, 0);
});
