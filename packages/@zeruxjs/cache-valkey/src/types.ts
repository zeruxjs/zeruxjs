import type { CachePolicy, CacheSetOptions } from '@zeruxjs/cache';
export interface ValkeyClient {
  /** Actual native options inspected to reject unsafe replay/offline policies. */
  readonly options: Record<string, any>;
  /** Read one raw native value.
   * @param {string} key - Exact native key.
   * @returns {Promise<string|null>} Native string or null.
   */
  get(key: string): Promise<string | null>;
  /** Send one prepared native write.
   * @param {string} key - Exact native key.
   * @param {string} value - Prepared encoded string.
   * @param {(string | number)[]} args - Trusted native command tokens.
   * @returns {Promise<unknown>} Native status; helper independently validates it.
   */
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  /** Delete one exact key.
   * @param {string} key - Exact native key.
   * @returns {Promise<number|string>} Native integer reply, validated by helper.
   */
  del(key: string): Promise<number | string>;
  /** Check one exact key.
   * @param {string} key - Exact native key.
   * @returns {Promise<number|string>} Native integer presence reply.
   */
  exists(key: string): Promise<number | string>;
  /** Increment native signed integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number|string>} Native result may exceed safe JS precision.
   */
  incrby(key: string, amount: number): Promise<number | string>;
  /** Decrement native signed integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number|string>} Native result may exceed safe JS precision.
   */
  decrby(key: string, amount: number): Promise<number | string>;
  /** Set native item expiry.
   * @param {string} key - Exact native key.
   * @param {number} seconds - Native expiry seconds.
   * @returns {Promise<number|string>} Native binary status reply.
   */
  expire(key: string, seconds: number): Promise<number | string>;
  /** Read one current-master cursor page.
   * @param {string} cursor - Native cursor string.
   * @param {(string | number)[]} args - Trusted native command tokens.
   * @returns {Promise<[string,string[]]>} Native cursor and keys, not a snapshot.
   */
  scan(
    cursor: string,
    ...args: (string | number)[]
  ): Promise<[string, string[]]>;
  /** Return actual master clients for a Cluster sweep.
   * @param {'master'} role - Only current master inventory is requested.
   * @returns {ValkeyClient[]} Current master inventory; bounded by helper.
   */
  nodes?(role: 'master'): ValkeyClient[];
  /** Destructively flush this database only under explicit standalone approval.
   * @returns {Promise<unknown>} Native reply.
   */
  flushdb(): Promise<unknown>;
  /** Gracefully close an owned native client.
   * @returns {Promise<unknown>} Native close reply.
   */
  quit(): Promise<unknown>;
  /** Disconnect via the public native API.
   * @param {boolean} reconnect - Optional native reconnect selector; shutdown passes false.
   * @returns {void} Does not prove submitted writes rolled back.
   */
  disconnect(reconnect?: boolean): void;
  /** Register an exact lifecycle listener.
   * @param {string} event - Explicit event name.
   * @param {(...args: any[]) => void} listener - Exact callback retained and removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  on(event: string, listener: (...args: any[]) => void): unknown;
  /** Remove the exact owned listener.
   * @param {string} event - Explicit event name.
   * @param {(...args: any[]) => void} listener - Exact callback retained and removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  off(event: string, listener: (...args: any[]) => void): unknown;
}
export interface ValkeyRequestOptions {
  /** Borrowed caller signal; native work can continue after abort. */
  signal?: AbortSignal;
  /** Absolute epoch milliseconds no more than 120000ms ahead. */
  deadline?: number;
}
export interface ValkeySetOptions
  extends CacheSetOptions, ValkeyRequestOptions {}
export type ValkeyOperation =
  | 'get'
  | 'set'
  | 'delete'
  | 'has'
  | 'clear'
  | 'clearPrefix'
  | 'getMany'
  | 'setMany'
  | 'deleteMany'
  | 'increment'
  | 'decrement'
  | 'touch';
export interface ValkeyOperationRecord {
  /** Fixed command label, never a key or endpoint. */
  operation: ValkeyOperation;
  /** Monotonic elapsed observation milliseconds. */
  durationMs: number;
  /** Fixed result classification. */
  outcome: 'ok' | 'error' | 'deadline' | 'cancelled' | 'overload';
  /** Fixed redacted diagnostic code. */
  code?: string;
  /** Unknown means an issued write may have committed. */
  writeOutcome?: 'unknown';
}
export interface ValkeyHelperOptions {
  /** Default false for injected clients; true transfers native cleanup. */
  ownClient?: boolean;
  /** Default false; Cluster remains unsupported even when true. */
  allowFlushDb?: boolean;
  /** Default 3000ms; integer 1–120000. */
  commandTimeoutMs?: number;
  /** Default 5000ms; integer 1–120000, separate from actual cleanup. */
  shutdownTimeoutMs?: number;
  /** Default 64; integer 1–1024, retained through actual settlement. */
  maxPendingCommands?: number;
  /** Default 10000; integer 1–100000 across all masters. */
  maxScanPages?: number;
  /** Optional shared cache JSON/key/depth/bulk budgets. */
  valueLimits?: Pick<
    CachePolicy,
    'maxBulk' | 'maxKeyBytes' | 'maxValueBytes' | 'maxDepth'
  >;
  /** Optional fixed-label host hook; at most four asynchronous callbacks retained. */
  onOperation?: (
    record: Readonly<ValkeyOperationRecord>
  ) => void | Promise<void>;
}
export interface ValkeyConnectionOptions extends ValkeyHelperOptions {
  /** Optional injected safe client, borrowed by default. */
  client?: ValkeyClient;
  /** Trusted redis/rediss URL, mutually exclusive with explicit endpoint/credentials/Cluster. */
  url?: string;
  /** Trusted standalone host, default loopback. */
  host?: string;
  /** Standalone port, default 6379. */
  port?: number;
  /** Private native ACL username; never browser configuration. */
  username?: string;
  /** Private native credential; never telemetry. */
  password?: string;
  /** Standalone database index, incompatible with Cluster. */
  db?: number;
  /** Bounded copied TLS material; certificate verification cannot be disabled. */
  tls?: {
    /** Optional trusted CA text/list, at most eight bounded entries. */
    ca?: string | string[];
    /** Optional private client certificate text. */
    cert?: string;
    /** Optional private client TLS key text; never browser configuration. */
    key?: string;
    /** Optional validated TLS servername. */
    servername?: string;
  };
  /** Explicit seed inventory, mutually exclusive with standalone endpoint/db. */
  cluster?: {
    /** Explicit 1–32 validated seed addresses. */
    nodes: readonly {
      /** Trusted standalone host, default loopback. */
      host: string; /** Standalone port, default 6379. */
      port: number;
    }[];
  };
  /** Default 3000ms; integer 1–120000. */
  connectTimeoutMs?: number;
  /** Finite lifetime budget, default zero, maximum three. */
  maxReconnectAttempts?: number;
}
