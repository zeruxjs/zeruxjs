import { validateTransactionOptions } from './transactions.js';
import { randomUUID } from 'node:crypto';
import type {
  DatabaseTransaction,
  TransactionOptions,
} from './transactions.js';
import type {
  ExclusiveMigrationTransaction,
  MigrationJournal,
  MigrationRecord,
} from './migrations.js';
import { assertIdentifier, createDatabaseError } from './utils.js';
export interface MigrationLockLease {
  /** Exact generated acquisition identity; release must compare it. */
  readonly owner: string;
  /** Optional lease-loss signal; abort must fence future writes. */
  readonly signal?: AbortSignal;
  /** Verify current cross-process exclusion before continuing pinned work.
   * @returns {Promise<void>} Rejects stale/lost ownership; implementations must fence writers.
   */
  assertOwned(): Promise<void>;
  /** Release only the exact acquired owner after transaction cleanup.
   * @param {string} owner - Exact generated lease owner, never a caller assertion.
   * @returns {Promise<void>} Owner-fenced cleanup; must never release another owner.
   */
  release(owner: string): Promise<void>;
}
/** Must be cross-process exclusive for the actual database/journal domain; no in-memory implementation is supplied. */
export interface MigrationLock {
  /** Acquire explicit cross-process exclusion with cooperative cancellation.
 * @param {{
    name: string;
    owner: string;
    signal: AbortSignal;
  }} request - Lock domain/owner plus cooperative acquisition signal.
 * @returns {Promise<MigrationLockLease>} Lease must echo the exact requested owner and expose loss detection.
 */
  acquire(request: {
    name: string;
    /** Exact generated acquisition identity; release must compare it. */
    owner: string;
    /** Optional lease-loss signal; abort must fence future writes. */
    signal: AbortSignal;
  }): Promise<MigrationLockLease>;
}
export interface MigrationCoordinationOptions {
  /** Host-owned actual cross-process exclusion/fencing implementation. */
  lock: MigrationLock;
  /** Stable database/journal coordination domain, 1–128 ASCII identifier characters. */
  lockName: string;
  /** Pre-provisioned identifier in this exact pinned database. */
  journalTable: string;
  /** Cooperative lock acquisition deadline, default 30000ms, range 1–60000. */
  lockTimeoutMs?: number;
  /** Explicit negotiated pin isolation/deadline policy. */
  transactionOptions?: TransactionOptions;
}
/** Hold a fenced cross-process lock through actual pinned data/journal cleanup.
 * @param {DatabaseTransaction} transaction - Explicit native-backed pinned transaction runner.
 * @param {MigrationCoordinationOptions} options - Trusted cross-process lock/domain and provisioned journal policy.
 * @returns {ExclusiveMigrationTransaction} Runner acquiring a fresh owner per invocation; no lock acquired on construction.
 */
export function createPinnedMigrationTransaction(
  transaction: DatabaseTransaction,
  options: MigrationCoordinationOptions
): ExclusiveMigrationTransaction {
  if (
    typeof transaction !== 'function' ||
    !options ||
    typeof options.lock?.acquire !== 'function' ||
    typeof options.lockName !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(options.lockName)
  ) {
    throw createDatabaseError({
      code: 'INVALID_MIGRATION_LOCK',
      message: 'Explicit migration lock and domain required',
    });
  }
  /** Host-supplied cross-process lock owner; no in-memory production emulation. */
  const lock = options.lock;
  /** Validated database/journal coordination domain. */
  const name = options.lockName;
  /** Cooperative lock-acquisition deadline, default 30000ms, maximum 60000. */
  const timeoutMs = options.lockTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw createDatabaseError({
      code: 'INVALID_MIGRATION_LOCK',
      message: 'Invalid migration lock timeout',
    });
  }
  /** Validated pin options before acquiring any lock. */
  const transactionOptions = validateTransactionOptions(
    options.transactionOptions
  );
  /** Validated pre-provisioned journal table in the pinned database. */
  const table = assertIdentifier(
    options.journalTable,
    'Migration journal table'
  );
  return async (run) => {
    /** Fresh lease owner; release must fence this exact identifier. */
    const owner = randomUUID();
    /** Cooperative acquisition cancellation scope. */
    const acquiring = new AbortController();
    /** Owned acquisition timer removed on all terminal paths. */
    const timer = setTimeout(() => acquiring.abort(), timeoutMs);
    let lease: MigrationLockLease | undefined,
      failure: unknown,
      result: unknown,
      hasFailure = false;
    try {
      lease = await lock.acquire({ name, owner, signal: acquiring.signal });
      clearTimeout(timer);
      if (
        !lease ||
        lease.owner !== owner ||
        typeof lease.release !== 'function' ||
        typeof lease.assertOwned !== 'function' ||
        (lease.signal !== undefined && !(lease.signal instanceof AbortSignal))
      ) {
        throw createDatabaseError({
          code: 'MIGRATION_LOCK_OWNERSHIP',
          message: 'Migration lock ownership mismatch',
        });
      }
      if (acquiring.signal.aborted) {
        throw createDatabaseError({
          code: 'MIGRATION_LOCK_TIMEOUT',
          message: 'Migration lock acquisition timed out',
        });
      }
      await lease.assertOwned();
      result = await transaction(
        async (db) => {
          /** Recheck lock ownership before using the same pinned journal executor.
           * @param {Parameters<typeof db.query>[0]} operation - One explicit journal operation.
           * @returns {Promise<import("./types.js").DatabaseResult>} Successful single result; failed/array outcomes reject. */
          const execute = async (operation: Parameters<typeof db.query>[0]) => {
            await lease!.assertOwned();
            /** Pinned journal query outcome or transaction result, checked before exposure. */
            const result = await db.query(operation);
            if (Array.isArray(result) || !result.ok) {
              throw createDatabaseError({
                code: 'MIGRATION_JOURNAL_FAILED',
                message: 'Migration journal operation failed',
              });
            }
            return result;
          };
          /** Journal facade restricted to operations on this exact transaction pin. */
          const journal: MigrationJournal = {
            /** Read bounded journal history through the same pinned executor.
             * @returns {Promise<MigrationRecord[]>} At most 4096 validated runner records; overflow rejects.
             */
            async list() {
              /** Pinned journal query outcome or transaction result, checked before exposure. */
              const result = await execute({
                op: 'select',
                table,
                orderBy: [{ by: 'id', direction: 'asc' }],
                limit: 4097,
              });
              if (!Array.isArray(result.rows) || result.rows.length > 4096) {
                throw createDatabaseError({
                  code: 'MIGRATION_JOURNAL_LIMIT',
                  message: 'Migration journal exceeds supported limit',
                });
              }
              return result.rows as MigrationRecord[];
            },
            /** Persist a journal record through the lock-checked pin.
             * @param {MigrationRecord} record - Applied migration ID/hash/time fields.
             * @returns {Promise<void>} Write completion inside the same transaction.
             */
            async insert(record) {
              await execute({
                op: 'insert',
                table,
                values: {
                  id: record.id,
                  checksum: record.checksum,
                  appliedAt: record.appliedAt,
                },
              });
            },
            /** Delete one journal record through the lock-checked pin.
             * @param {string} id - Exact migration ID to remove.
             * @returns {Promise<void>} Write completion inside the same transaction.
             */
            async remove(id) {
              await execute({
                op: 'delete',
                table,
                where: { field: 'id', operator: 'eq', value: id },
              });
            },
          };
          /** Host callback result returned only after a final lock-ownership check. */
          const value = await run(db, journal);
          await lease!.assertOwned();
          return value;
        },
        {
          ...transactionOptions,
          signal: AbortSignal.any([
            ...(transactionOptions.signal ? [transactionOptions.signal] : []),
            ...(lease.signal ? [lease.signal] : []),
          ]),
        }
      );
    } catch (error) {
      hasFailure = true;
      failure =
        acquiring.signal.aborted && !lease
          ? createDatabaseError({
              code: 'MIGRATION_LOCK_TIMEOUT',
              message: 'Migration lock acquisition timed out',
              cause: error,
            })
          : error;
    } finally {
      clearTimeout(timer);
      if (lease && typeof lease.release === 'function') {
        try {
          await lease.release(owner);
        } catch (error) {
          failure = new AggregateError(
            hasFailure ? [failure, error] : [error],
            'Migration lock release failed'
          );
          hasFailure = true;
        }
      }
    }
    if (hasFailure) {
      throw failure;
    }
    return result as never;
  };
}
