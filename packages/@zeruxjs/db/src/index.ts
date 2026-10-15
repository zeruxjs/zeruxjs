import type {
    AlterTableOperation,
    CreateDbOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DatabaseFacade,
    DatabaseManager,
    DatabaseManagerConfig,
    DatabaseResult,
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
    query(operation: QueryOperation | QueryOperation[]): MaybePromise<DatabaseResult | DatabaseResult[]> {
        return getActiveDatabaseManager().query(operation);
    },
    createDb(operation: Omit<CreateDbOperation, "op" | "connection">) {
        return getActiveDatabaseManager().createDb({ ...operation, op: "createDb" });
    },
    dropDb(operation: Omit<DropDbOperation, "op" | "connection">) {
        return getActiveDatabaseManager().dropDb({ ...operation, op: "dropDb" });
    },
    switchDB(operation: Omit<SwitchDbOperation, "op" | "connection">) {
        return getActiveDatabaseManager().switchDB({ ...operation, op: "switchDB" });
    },
    createTable(operation: Omit<CreateTableOperation, "op" | "connection">) {
        return getActiveDatabaseManager().createTable({ ...operation, op: "createTable" });
    },
    dropTable(operation: Omit<DropTableOperation, "op" | "connection">) {
        return getActiveDatabaseManager().dropTable({ ...operation, op: "dropTable" });
    },
    alterTable(operation: Omit<AlterTableOperation, "op" | "connection">) {
        return getActiveDatabaseManager().alterTable({ ...operation, op: "alterTable" });
    },
    turcunateTable(operation: Omit<TruncateTableOperation, "op" | "connection">) {
        return getActiveDatabaseManager().turcunateTable({ ...operation, op: "turcunateTable" });
    },
    createIndex(operation: Omit<CreateIndexOperation, "op" | "connection">) {
        return getActiveDatabaseManager().createIndex({ ...operation, op: "createIndex" });
    },
    dropIndex(operation: Omit<DropIndexOperation, "op" | "connection">) {
        return getActiveDatabaseManager().dropIndex({ ...operation, op: "dropIndex" });
    },
    insert(operation: Omit<InsertOperation, "op" | "connection">) {
        return getActiveDatabaseManager().insert({ ...operation, op: "insert" });
    },
    select(operation: Omit<SelectOperation, "op" | "connection">) {
        return getActiveDatabaseManager().select({ ...operation, op: "select" });
    },
    update(operation: Omit<UpdateOperation, "op" | "connection">) {
        return getActiveDatabaseManager().update({ ...operation, op: "update" });
    },
    delete(operation: Omit<DeleteOperation, "op" | "connection">) {
        return getActiveDatabaseManager().delete({ ...operation, op: "delete" });
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
export const query = (operation: QueryOperation | QueryOperation[]) =>
    getActiveDatabaseManager().query(operation);

export const createDb = (operation: CreateDbOperation) =>
    getActiveDatabaseManager().createDb(operation);

export const dropDb = (operation: DropDbOperation) =>
    getActiveDatabaseManager().dropDb(operation);

export const switchDB = (operation: SwitchDbOperation) =>
    getActiveDatabaseManager().switchDB(operation);

export const createTable = (operation: CreateTableOperation) =>
    getActiveDatabaseManager().createTable(operation);

export const dropTable = (operation: DropTableOperation) =>
    getActiveDatabaseManager().dropTable(operation);

export const alterTable = (operation: AlterTableOperation) =>
    getActiveDatabaseManager().alterTable(operation);

export const turcunateTable = (operation: TruncateTableOperation) =>
    getActiveDatabaseManager().turcunateTable(operation);

export const createIndex = (operation: CreateIndexOperation) =>
    getActiveDatabaseManager().createIndex(operation);

export const dropIndex = (operation: DropIndexOperation) =>
    getActiveDatabaseManager().dropIndex(operation);

export const insert = (operation: InsertOperation) =>
    getActiveDatabaseManager().insert(operation);

export const select = (operation: SelectOperation) =>
    getActiveDatabaseManager().select(operation);

export const update = (operation: UpdateOperation) =>
    getActiveDatabaseManager().update(operation);

export const remove = (operation: DeleteOperation) =>
    getActiveDatabaseManager().delete(operation);

export { remove as delete };
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
