import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
import {
  createMemoryMarketingSuppressionStore,
  createMarketingSuppressionService,
} from '@zeruxjs/email';
/** Create the small database facade required by feedback fixtures; no native driver is opened.
 * @returns {object} Isolated create/insert/select operations over fixture maps.
 */
function db() {
  /** In-memory per-table fixture state; this does not model durable database guarantees. */
  const rows = new Map();
  return {
    /** Initialize the requested fixture table without replacing existing rows.
     * @param {{table: string}} options - Table identifier supplied by the reputation store.
     * @returns {Promise<{ok: boolean}>} Successful fixture schema initialization.
     */
    async createTable({ table }) {
      if (!rows.has(table)) {
        rows.set(table, new Map());
      }
      return { ok: true };
    },
    /** Insert one feedback row while rejecting a duplicate identifier.
     * @param {{table: string, values: {id: string}}} options - Target table and synthetic feedback record.
     * @returns {Promise<{ok: boolean}>} Insertion receipt after the fixture mutation.
     */
    async insert({ table, values }) {
      /** Selected fixture table enforcing unique feedback identifiers. */
      const t = rows.get(table);
      if (t.has(values.id)) {
        throw Error('unique');
      }
      t.set(values.id, values);
      return { ok: true };
    },
    /** Evaluate the narrow feedback query shape with deterministic bounded paging.
     * @param {{table: string, where: object, limit?: number, offset?: number}} options - Fixture table, predicates and page bounds.
     * @returns {Promise<{ok: boolean, rows: object[]}>} Matching synthetic rows in stable identifier order.
     */
    async select({ table, where, limit = 500, offset = 0 }) {
      let values = [...rows.get(table).values()];
      if (where.and) {
        values = values.filter((r) =>
          where.and.every((c) =>
            c.operator === 'gte'
              ? r[c.field] >= c.value
              : r[c.field] === c.value
          )
        );
      } else {
        values = values.filter((r) => r.id === where.value);
      }
      return {
        ok: true,
        rows: values
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(offset, offset + limit),
      };
    },
  };
}
test('config binds reputation to named database; feedback route is generation-scoped', async () => {
  /** Injected database facade used only for reputation persistence wiring. */
  const connection = db();
  let reputation;
  /** Explicit suppression service backed by an isolated memory fixture. */
  const suppression = createMarketingSuppressionService({
    store: createMemoryMarketingSuppressionStore(),
  });
  /** Private account and feedback registration consumed by the generation. */
  const config = {
    email: {
      accounts: [
        {
          name: 'smtp',
          transport: { sendMail: async () => ({ accepted: [] }) },
        },
      ],
      reputation: {
        enabled: true,
        database: 'analytics',
        policy: { minimumAccepted: 1 },
      },
      marketingFeedback: {
        enabled: true,
        parse: (raw) => JSON.parse(Buffer.from(raw)),
        verifySignature: (_body, headers) => headers.get('x-signed') === 'yes',
        feedbackAccount: () => 'smtp',
        suppression,
      },
    },
  };
  /** Generation service owner whose close removes its feedback route. */
  const scope = await initializeRuntimeServices(config, process.cwd(), {
    database: async () => ({
      getConnectionFacade: (slug) => {
        assert.equal(slug, 'analytics');
        return connection;
      },
    }),
    cache: async () => null,
    email: async (
      _conf,
      _files,
      _analytics,
      _tracking,
      _preferences,
      value
    ) => {
      reputation = value;
      return { close: () => {} };
    },
  });
  assert.ok(reputation);
  assert.equal(config.email, undefined);
  /** Authenticated synthetic feedback response checked before reading aggregate state. */
  const response = await scope
    .httpRoutes()
    .find((x) => x.pattern === '/_email/feedback')
    .handler(
      new Request('http://local/_email/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signed': 'yes' },
        body: JSON.stringify([
          { email: 'x@example.test', kind: 'complaint', eventId: 'signed-1' },
        ]),
      })
    );
  assert.equal(response.status, 204);
  assert.equal((await reputation.snapshot('smtp')).complaints, 1);
  await scope.close();
  assert.equal(scope.httpRoutes().length, 0);
});
test('opted-in reputation refuses to start without a DB connector', async () => {
  await assert.rejects(
    initializeRuntimeServices(
      {
        email: {
          accounts: [
            { name: 'smtp', transport: { sendMail: async () => ({}) } },
          ],
          reputation: { enabled: true, database: 'missing' },
        },
      },
      process.cwd(),
      { database: async () => null, cache: async () => null }
    ),
    /requires a configured database/
  );
});
