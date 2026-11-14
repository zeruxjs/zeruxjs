import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMediaTransfers } from '../dist/browser.mjs';
/** Fixed synthetic non-root public mount; injected Fetch prevents live network access. */
const baseUrl = 'https://media.test/api/';
/** Exact synthetic origin allowlist for transfer destination checks. */
const allowedOrigins = ['https://media.test'];
/** Fixture SHA-256 helper/value used to assert byte integrity independently of authorization.
 * @param {Uint8Array} bytes - Explicit synthetic bytes hashed independently.
 * @returns {string} Lowercase digest of the explicit synthetic bytes.
 */
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('stream downloads honor lengths/progress/backpressure; Blob verification and URL revocation are explicit', async () => {
  /** Synthetic explicit payload bytes; no real tenant content or remote files are used. */
  const bytes = new TextEncoder().encode('hello');
  /** Fixture-local diagnostic/progress records; never shared between test cases. */
  const events = [];
  /** Recorded synthetic object-URL revocations for exact ownership assertions. */
  const revoked = [];
  let created = 0;
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async (url, init) => {
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'same-origin');
      return new Response(bytes, { headers: { 'content-length': '5' } });
    },
    objectUrls: {
      /** Record a synthetic owned Blob URL for deterministic revocation checks.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      createObjectURL() {
        return 'blob:fixture-' + ++created;
      },
      /** Record revocation of exactly the supplied synthetic owned URL.
       * @param {string} url - Synthetic object URL owned by this fixture.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  });
  try {
    /** Synthetic ordered chunks or part references checked before completion. */
    const parts = [];
    /** Observed bounded operation outcome compared with explicit fixture expectations. */
    const result = await client.downloadTo(
      'document',
      new WritableStream({
        /** Observe one synthetic sink chunk while honoring the test backpressure barrier.
         * @param {Uint8Array} chunk - Synthetic byte chunk observed by the sink.
         * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
         */
        async write(chunk) {
          await Promise.resolve();
          parts.push(chunk);
        },
      }),
      { onProgress: (p) => events.push(p) }
    );
    assert.equal(result.loaded, 5);
    assert.equal(parts.length, 1);
    assert.deepEqual(events, [{ loaded: 5, total: 5 }]);
    /** Explicit small synthetic Blob; any native URL lease has separate revocation ownership. */
    const blob = await client.downloadBlob('document', {
      maxBytes: 5,
      sha256: sha(bytes),
    });
    assert.equal(await blob.text(), 'hello');
    /** Owned synthetic object-URL lease, explicitly revoked to verify idempotent cleanup. */
    const owned = client.objectUrl(blob);
    owned.revoke();
    owned.revoke();
    /** Second independent owned URL lease used to check close revocation. */
    const other = client.objectUrl(blob);
    await client.close();
    other.revoke();
    assert.deepEqual(revoked, ['blob:fixture-1', 'blob:fixture-2']);
    assert.throws(() => client.objectUrl(blob), /closed/);
  } finally {
    await client.close();
  }
});
test('cancelled/failed downloads cancel readers and abort sinks; size/hash/progress failures expose no Blob', async () => {
  let cancelled = 0,
    aborted = 0;
  /** Synthetic readable byte source; reader ownership must be released on failure/cancellation. */
  const source = new ReadableStream({
    /** Hold a synthetic read until cancellation exercises reader cleanup.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    pull() {
      return new Promise(() => {});
    },
    /** Record cooperative cancellation of this synthetic source.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    cancel() {
      cancelled++;
    },
  });
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async () => new Response(source),
  });
  /** Fixture cancellation controller; aborting it does not imply a durable session was deleted. */
  const controller = new AbortController();
  /** Admitted fixture operation retained until its actual settlement is observed. */
  const work = client.downloadTo(
    'slow',
    new WritableStream({
      /** Record synthetic sink abort separately from reader cancellation.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      abort() {
        aborted++;
      },
    }),
    { signal: controller.signal }
  );
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  await assert.rejects(work, /cancelled/);
  assert.equal(cancelled, 1);
  assert.equal(aborted, 1);
  assert.equal(source.locked, false);
  await client.close();
  // Exercise the fixed synthetic cases or release only handles owned by this fixture.
  // Exercise the fixed synthetic cases or release only handles owned by this fixture.
  for (const [headers, input, pattern] of [
    [{ 'content-length': '50' }, { maxBytes: 4 }, /limit/],
    [
      { 'content-length': '5' },
      { maxBytes: 5, sha256: '0'.repeat(64) },
      /integrity/,
    ],
    [{ 'content-length': '6' }, { maxBytes: 6 }, /length/],
  ]) {
    /** Independent transfer client used for one invalid declaration case; closed in finally. */
    const next = createMediaTransfers({
      baseUrl,
      allowedOrigins,
      fetch: async () => new Response('hello', { headers }),
    });
    try {
      await assert.rejects(next.downloadBlob('file', input), pattern);
    } finally {
      await next.close();
    }
  }
  let cancelledProgress = 0;
  /** Fixture progress records or owned observer-failure client, scoped to this case. */
  const progress = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async () =>
      new Response(
        new ReadableStream({
          /** Seed the explicit synthetic request stream without remote input.
           * @param {ReadableStreamDefaultController} c - Owned synthetic stream controller.
           * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
           */
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          /** Record cooperative cancellation of this synthetic source.
           * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
           */
          cancel() {
            cancelledProgress++;
          },
        })
      ),
  });
  try {
    await assert.rejects(
      progress.downloadTo('file', new WritableStream(), {
        /** Throw the declared observer failure to verify transfer cleanup.
         * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
         */
        onProgress() {
          throw new Error('observer failed');
        },
      }),
      /observer failed/
    );
    assert.equal(cancelledProgress, 1);
  } finally {
    await progress.close();
  }
});
test('stream upload progress is consumed bytes; network failure and cancellation release source ownership', async () => {
  /** Small synthetic upload Blob; progress means consumed bytes, not server commit. */
  const payload = new Blob(['hello']);
  /** Fixture progress records or owned observer-failure client, scoped to this case. */
  const progress = [];
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async (url, init) => {
      /** Synthetic Fetch request or fixed subprocess arguments; never operator credentials. */
      const request = new Request(url, init);
      assert.equal(await request.text(), 'hello');
      return new Response('ok');
    },
  });
  try {
    /** Synthetic/native response whose body is explicitly consumed or cancelled by the fixture. */
    const response = await client.upload('upload', payload, {
      size: 5,
      contentType: 'text/plain',
      onProgress: (p) => progress.push(p),
    });
    assert.equal(await response.text(), 'ok');
    assert.equal(progress.at(-1).loaded, 5);
  } finally {
    await client.close();
  }
  let cleanup = 0;
  /** Synthetic readable byte source; reader ownership must be released on failure/cancellation. */
  const source = new ReadableStream({
    /** Record cooperative cancellation of this synthetic source.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    cancel() {
      cleanup++;
    },
  });
  /** Deliberately failing injected client/controller used to assert redacted dependency outcomes. */
  const failed = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async () => {
      throw new Error('network outage');
    },
  });
  try {
    await assert.rejects(
      failed.upload('upload', source, { size: 1, contentType: 'text/plain' }),
      /network outage/
    );
    assert.equal(cleanup, 1);
    assert.equal(source.locked, false);
  } finally {
    await failed.close();
  }
  /** Synthetic never-completing source used to exercise cooperative reader cancellation. */
  const stalled = new ReadableStream({
    /** Hold a synthetic read until cancellation exercises reader cleanup.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    pull() {
      return new Promise(() => {});
    },
    /** Record cooperative cancellation of this synthetic source.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    cancel() {
      cleanup++;
    },
  });
  /** Fixture cancellation controller; aborting it does not imply a durable session was deleted. */
  const controller = new AbortController();
  /** Owned transfer client for the cancellation case; actual settlement remains awaited. */
  const cancelled = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async (url, init) => {
      await new Request(url, init).arrayBuffer();
      return new Response();
    },
  });
  /** Admitted fixture operation retained until its actual settlement is observed. */
  const work = cancelled.upload('upload', stalled, {
    size: 1,
    contentType: 'text/plain',
    signal: controller.signal,
  });
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  await assert.rejects(work);
  assert.equal(stalled.locked, false);
  await cancelled.close();
});
test('destination policy rejects traversal/redirect destinations; attachment uses a native link without buffering', async () => {
  assert.throws(
    () =>
      createMediaTransfers({ baseUrl: 'https://other.test', allowedOrigins }),
    /denied/
  );
  let fetched = 0,
    clicked = 0,
    removed = 0;
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async () => {
      fetched++;
      return new Response();
    },
  });
  /** Synthetic native attachment anchor recording activation/removal without a browser download. */
  const anchor = {
    /** Record native attachment activation without downloading a real file.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    click() {
      clicked++;
    },
    /** Record removal of the temporary synthetic anchor.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    remove() {
      removed++;
    },
  };
  /** Minimal injected DOM contract used only for native attachment behavior. */
  const document = {
    createElement: () => anchor,
    body: {
      /** Accept the synthetic attachment anchor without creating a live DOM.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      append() {},
    },
  };
  client.downloadAttachment('document', 'report.pdf', document);
  assert.equal(clicked, 1);
  assert.equal(removed, 1);
  assert.equal(fetched, 0);
  assert.equal(anchor.href, baseUrl + 'document');
  assert.equal(anchor.download, 'report.pdf');
  assert.throws(
    () => client.downloadAttachment('../escape', 'x', document),
    /denied/
  );
  assert.throws(
    () => client.downloadAttachment('document', 'x\nInjected', document),
    /unavailable/
  );
  await client.close();
});
test('close cancels and drains active readers; unavailable object-URL support fails explicitly', async () => {
  let released = 0;
  /** Synthetic readable byte source; reader ownership must be released on failure/cancellation. */
  const source = new ReadableStream({
    /** Hold a synthetic read until cancellation exercises reader cleanup.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    pull() {
      return new Promise(() => {});
    },
    /** Record cooperative cancellation of this synthetic source.
     * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    cancel() {
      released++;
    },
  });
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    fetch: async () => new Response(source),
  });
  /** Admitted fixture operation retained until its actual settlement is observed. */
  const work = client.downloadTo('file', new WritableStream());
  await new Promise((r) => setTimeout(r, 10));
  /** Owned drain promise observed separately from request cancellation. */
  const closing = client.close();
  await assert.rejects(work, /cancelled/);
  await closing;
  assert.equal(released, 1);
  assert.equal(source.locked, false);
  await client.close();
  /** Fixture client lacking object-URL support; explicit failure is expected. */
  const missing = createMediaTransfers({
    baseUrl,
    allowedOrigins,
    objectUrls: {},
  });
  assert.throws(() => missing.objectUrl(new Blob(['data'])), /unavailable/);
  await missing.close();
});
