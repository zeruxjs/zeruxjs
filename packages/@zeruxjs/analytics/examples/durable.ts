import {createEventSchemaRegistry} from '@zeruxjs/analytics';
import {createDurableAnalytics, type DurableAnalyticsOptions, type DurableAnalyticsStore} from '@zeruxjs/analytics/durable';

export function configureDurableSales(
  store: DurableAnalyticsStore,
  authorize: DurableAnalyticsOptions['authorize']
) {
  const schemaRegistry = createEventSchemaRegistry([{
    name: 'sale', version: 1,
    properties: {amount: {kind: 'metric', unit: 'count', required: true}}
  }]);
  // Host owns the durable store, migration, transaction journal and shutdown.
  return createDurableAnalytics({store, schemaRegistry, numericFields: ['amount'], authorize});
}

export async function acceptSale(
  durable: ReturnType<typeof configureDurableSales>,
  verifiedSite: string, key: string, occurredAt: number, principal: unknown
) {
  return durable.accept({
    name: 'sale', site: verifiedSite, source: 'server', consent: 'granted',
    occurredAt, properties: {amount: 1}
  }, key, principal);
  // state:'accepted' proves ledger commit, not query-visible event persistence.
}
