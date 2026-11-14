import { createConnector } from '@zeruxjs/db-sqlite';
import { createQueueService } from '@zeruxjs/queue-bullmq';
import { createZyroRenderer } from 'zeruxjs/renderers';
import { h, renderToString } from 'zyrojs/dom';

/** Explicit operator action on a NEW disposable tutorial database. Never called by registration.
 * @param {string} filename - Trusted private path for a new synthetic SQLite database.
 * @returns {Promise<void>} Creates/seeds transactionally and always releases the connector.
 */
export async function initializeTutorialDatabase(filename) {
  /** Borrowed-lifetime connector acquired for this explicit synthetic example and disconnected in finally/close. */
  const db = await createConnector({ filename, driver: 'node' });
  try {
    db.transactionSync((tx) => {
      tx.execute({
        op: 'createTable',
        table: 'tutorial_items',
        columns: [
          { name: 'id', type: 'integer', primary: true },
          { name: 'label', type: 'text' },
        ],
      });
      tx.insert({
        table: 'tutorial_items',
        values: { id: 1, label: 'A public synthetic note' },
      });
    });
  } finally {
    await db.disconnect();
  }
}
/** Public, synthetic-only example. Host policy must be added before reading private records.
 * @param {object} api - Explicit host route/renderer/disposal registration contract.
 * @param {object} root0 - Required host-owned connection settings.
 * @param {string} root0.filename - Existing synthetic SQLite file; registration never runs migrations.
 * @param {string} root0.redisUrl - Explicit private Redis connection URL, never logged or sent to browsers.
 * @param {Function} queueFactory - Trusted injectable acknowledged queue factory; defaults to the public BullMQ implementation.
 * @returns {Promise<object>} Explicit close and opaque-reference enqueue handles; startup failures roll back acquisitions.
 */
export async function registerTutorial(
  api,
  { filename, redisUrl },
  queueFactory = createQueueService
) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    typeof redisUrl !== 'string' ||
    !/^rediss?:\/\//.test(redisUrl)
  ) {
    throw new TypeError('Explicit tutorial database and Redis URL required');
  }
  /** Borrowed-lifetime connector acquired for this explicit synthetic example and disconnected in finally/close. */
  const db = await createConnector({
    filename,
    driver: 'node',
    busyTimeoutMs: 1000,
  });
  let queues,
    closed = false;
  /** Idempotent teardown closes queue workers before their database dependency. */
  /** Close only this example’s resources, workers before the database.
   * @returns {Promise<void>} Idempotent ordered teardown; dependency failures remain visible.
   */
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      await queues?.close();
    } finally {
      await db.disconnect();
    }
  };
  try {
    /** Bounded synchronous read of the required existing synthetic schema; never a migration. */
    /** Read at most ten synthetic public records on the explicit synchronous SQLite transaction.
     * @returns {object[]} Bounded current rows; missing schema rejects instead of auto-migrating.
     */
    const rows = () =>
      db.transactionSync(
        (tx) => tx.select({ table: 'tutorial_items', limit: 10 }),
        { mode: 'deferred' }
      ).rows;
    rows(); // Existing schema is required; no automatic request/startup migration.
    queues = await queueFactory({
      redis: { url: redisUrl },
      prefix: 'docs-tutorial',
      queues: ['snapshots'],
      workers: {
        snapshots: {
          concurrency: 1,
          processor: async (job) => {
            if (
              job.name !== 'snapshot' ||
              job.data.reference !== 'public-demo-v1'
            ) {
              throw Error('Unknown tutorial reference');
            }
            return { count: rows().length }; // repeatable read, no emails/payments or private payload logging
          },
        },
      },
    });
    /** Explicit public Zyro renderer registered through the host API, not by importing the example. */
    const renderer = api
      .renderers()
      .register(
        createZyroRenderer((view) => '<!doctype html>' + renderToString(view))
      );
    api.onDispose(close);
    api.addRoute({
      pattern: '/',
      method: 'GET',
      handler: (ctx) =>
        ctx.render(
          renderer,
          h(
            'html',
            { lang: 'en' },
            h(
              'head',
              null,
              h('meta', { charset: 'utf-8' }),
              h('title', null, 'Public notes')
            ),
            h(
              'body',
              null,
              h(
                'main',
                null,
                h('h1', null, 'Public notes'),
                h('ul', null, ...rows().map((row) => h('li', null, row.label)))
              )
            )
          )
        ),
    });
    return {
      close,
      enqueueSnapshot: () =>
        queues
          .queue('snapshots')
          .add(
            'snapshot',
            { reference: 'public-demo-v1' },
            { removeOnComplete: 10, removeOnFail: 10 }
          ),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
