import type {
    AlterTableOperation,
    CreateDbOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DatabaseFacade,
    DatabaseManager,
    DatabaseManagerConfig,
    DatabaseResult,
    DatabaseQueryOptions,
    DeleteOperation,
    DropDbOperation,
    DropIndexOperation,
    DropTableOperation,
    InsertOperation,
    MaybePromise,
    QueryOperation,
    SelectOperation,
    SwitchDbOperation,
    TruncateTableOperation,
    UpdateOperation
} from "./types.js";
import {
    configureDatabaseManager,
    createDatabaseManager,
    getActiveDatabaseManager,
    setActiveDatabaseManager
} from "./manager.js";
import { createDatabaseError } from "./utils.js";

const getDefaultFacade = (): DatabaseFacade => getActiveDatabaseManager().getConnectionFacade();

/**
 * Title: Default database facade
 * Description: Exposes the default connection through stable convenience methods.
 * Global Variables: none
 */
export const db: DatabaseFacade = {
    transactionCapabilities(){return getDefaultFacade().transactionCapabilities?.();},
    transaction(run,options){const facade=getDefaultFacade();if(!facade.transaction)throw createDatabaseError({code:'UNSUPPORTED_TRANSACTION',message:'Pinned transactions are unavailable'});return facade.transaction(run,options);},
    capabilities() { return getDefaultFacade().capabilities?.() ?? {returning:'unknown',transactions:'unknown',cancellation:'unknown',schema:'unknown',indexes:'unknown',nativeAggregation:'unknown'}; },
    get slug() {
        return getDefaultFacade().slug;
    },
    get name() {
        return getDefaultFacade().name;
    },
    get connector() {
        return getDefaultFacade().connector;
    },
    get options() {
        return getDefaultFacade().options;
    },
    query(operation: QueryOperation | QueryOperation[], options?:DatabaseQueryOptions): MaybePromise<DatabaseResult | DatabaseResult[]> {
        return getActiveDatabaseManager().query(operation,options);
    },
    createDb(operation: Omit<CreateDbOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().createDb({ ...operation, op: "createDb" },options);
    },
    dropDb(operation: Omit<DropDbOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().dropDb({ ...operation, op: "dropDb" },options);
    },
    switchDB(operation: Omit<SwitchDbOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().switchDB({ ...operation, op: "switchDB" },options);
    },
    createTable(operation: Omit<CreateTableOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().createTable({ ...operation, op: "createTable" },options);
    },
    dropTable(operation: Omit<DropTableOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().dropTable({ ...operation, op: "dropTable" },options);
    },
    alterTable(operation: Omit<AlterTableOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().alterTable({ ...operation, op: "alterTable" },options);
    },
    turcunateTable(operation: Omit<TruncateTableOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().turcunateTable({ ...operation, op: "turcunateTable" },options);
    },
    createIndex(operation: Omit<CreateIndexOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().createIndex({ ...operation, op: "createIndex" },options);
    },
    dropIndex(operation: Omit<DropIndexOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().dropIndex({ ...operation, op: "dropIndex" },options);
    },
    insert(operation: Omit<InsertOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().insert({ ...operation, op: "insert" },options);
    },
    select(operation: Omit<SelectOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().select({ ...operation, op: "select" },options);
    },
    update(operation: Omit<UpdateOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().update({ ...operation, op: "update" },options);
    },
    delete(operation: Omit<DeleteOperation, "op" | "connection">, options?:DatabaseQueryOptions) {
        return getActiveDatabaseManager().delete({ ...operation, op: "delete" },options);
    },
    native() {
        return getDefaultFacade().native();
    }
};

/**
 * Title: Native connection accessor
 * Description: Returns the configured connector instance for advanced use cases.
 * Global Variables: none
 * @param slug Connection slug.
 * @returns Connector instance.
 */
export const dbAccess = (slug: string) => getActiveDatabaseManager().dbAccess(slug);

/**
 * Title: Query router
 * Description: Routes one or many JSON operations to the active manager.
 * Global Variables: none
 * @param operation Operation or operation list.
 * @returns Query result.
 */
export const query = (operation: QueryOperation | QueryOperation[], options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().query(operation,options);

export const createDb = (operation: CreateDbOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().createDb(operation,options);

export const dropDb = (operation: DropDbOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().dropDb(operation,options);

export const switchDB = (operation: SwitchDbOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().switchDB(operation,options);

export const createTable = (operation: CreateTableOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().createTable(operation,options);

export const dropTable = (operation: DropTableOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().dropTable(operation,options);

export const alterTable = (operation: AlterTableOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().alterTable(operation,options);

export const turcunateTable = (operation: TruncateTableOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().turcunateTable(operation,options);

export const createIndex = (operation: CreateIndexOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().createIndex(operation,options);

export const dropIndex = (operation: DropIndexOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().dropIndex(operation,options);

export const insert = (operation: InsertOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().insert(operation,options);

export const select = (operation: SelectOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().select(operation,options);

export const update = (operation: UpdateOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().update(operation,options);

export const remove = (operation: DeleteOperation, options?:DatabaseQueryOptions) =>
    getActiveDatabaseManager().delete(operation,options);

export { remove as delete };
export { createTenantDatabaseFacade } from "./tenant.js";
export type { TenantDatabase, TenantDatabaseOptions } from "./tenant.js";
export { createDatabaseMigrationRunner } from "./migrations.js";
export type { DatabaseMigration, MigrationRecord, MigrationJournal, ExclusiveMigrationTransaction, MigrationRunnerOptions } from "./migrations.js";
export {
    createDatabaseError,
    configureDatabaseManager,
    createDatabaseManager,
    getActiveDatabaseManager,
    setActiveDatabaseManager
};
export type {
    AlterTableAction,
    BinaryExpression,
    ColumnDefinition,
    ColumnExpression,
    ComparisonOperator,
    CreateDbOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DatabaseColumnType,
    DatabaseConnector,
    DatabaseConnectorFactory,
    DatabaseErrorShape,
    DatabaseExecutionContext,
    DatabaseFacade,
    DatabaseFunctionName,
    DatabaseManager,
    DatabaseManagerConfig,
    DatabaseOperationName,
    DatabaseResult,
    DeleteOperation,
    DropDbOperation,
    DropIndexOperation,
    DropTableOperation,
    ForeignKeyReference,
    FunctionExpression,
    InsertOperation,
    JsonObject,
    JsonPrimitive,
    JsonValue,
    JoinDefinition,
    MaybePromise,
    OrderByClause,
    QueryExpression,
    QueryOperation,
    ResultReferenceToken,
    SelectColumn,
    SelectOperation,
    SwitchDbOperation,
    TableSchema,
    TruncateTableOperation,
    UpdateOperation,
    ValueExpression,
    WhereClause,
    WherePredicate
} from "./types.js";

export default db;

export type { CapabilitySupport, DatabaseCapabilities, DatabaseQueryOptions, DatabaseQueryMetric, DatabaseExecutionPolicy, DatabaseCountMetadata } from './types.js';
export { createKeysetPage } from './pagination.js';
export type { KeysetOrder, KeysetContinuation, KeysetPageOptions } from './pagination.js';

export { executionPolicy as validateDatabaseExecutionPolicy } from './execution.js';

export { createPinnedTransaction } from './manager.js';
export type { TransactionIsolation, TransactionOptions, TransactionDatabase, DatabaseTransaction, PinnedTransactionAdapter, PinnedTransactionSession, PinnedTransactionCapabilities } from './transactions.js';
export type { NormalizedConnectionConfig } from './types.js';

export { createPinnedMigrationTransaction } from './migration-coordination.js';
export type { MigrationLock, MigrationLockLease, MigrationCoordinationOptions } from './migration-coordination.js';
