import { createHash } from "node:crypto";
import type { DatabaseFacade, QueryOperation } from "./types.js";
import { assertJsonSerializable, createDatabaseError } from "./utils.js";

export interface DatabaseMigration {
    id: string;
    /** JSON DSL operations, applied in order within one *real, exclusive* host transaction. */
    up: QueryOperation[];
    down: QueryOperation[];
}
export interface MigrationRecord { id: string; checksum: string; appliedAt: string; }
export interface MigrationJournal {
    list(): Promise<MigrationRecord[]>;
    insert(record: MigrationRecord): Promise<void>;
    remove(id: string): Promise<void>;
}
export interface ExclusiveMigrationTransaction {
    /**
     * Must acquire a cross-process exclusive migration lock AND an actual engine transaction,
     * and provide a transaction-pinned facade and journal in the callback. Both commit or roll back together.
     * An ordinary DB `query([...])` is NOT a transaction. MySQL DDL can implicitly commit: do not use
     * the default JSON DDL compiler as an atomic migration transaction on that engine.
     */
    <T>(run: (db: Pick<DatabaseFacade, "query">, journal: MigrationJournal) => Promise<T>): Promise<T>;
}
export interface MigrationRunnerOptions { transaction: ExclusiveMigrationTransaction; now?: () => Date; }

const deny = (code: string, message: string): never => { throw createDatabaseError({ code, message }); };
const checksum = (migration: DatabaseMigration): string => createHash("sha256")
    .update(JSON.stringify({ id: migration.id, up: migration.up, down: migration.down })).digest("hex");
const checkMigrations = (items: DatabaseMigration[]) => {
    const seen = new Set<string>();
    for (const item of items) {
        if (!item || !/^[0-9]{4,20}_[a-z0-9_-]{1,90}$/.test(item.id) || seen.has(item.id) || !Array.isArray(item.up) || !item.up.length || !Array.isArray(item.down) || !item.down.length) {
            deny("INVALID_MIGRATION", "Migration IDs must be unique and migrations must provide up/down operations");
        }
        assertJsonSerializable({ up: item.up, down: item.down }, "Migration definition");
        if ([...item.up, ...item.down].some(op => !op || typeof op.op !== "string" || op.connection || op.dependsOn !== undefined || op.use !== undefined || ("into" in op && op.into))) {
            deny("INVALID_MIGRATION", "Migration contains cross-connection or dependent operations");
        }
        seen.add(item.id);
    }
    const ids = items.map(item => item.id);
    if (ids.some((id, i) => i > 0 && ids[i - 1] >= id)) deny("INVALID_MIGRATION", "Migrations must be sorted by ascending ID");
};

/** Keeps journal checks and mutations inside a host-provided exclusive transaction. */
export function createDatabaseMigrationRunner(migrations: DatabaseMigration[], options: MigrationRunnerOptions) {
    checkMigrations(migrations);
    if (typeof options?.transaction !== "function") deny("MIGRATION_TRANSACTION_REQUIRED", "Real exclusive transaction required");
    const now = options.now ?? (() => new Date());
    const items = migrations.map(item => ({ ...item, up: structuredClone(item.up), down: structuredClone(item.down), checksum: checksum(item) }));
    async function inspect(journal: MigrationJournal) {
        const records = await journal.list();
        const known = new Map(items.map(item => [item.id, item]));
        const applied = new Set<string>();
        for (const record of records) {
            if (applied.has(record.id) || !known.has(record.id) || known.get(record.id)?.checksum !== record.checksum) deny("MIGRATION_DRIFT", "Unknown, duplicate or modified migration in journal");
            applied.add(record.id);
        }
        const prefix = items.slice(0, applied.size);
        if (prefix.some(item => !applied.has(item.id))) deny("MIGRATION_DRIFT", "Migration journal is not a contiguous prefix");
        return { applied: records.length, pending: items.length - records.length };
    }
    async function execute(db: Pick<DatabaseFacade, "query">, operations: QueryOperation[]) {
        for (const operation of operations) {
            const result = await db.query(structuredClone(operation));
            if (Array.isArray(result) || !result.ok) deny("MIGRATION_FAILED", `Migration operation ${operation.op} failed`);
        }
    }
    return Object.freeze({
        plan: () => items.map(item => ({ id: item.id, checksum: item.checksum })),
        status: () => options.transaction(async (_db, journal) => inspect(journal)),
        apply: () => options.transaction(async (db, journal) => {
            const status = await inspect(journal);
            const pending = items.slice(status.applied);
            for (const item of pending) {
                await execute(db, item.up);
                await journal.insert({ id: item.id, checksum: item.checksum, appliedAt: now().toISOString() });
            }
            return pending.map(item => item.id);
        }),
        rollbackLast: (authorize: (id: string) => Promise<boolean> | boolean) => {
            if (typeof authorize !== "function") deny("MIGRATION_APPROVAL_REQUIRED", "Explicit rollback approval required");
            return options.transaction(async (db, journal) => {
                const status = await inspect(journal);
                if (!status.applied) return null;
                const item = items[status.applied - 1];
                if (!await authorize(item.id)) deny("MIGRATION_APPROVAL_REQUIRED", "Migration rollback not approved");
                await execute(db, item.down);
                await journal.remove(item.id);
                return item.id;
            });
        }
    });
}
