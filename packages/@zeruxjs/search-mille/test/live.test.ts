import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createMilleSearchAdapter } from '@zeruxjs/search-mille';

test(
  'opt-in isolated Meilisearch 1.x task/settings/tenant acceptance',
  {
    skip: !process.env.ZX_TEST_MEILI_URL
      ? 'Requires isolated ZX_TEST_MEILI_URL and scoped ZX_TEST_MEILI_API_KEY'
      : false,
  },
  async (t) => {
    /** Explicit opt-in isolated HTTPS engine endpoint; never discover from request input. */
    const endpoint = process.env.ZX_TEST_MEILI_URL;
    if (!endpoint) {
      return;
    }
    /** Explicit private opt-in credential; never print or include it in diagnostic labels. */
    const apiKey = process.env.ZX_TEST_MEILI_API_KEY;
    assert(apiKey, 'ZX_TEST_MEILI_API_KEY required');
    /** Owned live-test random index name or recorded synthetic indexing call. */
    const index = 'zx058-' + randomUUID();
    /** Create a verified fixture tenant call with an independent cooperative signal/deadline.
     * @param {string} tenant - Synthetic verified tenant; defaults to a where declared.
     * @returns {object} Independent finite call scope.
     */
    const call = (tenant: string = 'a') => ({
      tenant,
      signal: new AbortController().signal,
      deadline: Date.now() + 30000,
    });
    /** Owned wrapper used by synthetic SDK or opt-in live fixtures; always await close. */
    const adapter = await createMilleSearchAdapter({
      endpoint,
      allowedEndpoints: [endpoint],
      apiKey,
      index,
      taskKey: randomBytes(32),
      taskScope: index,
      timeoutMs: 30000,
      fields: { category: 'string' },
      filterable: ['category'],
    });
    // Import/construction failure still releases the already acquired wrapper/key copy.
    t.after(() => adapter.close());
    /** Official client constructor used only for explicit isolated-test maintenance. */
    const { Meilisearch } = await import('meilisearch');
    /** Host-owned isolated-test SDK surface; the SDK exposes no close method or dedicated owned pool. */
    const maintenance = new Meilisearch({
      host: endpoint,
      apiKey,
      timeout: 5000,
      requestInit: { redirect: 'error' },
    });
    try {
      // This random namespace is fixture-owned even if acknowledgement is lost.
      /** Accepted privileged setup task; callers must inspect its terminal state. */
      const setup = await adapter.createIndex(call());
      /** Verified terminal setup result; accepted creation alone is insufficient. */
      const createdTask = await adapter.waitForTask(setup.taskId, call(), {
        maxPolls: 100,
        intervalMs: 100,
      });
      assert.equal(createdTask.state, 'succeeded');
      /** Explicit compatible native settings fixture; mutations intentionally exercise validation failure. */
      const settings = await adapter.configureIndex(call());
      assert.equal(
        (
          await adapter.waitForTask(settings.taskId, call(), {
            maxPolls: 100,
            intervalMs: 100,
          })
        ).state,
        'succeeded'
      );
      /** Opaque accepted task reference; it does not establish searchable completion. */
      const receipt = await adapter.index(
        [{ id: '1', text: 'boots', category: 'books' }],
        call()
      );
      assert.equal(receipt.state, 'accepted');
      assert.equal(
        (
          await adapter.waitForTask(receipt.taskId, call(), {
            maxPolls: 100,
            intervalMs: 100,
          })
        ).state,
        'succeeded'
      );
      assert.equal(
        (
          await adapter.search(
            {
              text: 'boots',
              filters: [
                {
                  field: 'category',
                  operator: 'eq',
                  value: 'BOOKS',
                  caseSensitive: false,
                },
              ],
            },
            call()
          )
        ).hits.length,
        1
      );
      assert.equal(
        (await adapter.search({ text: 'boots' }, call('b'))).hits.length,
        0
      );
      /** Accepted deletion reference; cleanup/search assertions wait for completion. */
      const deleted = await adapter.delete(['1'], call());
      assert.equal(
        (await adapter.waitForTask(deleted.taskId, call())).state,
        'succeeded'
      );
      assert.equal(
        (await adapter.search({ text: 'boots' }, call())).hits.length,
        0
      );
    } finally {
      try {
        /** Explicit deletion task for this random fixture-owned index only. */
        const cleanup = await maintenance.deleteIndex(index);
        /** Native terminal cleanup state; unknown outcomes are not silently accepted. */
        const terminal = await maintenance.tasks.waitForTask(cleanup.taskUid, {
          timeout: 30000,
          interval: 100,
        });
        assert(
          terminal.status === 'succeeded' ||
            (terminal.status === 'failed' &&
              terminal.error?.code === 'index_not_found'),
          'Disposable index cleanup did not complete'
        );
      } finally {
        await adapter.close();
      }
    }
  }
);
