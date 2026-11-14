import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createElasticSearchAdapter } from '@zeruxjs/search-elastic';

test(
  'opt-in disposable Elasticsearch 9.5.x index acceptance',
  {
    skip: !process.env.ZX_TEST_ELASTIC_URL
      ? 'Requires isolated ZX_TEST_ELASTIC_URL, API key and trusted CA'
      : false,
  },
  async (t) => {
    /** Explicit owned local HTTPS fixture or opt-in isolated live-engine endpoint. */
    const endpoint = process.env.ZX_TEST_ELASTIC_URL;
    if (!endpoint) {
      return;
    }
    /** Explicit opt-in live credential; never print or include it in assertion labels. */
    const apiKey = process.env.ZX_TEST_ELASTIC_API_KEY;
    assert(apiKey, 'ZX_TEST_ELASTIC_API_KEY is required');
    /** Host-selected trusted CA contents for the explicit isolated acceptance fixture. */
    const ca = process.env.ZX_TEST_ELASTIC_CA
      ? await fs.readFile(process.env.ZX_TEST_ELASTIC_CA, 'utf8')
      : undefined;
    /** Random disposable live-test index name; cleanup touches only this created namespace. */
    const index = 'zx057-' + randomUUID();
    /** Owned live-test adapter/client; teardown drains and closes it independently of maintenance. */
    const adapter = await createElasticSearchAdapter({
      endpoint,
      allowedEndpoints: [endpoint],
      auth: { apiKey },
      ca,
      index,
      timeoutMs: 5000,
    });
    // Import/maintenance-construction failure must still release the acquired adapter.
    t.after(() => adapter.close());
    /** Official maintained client used only for explicit isolated maintenance operations. */
    const { Client } = await import('@elastic/elasticsearch');
    /** Owned privileged isolated-test client; close independently of adapter cleanup failure. */
    const maintenance = new Client({
      node: endpoint,
      auth: { apiKey },
      tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      maxRetries: 0,
      requestTimeout: 5000,
    });
    let provisioned = false;
    /** Create an explicit fixture tenant scope with cooperative signal and finite deadline.
     * @param {string} tenant - Verified fixture tenant; defaults to shop-a where declared.
     * @returns {object} Independent bounded call scope.
     */
    const call = (tenant: string) => ({
      tenant,
      signal: new AbortController().signal,
      deadline: Date.now() + 5000,
    });
    try {
      await adapter.ensureIndex(call('a'));
      provisioned = true;
      await adapter.index([{ id: 'one', text: 'boots' }], call('a'));
      await maintenance.indices.refresh({ index });
      assert.equal(
        (await adapter.search({ text: 'boots' }, call('a'))).hits.length,
        1
      );
      assert.equal(
        (await adapter.search({ text: 'boots' }, call('b'))).hits.length,
        0
      );
      /** Previous synthetic request count or native version used for exact replay/CAS checks. */
      const prior = await adapter.getVersion('one', call('a'));
      await adapter.replaceIfVersion(
        { id: 'one', text: 'shoes' },
        prior.version,
        call('a')
      );
      await assert.rejects(
        adapter.replaceIfVersion(
          { id: 'one', text: 'stale' },
          prior.version,
          call('a')
        ),
        { name: 'ElasticConflictError' }
      );
      await adapter.delete(['one'], call('a'));
      await maintenance.indices.refresh({ index });
      assert.equal(
        (await adapter.search({ text: '' }, call('a'))).hits.length,
        0
      );
    } finally {
      try {
        if (provisioned) {
          await maintenance.indices.delete({ index });
        }
      } finally {
        try {
          await adapter.close();
        } finally {
          await maintenance.close();
        }
      }
    }
  }
);
