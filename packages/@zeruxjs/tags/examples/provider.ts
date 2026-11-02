import {
  createTagProviderRegistry, createTagManager, type TagRuntimeOptions,
} from '@zeruxjs/tags';

// One manager/store/credential scope per tenant or explicitly authorized site mapping.
export function createShopTags(host: Pick<TagRuntimeOptions,
  'analytics' | 'requestIds' | 'store' | 'destinations' | 'authorizeAdmin' | 'authorizePublish'>) {
  const providers = createTagProviderRegistry();
  providers.register({
    id: 'orders', version: 1,
    config: {channel: {type: 'string', required: true, values: ['web']}},
    destinations: ['orders'],
    async dispatch({event, config, send, signal}) {
      if (signal.aborted) return;
      await send('orders', {event: event.name, channel: config.channel});
    },
  });
  const manager = createTagManager({...host, site: 'shop', defaultConsent: 'denied',
    providers, ownProviders: true, maxConcurrentDispatches: 4});
  return manager; // host mounts routes explicitly and awaits manager.close() on teardown
}

// Save this tag in a DRAFT with its referenced trigger, then authorize/publish separately:
// {id:'order_tag',name:'Order',type:'provider',providerRef:'orders',providerVersion:1,
//  publicConfig:{channel:'web'},triggerIds:['purchase']}
// Provider code and destination URL/headers live only in trusted server configuration.
// Use a shared durable host store/requestIds adapter; omitted store is development-only.
