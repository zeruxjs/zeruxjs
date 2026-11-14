import { createEventSchemaRegistry } from '@zeruxjs/analytics';
import {
  createDurableAnalytics,
  type DurableAnalyticsOptions,
  type DurableAnalyticsStore,
} from '@zeruxjs/analytics/durable';

/** Configure a disposable durable-ingestion owner without starting queue, migration or retry work. The host owns its store/journal and must close the returned coordinator.
 * @param {DurableAnalyticsStore} store - Host-owned shared atomic durable primary.
 * @param {DurableAnalyticsOptions['authorize']} authorize - Host-verified action/site/principal policy.
 * @returns {ReturnType<typeof createDurableAnalytics>} Coordinator requiring explicit acceptance/materialization calls.
 */
export function configureDurableSales(
  store: DurableAnalyticsStore,
  authorize: DurableAnalyticsOptions['authorize']
) {
  /** Explicit finite sale schema; amount uses count units and is validated before durable acceptance. */
  const schemaRegistry = createEventSchemaRegistry([
    {
      name: 'sale',
      version: 1,
      properties: { amount: { kind: 'metric', unit: 'count', required: true } },
    },
  ]);
  // Host owns the durable store, migration, transaction journal and shutdown.
  return createDurableAnalytics({
    store,
    schemaRegistry,
    numericFields: ['amount'],
    authorize,
  });
}

/** Accept a synthetic sale into the durable ledger using explicit host context. Accepted does not mean query-visible event persistence.
 * @param {ReturnType<typeof configureDurableSales>} durable - Borrowed configured coordinator; its owner handles shutdown.
 * @param {string} verifiedSite - Host-verified site.
 * @param {string} key - Stable opaque site-bound deduplication key.
 * @param {number} occurredAt - Explicit UTC event timestamp.
 * @param {unknown} principal - Verified initiating principal, reauthorized by the configured policy.
 * @returns {ReturnType<ReturnType<typeof configureDurableSales>['accept']>} Typed acceptance receipt or an explicit authorization/storage failure.
 */
export async function acceptSale(
  durable: ReturnType<typeof configureDurableSales>,
  verifiedSite: string,
  key: string,
  occurredAt: number,
  principal: unknown
) {
  return durable.accept(
    {
      name: 'sale',
      site: verifiedSite,
      source: 'server',
      consent: 'granted',
      occurredAt,
      properties: { amount: 1 },
    },
    key,
    principal
  );
  // state:'accepted' proves ledger commit, not query-visible event persistence.
}
