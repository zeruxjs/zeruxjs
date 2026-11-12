import { createHash } from 'node:crypto';
import type { DatabaseFacade, QueryOperation } from './types.js';
import { assertJsonSerializable, createDatabaseError } from './utils.js';

export interface DatabaseMigration {
  /** Ordered unique migration identity; never a caller-selected arbitrary operation. */
  id: string;
  /** JSON DSL operations, applied in order within one *real, exclusive* host transaction. */
  up: QueryOperation[];
  /** Explicit reverse operations requiring exact true approval before execution. */
  down: QueryOperation[];
}
export interface MigrationRecord {
  /** Ordered unique migration identity; never a caller-selected arbitrary operation. */
  id: string;
  /** SHA-256 drift hash, not proof of authorship or permission. */
  checksum: string;
  /** Persisted ISO-compatible application timestamp; not regenerated on reads. */
  appliedAt: string;
}
export interface MigrationJournal {
  /** Read journal history from the exclusively locked pinned database.
   * @returns {Promise<MigrationRecord[]>} Current journal records, validated by the runner.
   */
  list(): Promise<MigrationRecord[]>;
  /** Write one applied migration record on that same pin.
   * @param {MigrationRecord} record - Applied ID/hash/content-owned timestamp record.
   * @returns {Promise<void>} Journal write completion within the enclosing transaction.
   */
  insert(record: MigrationRecord): Promise<void>;
  /** Remove one approved reversed migration record on that same pin.
   * @param {string} id - Exact validated migration ID.
   * @returns {Promise<void>} Journal removal completion within the enclosing transaction.
   */
  remove(id: string): Promise<void>;
}
export interface ExclusiveMigrationTransaction {
  /**
   * Must acquire a cross-process exclusive migration lock AND an actual engine transaction,
   * and provide a transaction-pinned facade and journal in the callback. Both commit or roll back together.
   * An ordinary DB `query([...])` is NOT a transaction. MySQL DDL can implicitly commit: do not use
   * the default JSON DDL compiler as an atomic migration transaction on that engine.
   */
  <T>(
    run: (
      db: Pick<DatabaseFacade, 'query'>,
      journal: MigrationJournal
    ) => Promise<T>
  ): Promise<T>;
}
export interface MigrationRunnerOptions {
  /** Host-owned cross-process exclusive pinned transaction for data and journal. */
  transaction: ExclusiveMigrationTransaction;
  /** Optional trusted clock, consulted only for newly applied records. */
  now?: () => Date;
}

/** Reject invalid migration or journal state without operation payloads.
 * @param {string} code - Fixed failure classification.
 * @param {string} message - Fixed diagnostic for this policy violation.
 * @returns {never} Always throws a structured database error. */
const deny = (code: string, message: string): never => {
  throw createDatabaseError({ code, message });
};
/** Hash ordered migration definitions for drift detection, not authorship.
 * @param {DatabaseMigration} migration - Validated ID and JSON up/down operations.
 * @returns {string} SHA-256 of the existing canonical property order. */
const checksum = (migration: DatabaseMigration): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: migration.id,
        up: migration.up,
        down: migration.down,
      })
    )
    .digest('hex');
/** Validate ordered unique definitions and a bounded total operation budget.
 * @param {DatabaseMigration[]} items - Host-authored definitions, maximum 4096.
 * @returns {void} Rejects malformed, cross-connection or dependent migrations. */
const checkMigrations = (items: DatabaseMigration[]) => {
  if (!Array.isArray(items) || items.length > 4096) {
    deny('INVALID_MIGRATION', 'Migration collection exceeds supported limit');
  }
  /** Unique migration IDs observed while validating definitions. */
  const seen = new Set<string>();
  let totalOperations = 0;
  // Validate uniqueness/order and aggregate operation limits before exposing the runner.
  for (const item of items) {
    if (
      !item ||
      !/^[0-9]{4,20}_[a-z0-9_-]{1,90}$/.test(item.id) ||
      seen.has(item.id) ||
      !Array.isArray(item.up) ||
      !item.up.length ||
      !Array.isArray(item.down) ||
      !item.down.length
    ) {
      deny(
        'INVALID_MIGRATION',
        'Migration IDs must be unique and migrations must provide up/down operations'
      );
    }
    totalOperations += item.up.length + item.down.length;
    if (totalOperations > 4096) {
      deny(
        'INVALID_MIGRATION',
        'Migration operation collection exceeds supported limit'
      );
    }
    assertJsonSerializable(
      { up: item.up, down: item.down },
      'Migration definition'
    );
    if (
      [...item.up, ...item.down].some(
        (op) =>
          !op ||
          typeof op.op !== 'string' ||
          op.connection ||
          op.dependsOn !== undefined ||
          op.use !== undefined ||
          ('into' in op && op.into)
      )
    ) {
      deny(
        'INVALID_MIGRATION',
        'Migration contains cross-connection or dependent operations'
      );
    }
    seen.add(item.id);
  }
  /** Authored ordering checked before exposing any runner. */
  const ids = items.map((item) => item.id);
  if (ids.some((id, i) => i > 0 && ids[i - 1] >= id)) {
    deny('INVALID_MIGRATION', 'Migrations must be sorted by ascending ID');
  }
};

/** Snapshot bounded definitions and keep journal inspection/mutation within one host exclusive transaction.
 * @param {DatabaseMigration[]} migrations - Ordered host-authored definitions; changes are detected by existing SHA-256 serialization.
 * @param {MigrationRunnerOptions} options - Explicit exclusive transaction and optional trusted clock.
 * @returns {object} Inert plan plus explicit status/apply/approved rollback operations.
 */
export function createDatabaseMigrationRunner(
  migrations: DatabaseMigration[],
  options: MigrationRunnerOptions
) {
  checkMigrations(migrations);
  if (typeof options?.transaction !== 'function') {
    deny(
      'MIGRATION_TRANSACTION_REQUIRED',
      'Real exclusive transaction required'
    );
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    deny('INVALID_MIGRATION', 'Invalid migration clock');
  }
  /** Read the host clock only when applying a new journal record.
   * @returns {Date} Application timestamp for this committed migration attempt.
   */
  const now = options.now ?? (() => new Date());
  /** Detached up/down definitions with immutable-by-ownership drift hashes. */
  const items = migrations.map((item) => ({
    ...item,
    up: structuredClone(item.up),
    down: structuredClone(item.down),
    checksum: checksum(item),
  }));
  /** Validate bounded journal records, drift hashes and contiguous history.
   * @param {MigrationJournal} journal - Host-owned journal bound to this actual exclusive transaction.
   * @returns {Promise<{applied:number,pending:number}>} Coverage inside the current exclusive pin; malformed state rejects.
   */
  async function inspect(journal: MigrationJournal) {
    /** Host journal rows bounded and validated before interpretation. */
    const records = await journal.list();
    if (!Array.isArray(records) || records.length > 4096) {
      deny('MIGRATION_DRIFT', 'Migration journal exceeds supported limit');
    }
    /** Definition inventory used to reject unknown IDs and checksum drift. */
    const known = new Map(items.map((item) => [item.id, item]));
    /** Unique applied IDs verified as a contiguous definition prefix. */
    const applied = new Set<string>();
    // Reject malformed, duplicate, unknown or changed journal history.
    for (const record of records) {
      if (
        !record ||
        typeof record.id !== 'string' ||
        typeof record.checksum !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.checksum) ||
        typeof record.appliedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.appliedAt))
      ) {
        deny('MIGRATION_DRIFT', 'Malformed migration journal record');
      }
      if (
        applied.has(record.id) ||
        !known.has(record.id) ||
        known.get(record.id)?.checksum !== record.checksum
      ) {
        // Diagnostic reason preserves duplicate/unknown/checksum priority without exposing operations.
        let reason = 'checksum';
        if (applied.has(record.id)) {
          reason = 'duplicate';
        } else if (!known.has(record.id)) {
          reason = 'unknown';
        }
        throw createDatabaseError({
          code: 'MIGRATION_DRIFT',
          message: 'Unknown, duplicate or modified migration in journal',
          details: {
            id: record.id.slice(0, 128),
            reason,
            expected: known.get(record.id)?.checksum,
            actual: record.checksum,
          },
        });
      }
      applied.add(record.id);
    }
    /** Expected applied prefix; holes cannot silently become pending work. */
    const prefix = items.slice(0, applied.size);
    if (prefix.some((item) => !applied.has(item.id))) {
      deny('MIGRATION_DRIFT', 'Migration journal is not a contiguous prefix');
    }
    return { applied: records.length, pending: items.length - records.length };
  }
  /** Apply each detached migration operation in authored order on the same pin.
   * @param {Pick<DatabaseFacade, 'query'>} db - Pinned query executor, never an unpinned pool method.
   * @param {QueryOperation[]} operations - Detached ordered JSON DSL operations.
   * @returns {Promise<void>} All operations succeeded; host transaction owns actual rollback.
   */
  async function execute(
    db: Pick<DatabaseFacade, 'query'>,
    operations: QueryOperation[]
  ) {
    // Apply detached operations in authored order through the same pin.
    for (const operation of operations) {
      /** Pinned operation outcome checked before journal advancement. */
      const result = await db.query(structuredClone(operation));
      if (Array.isArray(result) || !result.ok) {
        deny('MIGRATION_FAILED', `Migration operation ${operation.op} failed`);
      }
    }
  }
  return Object.freeze({
    plan: () => items.map((item) => ({ id: item.id, checksum: item.checksum })),
    status: () => options.transaction(async (_db, journal) => inspect(journal)),
    apply: () =>
      options.transaction(async (db, journal) => {
        /** Validated journal coverage inside the same exclusive transaction. */
        const status = await inspect(journal);
        /** Only unapplied definitions in their original validated order. */
        const pending = items.slice(status.applied);
        // Journal each newly applied definition inside the enclosing exclusive transaction.
        for (const item of pending) {
          await execute(db, item.up);
          await journal.insert({
            id: item.id,
            checksum: item.checksum,
            appliedAt: now().toISOString(),
          });
        }
        return pending.map((item) => item.id);
      }),
    rollbackLast: (authorize: (id: string) => Promise<boolean> | boolean) => {
      if (typeof authorize !== 'function') {
        deny(
          'MIGRATION_APPROVAL_REQUIRED',
          'Explicit rollback approval required'
        );
      }
      return options.transaction(async (db, journal) => {
        /** Validated journal coverage inside the same exclusive transaction. */
        const status = await inspect(journal);
        if (!status.applied) {
          return null;
        }
        /** Last applied definition selected for explicitly approved reversal. */
        const item = items[status.applied - 1];
        if ((await authorize(item.id)) !== true) {
          deny(
            'MIGRATION_APPROVAL_REQUIRED',
            'Migration rollback not approved'
          );
        }
        await execute(db, item.down);
        await journal.remove(item.id);
        return item.id;
      });
    },
  });
}
