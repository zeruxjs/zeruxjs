import {createCacheHelper} from '@zeruxjs/cache-valkey';
import {createCacheManagerWithHelper} from '@zeruxjs/cache';

export async function greeting(url: string) {
  const helper = await createCacheHelper({url});
  const cache = createCacheManagerWithHelper(helper, {prefix: 'example:tenant-42'});
  try {
    await cache.set('greeting', {text: 'Hello'}, {ttlSeconds: 60});
    return await cache.get('greeting');
  } finally {
    await cache.close();
    await helper.whenClosed();
  }
}
