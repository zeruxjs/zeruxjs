import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createElasticSearchAdapter } from '@zeruxjs/search-elastic';

test('opt-in disposable Elasticsearch 9.5.x index acceptance', { skip: !process.env.ZX_TEST_ELASTIC_URL ? 'Requires isolated ZX_TEST_ELASTIC_URL, API key and trusted CA' : false }, async () => {
  const endpoint = process.env.ZX_TEST_ELASTIC_URL, apiKey = process.env.ZX_TEST_ELASTIC_API_KEY;
  assert(apiKey, 'ZX_TEST_ELASTIC_API_KEY is required');
  const ca = process.env.ZX_TEST_ELASTIC_CA ? await fs.readFile(process.env.ZX_TEST_ELASTIC_CA, 'utf8') : undefined;
  const index = 'zx057-' + randomUUID();
  const adapter = await createElasticSearchAdapter({ endpoint, allowedEndpoints: [endpoint], auth: { apiKey }, ca, index, timeoutMs: 5000 });
  const { Client } = await import('@elastic/elasticsearch');
  const maintenance = new Client({ node: endpoint, auth: { apiKey }, tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, maxRetries: 0, requestTimeout: 5000 });
  let provisioned = false;
  const call = tenant => ({ tenant, signal: new AbortController().signal, deadline: Date.now() + 5000 });
  try {
    await adapter.ensureIndex(call('a')); provisioned = true;
    await adapter.index([{ id: 'one', text: 'boots' }], call('a'));
    await maintenance.indices.refresh({ index });
    assert.equal((await adapter.search({ text: 'boots' }, call('a'))).hits.length, 1);
    assert.equal((await adapter.search({ text: 'boots' }, call('b'))).hits.length, 0);
    const prior = await adapter.getVersion('one', call('a'));
    await adapter.replaceIfVersion({ id: 'one', text: 'shoes' }, prior.version, call('a'));
    await assert.rejects(adapter.replaceIfVersion({ id: 'one', text: 'stale' }, prior.version, call('a')), { name: 'ElasticConflictError' });
    await adapter.delete(['one'], call('a')); await maintenance.indices.refresh({ index });
    assert.equal((await adapter.search({ text: '' }, call('a'))).hits.length, 0);
  } finally {
    try { if (provisioned) await maintenance.indices.delete({ index }); } finally { await adapter.close(); await maintenance.close(); }
  }
});
