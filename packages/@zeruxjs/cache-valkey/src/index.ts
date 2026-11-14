import type { CacheHelperFactory } from '@zeruxjs/cache';
import {
  createValkeyCacheHelper,
  helperPolicy,
  helperKeys,
  integer,
  keys,
  fail,
} from './helper.js';
import type { ValkeyClient, ValkeyConnectionOptions } from './types.js';
export * from './types.js';
export {
  ValkeyCacheHelper,
  ValkeyCacheError,
  createValkeyCacheHelper,
} from './helper.js';
export interface ValkeyClientConstructors {
  /** Construct an explicit lazy standalone driver, without connecting yet.
   * @param {Record<string,unknown>} options - Reviewed native policy settings.
   * @param {string|undefined} url - Optional validated redis/rediss URL.
   * @returns {ValkeyClient & {connect():Promise<unknown>}} Native client whose connection is owned by the factory.
   */
  standalone(
    options: Record<string, unknown>,
    url?: string
  ): ValkeyClient & { connect(): Promise<unknown> };
  /** Construct an explicit lazy Cluster driver with reviewed no-replay policy.
   * @param {Array<{host:string,port:number}>} nodes - Validated detached Cluster seed list.
   * @param {Record<string,unknown>} options - Reviewed native policy settings.
   * @returns {ValkeyClient & {connect():Promise<unknown>}} Native Cluster client; redirects are disabled by factory policy.
   */
  cluster(
    nodes: { host: string; port: number }[],
    options: Record<string, unknown>
  ): ValkeyClient & { connect(): Promise<unknown> };
}
/** Explicit trusted connection options; arbitrary native passthrough rejects. */
const connectionKeys = [
  'client',
  'url',
  'host',
  'port',
  'username',
  'password',
  'db',
  'tls',
  'cluster',
  'connectTimeoutMs',
  'maxReconnectAttempts',
];

/** Validate a trusted endpoint/servername without whitespace or control bytes.
 * @param {unknown} value - Candidate nonempty host, maximum 253 characters.
 * @returns {string} Validated original host; host egress policy remains external. */
const host = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 253 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\s\x00-\x1f\x7f]/.test(value)
  ) {
    throw fail('VALKEY_INVALID_CONNECTION');
  }
  return value;
};
/** Validate bounded host TLS material and enforce certificate verification.
 * @param {ValkeyConnectionOptions['tls']} value - Optional host TLS material, never request-provided.
 * @returns {object|undefined} Copied TLS settings or absence; arbitrary native flags reject.
 */
function tls(value: ValkeyConnectionOptions['tls']) {
  if (value === undefined) {
    return;
  }
  keys(value, ['ca', 'cert', 'key', 'servername']);
  // Validate bounded TLS material; no arbitrary native option passthrough.
  for (const key of ['ca', 'cert', 'key'] as const) {
    // Normalize TLS material only after own-key validation; do not forward native flags.
    let entries: unknown[] = [];
    if (value[key] !== undefined) {
      entries = Array.isArray(value[key]) ? value[key] : [value[key]];
    }
    if (
      entries.length > 8 ||
      entries.some(
        (text) =>
          typeof text !== 'string' ||
          !text.length ||
          Buffer.byteLength(text) > 65536
      )
    ) {
      throw fail('VALKEY_INVALID_TLS');
    }
  }
  if (value.servername !== undefined) {
    host(value.servername);
  }
  return {
    ...value,
    ...(Array.isArray(value.ca) ? { ca: [...value.ca] } : {}),
    rejectUnauthorized: true,
  };
}
/** Acquire only explicitly configured safe clients using the pinned driver or injected constructors.
 * @param {ValkeyConnectionOptions} raw - Trusted host connection/helper settings, default local standalone.
 * @param {ValkeyClientConstructors} injected - Optional explicit trusted constructors for testing/host integration.
 * @returns {Promise<ValkeyCacheHelper>} Closeable wrapper; startup failure cleans acquired native resources.
 */
export async function createCacheHelper(
  raw: ValkeyConnectionOptions = {},
  injected?: ValkeyClientConstructors
) {
  keys(raw, [...helperKeys, ...connectionKeys]);
  /** Only reviewed wrapper options, validated before native construction. */
  const helper = Object.fromEntries(
    helperKeys
      .filter((key) => Object.hasOwn(raw, key))
      .map((key) => [key, (raw as Record<string, unknown>)[key]])
  );
  helperPolicy(helper);
  /** Connection establishment ceiling, default 3000ms, maximum 120000. */
  const connectTimeout = integer(raw.connectTimeoutMs ?? 3000, 1, 120000);
  /** Finite lifetime reconnect budget, default zero, maximum three. */
  const reconnect = integer(raw.maxReconnectAttempts ?? 0, 0, 3);
  if (raw.client) {
    if (
      connectionKeys.some(
        (key) =>
          !['client', 'connectTimeoutMs', 'maxReconnectAttempts'].includes(
            key
          ) && Object.hasOwn(raw, key)
      )
    ) {
      throw fail('VALKEY_CONFLICTING_CONNECTION');
    }
    return createValkeyCacheHelper(raw.client, helper);
  }
  if (raw.ownClient === false) {
    throw fail('VALKEY_CONFLICTING_OWNERSHIP');
  }
  /** Validated copied TLS material with certificate verification enforced. */
  const nativeTls = tls(raw.tls);
  let url: string | undefined;

  if (raw.url !== undefined) {
    if (
      typeof raw.url !== 'string' ||
      raw.url.length > 4096 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x1f\x7f]/.test(raw.url)
    ) {
      throw fail('VALKEY_INVALID_URL');
    }
    let parsed: URL;
    try {
      parsed = new URL(raw.url);
    } catch {
      throw fail('VALKEY_INVALID_URL');
    }
    if (
      !['redis:', 'rediss:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.search ||
      parsed.hash ||
      !/^\/(?:\d{1,10})?$/.test(parsed.pathname || '/') ||
      Number(parsed.pathname.slice(1) || 0) > 2147483647
    ) {
      throw fail('VALKEY_INVALID_URL');
    }
    if (
      ['host', 'port', 'username', 'password', 'db', 'cluster'].some((key) =>
        Object.hasOwn(raw, key)
      )
    ) {
      throw fail('VALKEY_CONFLICTING_CONNECTION');
    }
    if (nativeTls && parsed.protocol !== 'rediss:') {
      throw fail('VALKEY_INVALID_TLS');
    }
    url = raw.url;
  }

  if (raw.host !== undefined) {
    host(raw.host);
  }
  if (raw.port !== undefined) {
    integer(raw.port, 1, 65535);
  }
  if (raw.db !== undefined) {
    integer(raw.db, 0, 2147483647);
  }
  // Reject invalid credential text without including it in diagnostics.
  for (const field of ['username', 'password'] as const) {
    if (
      raw[field] !== undefined &&
      (typeof raw[field] !== 'string' ||
        raw[field]!.length > 4096 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
        /[\x00-\x1f\x7f]/.test(raw[field]!))
    ) {
      throw fail('VALKEY_INVALID_CONNECTION');
    }
  }
  let nodes: { host: string; port: number }[] | undefined;
  if (raw.cluster) {
    keys(raw.cluster, ['nodes']);
    if (['url', 'host', 'port', 'db'].some((key) => Object.hasOwn(raw, key))) {
      throw fail('VALKEY_CONFLICTING_CONNECTION');
    }
    if (
      !Array.isArray(raw.cluster.nodes) ||
      !raw.cluster.nodes.length ||
      raw.cluster.nodes.length > 32
    ) {
      throw fail('VALKEY_INVALID_CLUSTER');
    }
    nodes = raw.cluster.nodes.map((node) => {
      keys(node, ['host', 'port']);
      return { host: host(node.host), port: integer(node.port, 1, 65535) };
    });
  }
  let constructors = injected;
  if (!constructors) {
    try {
      /** Fixed lazily imported iovalkey module, never selected by user data. */
      const module = await import('iovalkey');
      constructors = {
        /** Construct an explicit lazy standalone driver, without connecting yet.
         * @param {Record<string,unknown>} options - Reviewed native policy settings.
         * @param {string|undefined} url - Optional validated redis/rediss URL.
         * @returns {ValkeyClient & {connect():Promise<unknown>}} Native client whose connection is owned by the factory.
         */
        standalone(options, url) {
          return (url
            ? new module.Valkey(url, options)
            : new module.Valkey(options)) as unknown as ReturnType<
            ValkeyClientConstructors['standalone']
          >;
        },
        /** Construct an explicit lazy Cluster driver with reviewed no-replay policy.
         * @param {Array<{host:string,port:number}>} nodes - Validated detached Cluster seed list.
         * @param {Record<string,unknown>} options - Reviewed native policy settings.
         * @returns {ValkeyClient & {connect():Promise<unknown>}} Native Cluster client; redirects are disabled by factory policy.
         */
        cluster(nodes, options) {
          return new module.Cluster(nodes, options) as unknown as ReturnType<
            ValkeyClientConstructors['cluster']
          >;
        },
      };
    } catch (cause) {
      throw fail('VALKEY_DRIVER_UNAVAILABLE', cause);
    }
  }
  let attempts = 0,
    clusterAttempts = 0;
  /** Owned native policy disabling offline replay, retries and unsafe numeric conversion. */
  const connection = {
    ...(raw.username !== undefined ? { username: raw.username } : {}),
    ...(raw.password !== undefined ? { password: raw.password } : {}),
    ...(raw.db !== undefined ? { db: raw.db } : {}),
    ...(nativeTls ? { tls: nativeTls } : {}),
    connectTimeout,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    reconnectOnError: null,
    stringNumbers: true,
    retryStrategy: () =>
      ++attempts <= reconnect ? Math.min(attempts * 50, 250) : null,
  };
  let client: ValkeyClient & { connect(): Promise<unknown> };
  try {
    client = nodes
      ? constructors.cluster(nodes, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRedirections: 0,
          scaleReads: 'master',
          redisOptions: connection,
          clusterRetryStrategy: () =>
            ++clusterAttempts <= reconnect
              ? Math.min(clusterAttempts * 50, 250)
              : null,
        })
      : constructors.standalone(
          {
            ...connection,
            ...(!url
              ? { host: raw.host ?? '127.0.0.1', port: raw.port ?? 6379 }
              : {}),
          },
          url
        );
  } catch (cause) {
    throw fail('VALKEY_CONNECT_FAILED', cause);
  }
  /** Handle native error events during startup without logging private configuration.

 * @returns {void} Removed after wrapper ownership or failure cleanup. */
  const silent = () => {};
  client.on('error', silent);
  let adapter: ReturnType<typeof createValkeyCacheHelper> | undefined;
  try {
    adapter = createValkeyCacheHelper(client, { ...helper, ownClient: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            client.disconnect(false);
            reject(fail('VALKEY_CONNECT_DEADLINE'));
          }, connectTimeout);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
    client.off('error', silent);
    return adapter;
  } catch (cause) {
    client.disconnect(false);
    try {
      await adapter?.close();
    } catch {
      /* Original initialization cause retained privately. */
    }
    client.off('error', silent);
    throw fail('VALKEY_CONNECT_FAILED', cause);
  }
}
export default createCacheHelper;
/** Compile-time compatibility check against the shared cache factory signature. */
const factory: CacheHelperFactory = createCacheHelper;
void factory;
