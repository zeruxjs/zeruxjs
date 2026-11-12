import { randomBytes } from 'node:crypto';
import type { AnalyticsConnection } from './types.js';

/** Public mixed-case alphanumeric alphabet; rejection sampling avoids modulo bias. */
const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Exact public correlation ID grammar; IDs carry no authorization. */
const requestIdPattern = /^[A-Za-z0-9]{16}$/;
/** Generate a 16-character cryptographic ID using unbiased rejection sampling.
 * @returns {string} Opaque correlation identifier; not a session or permission token.
 */
export function createRequestId(): string {
  let id = '';
  // Draw bounded batches until rejection sampling yields exactly 16 accepted characters.
  while (id.length < 16) {
    // Reject the biased tail, then map each accepted byte into the 62-character alphabet.
    for (const byte of randomBytes(32)) {
      if (byte >= 248) {
        continue;
      }
      id += alphabet[byte % 62]!;
      if (id.length === 16) {
        break;
      }
    }
  }
  return id;
}
/** Check the exact public correlation-ID grammar.
 * @param {unknown} id - Candidate untrusted identifier.
 * @returns {boolean} Whether the value is a supported string ID.
 */
export function validRequestId(id: unknown): id is string {
  return typeof id === 'string' && requestIdPattern.test(id);
}
/** Format a validated server timestamp as a UTC reservation day.
 * @param {number} at - UTC milliseconds; defaults to Date.now().
 * @returns {string} ISO day label; unsafe/negative/out-of-range dates throw.
 */
export function requestUtcDay(at = Date.now()): string {
  if (!Number.isSafeInteger(at) || at < 0) {
    throw new RangeError('Invalid request time');
  }
  return new Date(at).toISOString().slice(0, 10);
}
/** reserve MUST be atomic across all replicas, returning false for a duplicate UTC day + ID. */
export interface RequestIdStore {
  /** Atomically reserve a UTC-day and ID pair.
   * @param {string} day - Validated UTC reservation day.
   * @param {string} id - Opaque 16-character correlation ID.
   * @returns {Promise<boolean>} True on reservation, false on duplicate; invalid/capacity/storage failures reject.
   */
  reserve(day: string, id: string): Promise<boolean>;
}
/** Create bounded process-local reservations for today and yesterday.
 * @param {number} max - Maximum IDs per day bucket, default 100000.
 * @returns {RequestIdStore & {size(): number}} Non-durable store; no timers or connection ownership.
 */
export function createMemoryRequestIdStore(max = 100_000): RequestIdStore & {
  /** Count retained process-local reservations.
   * @returns {number} Total IDs across retained day buckets.
   */
  size(): number;
} {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('Invalid reservation limit');
  }
  /** Process-local day buckets, not distributed deduplication. */
  const days = new Map<string, Set<string>>();
  return {
    /** Atomically reserve a UTC-day and ID pair.
     * @param {string} day - Validated UTC reservation day.
     * @param {string} id - Opaque 16-character correlation ID.
     * @returns {Promise<boolean>} True on reservation, false on duplicate; invalid/capacity/storage failures reject.
     */
    async reserve(day, id) {
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !validRequestId(id)) {
        throw new TypeError('Invalid request reservation');
      }
      /** Current server UTC day used to bound accepted in-memory reservations. */
      const now = requestUtcDay();
      /** Previous UTC day retained for delayed collection requests. */
      const yesterday = requestUtcDay(Date.now() - 86400000);
      if (day !== now && day !== yesterday) {
        throw new RangeError('Reservation day is outside supported window');
      }
      // Discard unsupported days before checking the current bucket capacity.
      for (const key of days.keys()) {
        if (key !== now && key !== yesterday) {
          days.delete(key);
        }
      }
      let set = days.get(day);
      if (!set) {
        set = new Set();
        days.set(day, set);
      }
      if (set.has(id)) {
        return false;
      }
      if (set.size >= max) {
        throw new Error('Request reservation capacity exceeded');
      }
      set.add(id);
      return true;
    },
    /** Count retained process-local reservations.
     * @returns {number} Total IDs across retained day buckets.
     */
    size() {
      let n = 0;
      // Count retained buckets only; no storage scan is involved.
      for (const set of days.values()) {
        n += set.size;
      }
      return n;
    },
  };
}
/** Create atomic day/ID reservations on an explicitly shared database table.
 * @param {AnalyticsConnection} connection - Borrowed connection with atomic primary-key inserts.
 * @param {string} table - Validated table name, default analytics_request_ids.
 * @returns {RequestIdStore & {initialize(): Promise<boolean>}} Lazy store; the host owns database shutdown and production uniqueness.
 */
export function createDatabaseRequestIdStore(
  connection: AnalyticsConnection,
  table = 'analytics_request_ids'
): RequestIdStore & { initialize(): Promise<boolean> } {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid request ID table');
  }
  let initialized = false;
  let lastMaintenanceDay: string | undefined;
  /** Lazily create the shared reservation table on the borrowed connection.
   * @returns {Promise<boolean>} Whether table creation succeeded; failed attempts can be retried. */
  const initialize = async () => {
    if (initialized) {
      return true;
    }
    /** Settled database schema/insert outcome, interpreted using explicit ok and duplicate codes. */
    const result = await connection.createTable({
      table,
      ifNotExists: true,
      columns: [
        {
          name: 'id',
          type: 'varchar',
          length: 32,
          primary: true,
          notNull: true,
        },
        { name: 'utc_day', type: 'varchar', length: 10, notNull: true },
        { name: 'created_at', type: 'bigint', notNull: true },
      ],
    });
    initialized = result?.ok === true;
    return initialized;
  };
  return {
    initialize,
    /** Atomically reserve a UTC-day and ID pair.
     * @param {string} day - Validated UTC reservation day.
     * @param {string} id - Opaque 16-character correlation ID.
     * @returns {Promise<boolean>} True on reservation, false on duplicate; invalid/capacity/storage failures reject.
     */
    async reserve(day, id) {
      if (!validRequestId(id) || !/^\d{4}-\d\d-\d\d$/.test(day)) {
        throw new TypeError('Invalid request ID');
      }
      if (!(await initialize())) {
        throw new Error('Request reservation storage unavailable');
      }
      // Retention is opportunistic and non-blocking; an optional connector delete can
      // prune days older than yesterday without interrupting ingestion.
      if (lastMaintenanceDay !== day) {
        lastMaintenanceDay = day;
        /** Borrowed optional delete capability; opportunistic cleanup never owns the connection. */
        const cleaner = connection as AnalyticsConnection & {
          delete?: (operation: {
            table: string;
            where: { field: string; operator: 'lte'; value: string };
          }) => Promise<unknown> | unknown;
        };
        if (cleaner.delete) {
          /** Inclusive stale-day cutoff for opportunistic nonblocking cleanup. */
          const before = requestUtcDay(Date.now() - 2 * 86400000);
          Promise.resolve()
            .then(() =>
              cleaner.delete!({
                table,
                where: { field: 'utc_day', operator: 'lte', value: before },
              })
            )
            .catch(() => {});
        }
      }
      /** Settled database schema/insert outcome, interpreted using explicit ok and duplicate codes. */
      const result = await connection.insert({
        table,
        values: {
          id: `${day.replace(/-/g, '')}:${id}`,
          utc_day: day,
          created_at: Date.now(),
        },
      });
      if (result?.ok) {
        return true;
      }
      /** Driver error code only; raw error messages/credentials never enter diagnostics. */
      const code = String(result?.error?.code ?? '');
      if (
        [
          '23505',
          'ER_DUP_ENTRY',
          '1062',
          'SQLITE_CONSTRAINT',
          'SQLITE_CONSTRAINT_PRIMARYKEY',
          '11000',
        ].includes(code)
      ) {
        return false;
      }
      throw new Error('Request reservation storage unavailable');
    },
  };
}
/** Allocate an ID with a finite collision retry budget.
 * @param {RequestIdStore} store - Host-selected atomic reservation store.
 * @param {string} day - UTC reservation day, default current server day.
 * @param {number} attempts - Maximum candidates, default five.
 * @returns {Promise<string>} First reserved ID; collision exhaustion/storage failure rejects.
 */
export async function reserveNewRequestId(
  store: RequestIdStore,
  day = requestUtcDay(),
  attempts = 5
): Promise<string> {
  // Stop after the declared collision budget; never treat a duplicate as a reservation.
  for (let i = 0; i < attempts; i++) {
    /** Fresh random candidate; every collision is checked through the supplied atomic store. */
    const id = createRequestId();
    if (await store.reserve(day, id)) {
      return id;
    }
  }
  throw new Error('Unable to allocate unique request ID');
}
