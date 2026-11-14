import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericFactId, reconcileNumericFacts } from '../dist/index.js';

/** Closed historical source window, independent of current ingestion-age policy. */
const query = { since: 1, until: 1, site: 'tenant-a' };
/** Synthetic source event whose projection has one configured numeric value. */
const event = {
  id: 'historical-event',
  event_name: 'purchase',
  source: 'server',
  site: 'tenant-a',
  pathname: '/',
  occurred_at: 1,
  properties_json: '{"revenue":8}',
};
/** Expected fact values; hashes identify fields without granting permission. */
const fact = {
  id: numericFactId(event.id, 'revenue'),
  event_id: event.id,
  property_name: 'revenue',
  numeric_value: 8,
  event_name: event.event_name,
  source: event.source,
  site: event.site,
  pathname: event.pathname,
  occurred_at: event.occurred_at,
};

test('lost insert acknowledgement is read back without replay or borrowed close', async () => {
  let writes = 0;
  let closes = 0;
  let committed = false;
  /** Borrowed fixture reports a lost response after committing its single write. */
  const connection = {
    async select(operation) {
      if (operation.table === 'events') {
        assert.ok(
          operation.where.and.some(
            (p) => p.field === 'site' && p.value === 'tenant-a'
          )
        );
        return { ok: true, rows: [event] };
      }
      return { ok: true, rows: committed ? [fact] : [] };
    },
    async insert() {
      writes++;
      committed = true;
      throw new Error('synthetic response lost');
    },
    async close() {
      closes++;
    },
  };
  /** Readback confirms the committed projection without claiming this call inserted it. */
  const result = await reconcileNumericFacts(
    connection,
    'events',
    'facts',
    ['revenue'],
    query
  );
  assert.equal(result.created, 0);
  assert.equal(result.existing, 1);
  assert.equal(result.windowExhausted, true);
  assert.equal(writes, 1);
  assert.equal(closes, 0);
});

test('a conflicting stored value rejects before any write', async () => {
  let writes = 0;
  /** A legacy ID is permitted, but changed values must not be accepted as equivalent. */
  const connection = {
    async select(operation) {
      return {
        ok: true,
        rows:
          operation.table === 'events'
            ? [event]
            : [{ ...fact, id: 'legacy_0', numeric_value: 9 }],
      };
    },
    async insert() {
      writes++;
      return { ok: true };
    },
  };
  await assert.rejects(
    reconcileNumericFacts(connection, 'events', 'facts', ['revenue'], query),
    /Conflicting numeric fact/
  );
  assert.equal(writes, 0);
});
